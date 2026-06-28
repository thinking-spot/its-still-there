#!/usr/bin/env node
/**
 * It's Still There — stream validator.
 *
 * Why this exists: the only reliable way to know a YouTube stream will actually
 * play inside our app is the IFrame Player API, which fires onError code 150/101
 * for videos whose owners disallow off-site embedding. oEmbed and plain HTTP
 * checks CANNOT see this — they report embed-blocked videos as perfectly fine.
 * So we drive a real headless browser, load each ID through YT.Player, and write
 * a trustworthy Status back to database.csv and streams.json.
 *
 * Run: node validate.mjs   (from tools/validator/, after `npm install`)
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const CSV_PATH = path.join(ROOT, 'database.csv');
const JSON_PATH = path.join(ROOT, 'streams.json');
const REPORT_PATH = path.join(__dirname, 'last-report.json');
const HARNESS_PATH = path.join(__dirname, 'harness.html');

const BATCH_SIZE = 4;        // concurrent players per batch (avoids autoplay throttling)
const TIMEOUT_MS = 20000;    // per-video budget to reach playback before "no_signal"

// ---------- tiny CSV (RFC4180-ish, matches the app's parser) ----------
function parseCSVLine(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; }
      else q = !q;
    } else if (c === ',' && !q) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}
function serializeField(v) {
  return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}
function extractVideoId(url) {
  const m = String(url).match(/[?&]v=([^&]+)/) || String(url).match(/embed\/([^?&]+)/);
  return m ? m[1] : null;
}

// ---------- status vocabulary ----------
// internal status -> CSV display label
const CSV_LABEL = {
  live: 'Live',
  embed_blocked: 'Embed Blocked',
  unavailable: 'Unavailable',
  offline: 'Offline',
  error: 'Error',
};
function classify(outcome, code) {
  if (outcome === 'playing') return { status: 'live', code: null };
  if (outcome === 'no_signal') return { status: 'offline', code: null };
  if (outcome === 'error') {
    if (code === 101 || code === 150) return { status: 'embed_blocked', code };
    if (code === 100) return { status: 'unavailable', code };
    return { status: 'error', code };
  }
  return { status: 'error', code: code ?? null };
}

// ---------- harness server ----------
function startHarnessServer() {
  const html = fs.readFileSync(HARNESS_PATH, 'utf8');
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

async function main() {
  // 1. Read the CSV; the IDs it contains are the source of truth (the app reads it).
  const csvRaw = fs.readFileSync(CSV_PATH, 'utf8');
  const csvLines = csvRaw.replace(/\r\n/g, '\n').split('\n');
  const header = parseCSVLine(csvLines[0]);
  const col = (name) => header.findIndex(h => h.trim().toLowerCase() === name.toLowerCase());
  const urlIdx = col('YouTube URL');
  let statusIdx = col('Status');

  const rows = [];
  for (let i = 1; i < csvLines.length; i++) {
    if (!csvLines[i].trim()) continue;
    rows.push(parseCSVLine(csvLines[i]));
  }

  const ids = [];
  const idToRows = new Map();
  for (const r of rows) {
    const id = extractVideoId(r[urlIdx]);
    if (!id) continue;
    if (!idToRows.has(id)) { idToRows.set(id, []); ids.push(id); }
    idToRows.get(id).push(r);
  }

  console.log(`Validating ${ids.length} stream(s) via headless Chromium + YouTube IFrame API...\n`);

  // 2. Drive headless Chromium. The autoplay flag makes "playing" a reliable
  //    signal even for offscreen/no-gesture players, so "no_signal" genuinely
  //    means the stream isn't broadcasting rather than "autoplay was blocked".
  const { server, port } = await startHarnessServer();
  const browser = await chromium.launch({
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--mute-audio',
      '--no-sandbox',
    ],
  });

  const verdicts = new Map(); // id -> { status, code }
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
    await page.waitForFunction('window.__harnessReady === true', { timeout: 30000 });

    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batch = ids.slice(i, i + BATCH_SIZE);
      const out = await page.evaluate(
        ({ b, t }) => window.checkBatch(b, t),
        { b: batch, t: TIMEOUT_MS }
      );
      for (const r of out) {
        const v = classify(r.outcome, r.code);
        verdicts.set(r.id, v);
        console.log(
          `  ${v.status === 'live' ? '✓' : '✗'} ${CSV_LABEL[v.status].padEnd(14)}` +
          `${v.code ? `(code ${v.code}) ` : ''}${r.id}`
        );
      }
    }
  } finally {
    await browser.close();
    server.close();
  }

  // 3. Write Status back to the CSV (only that column changes).
  const checkedAt = new Date().toISOString();
  for (const [id, rowList] of idToRows) {
    const v = verdicts.get(id);
    if (!v) continue;
    for (const r of rowList) {
      while (r.length <= statusIdx) r.push('');
      r[statusIdx] = CSV_LABEL[v.status];
    }
  }
  const newCsv =
    [csvLines[0], ...rows.map(r => r.map(serializeField).join(','))].join('\n') + '\n';
  fs.writeFileSync(CSV_PATH, newCsv);

  // 4. Mirror richer detail into streams.json (matched by youtubeId).
  let summary;
  if (fs.existsSync(JSON_PATH)) {
    const data = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
    for (const s of data.streams || []) {
      const v = verdicts.get(s.youtubeId);
      if (!v) continue;
      s.status = v.status;
      s.errorCode = v.code;
      s.lastChecked = checkedAt;
    }
    data.lastValidated = checkedAt;
    fs.writeFileSync(JSON_PATH, JSON.stringify(data, null, 2) + '\n');
  }

  // 5. Audit trail + console summary.
  const tally = {};
  for (const v of verdicts.values()) tally[v.status] = (tally[v.status] || 0) + 1;
  summary = {
    checkedAt,
    total: ids.length,
    tally,
    streams: ids.map(id => ({ id, ...verdicts.get(id) })),
  };
  fs.writeFileSync(REPORT_PATH, JSON.stringify(summary, null, 2) + '\n');

  console.log('\nSummary:', JSON.stringify(tally));
  const usable = tally.live || 0;
  console.log(`${usable}/${ids.length} streams are live & embeddable.`);
}

main().catch(err => { console.error(err); process.exit(1); });
