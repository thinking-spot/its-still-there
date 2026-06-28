// Shared core for the It's Still There stream tooling.
//
// The only reliable way to know a YouTube stream will play inside our app is the
// IFrame Player API, which fires onError code 150/101 for videos whose owners
// disallow off-site embedding. oEmbed / plain HTTP cannot see this. So both the
// validator and the discovery tool drive real YT.Player instances in headless
// Chromium via harness.html's window.checkBatch.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..', '..');
export const STREAMS_PATH = path.join(ROOT, 'streams.json');
const HARNESS_PATH = path.join(__dirname, 'harness.html');

// internal status -> human label
export const STATUS_LABEL = {
  live: 'Live',
  embed_blocked: 'Embed Blocked',
  unavailable: 'Unavailable',
  offline: 'Offline',
  error: 'Error',
};

// Map a raw checkBatch outcome to our status vocabulary.
export function classify(outcome, code) {
  if (outcome === 'playing') return { status: 'live', code: null };
  if (outcome === 'no_signal') return { status: 'offline', code: null };
  if (outcome === 'error') {
    if (code === 101 || code === 150) return { status: 'embed_blocked', code };
    if (code === 100) return { status: 'unavailable', code };
    return { status: 'error', code };
  }
  return { status: 'error', code: code ?? null };
}

/**
 * Spin up the harness (real http origin so the IFrame API behaves) + headless
 * Chromium, and hand `fn` a `check(ids, {timeoutMs, batchSize})` function that
 * returns { id: { outcome, code } } for every id. Cleans up afterward.
 */
export async function withHarness(fn) {
  const html = fs.readFileSync(HARNESS_PATH, 'utf8');
  const server = http.createServer((_, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const browser = await chromium.launch({
    args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--no-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
    await page.waitForFunction('window.__harnessReady === true', { timeout: 30000 });

    const check = async (ids, { timeoutMs = 20000, batchSize = 4 } = {}) => {
      const out = {};
      for (let i = 0; i < ids.length; i += batchSize) {
        const batch = ids.slice(i, i + batchSize);
        const res = await page.evaluate(({ b, t }) => window.checkBatch(b, t), { b: batch, t: timeoutMs });
        for (const r of res) out[r.id] = r;
      }
      return out;
    };

    return await fn(check);
  } finally {
    await browser.close();
    server.close();
  }
}

// Real title/author for a video (confirms identity). null if oEmbed rejects it.
export async function oembed(id) {
  try {
    const r = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`);
    if (!r.ok) return null;
    const d = await r.json();
    return { title: d.title, author: d.author_name };
  } catch {
    return null;
  }
}

export const readJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
export const writeJSON = (p, obj) => fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
