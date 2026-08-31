#!/usr/bin/env node
/**
 * It's Still There — stream validator.
 *
 * Re-checks every stream in the canonical streams.json through real YT.Player
 * instances in headless Chromium and writes a trustworthy status back. This is
 * the only way to catch embed-blocked streams (IFrame code 150/101) that oEmbed
 * reports as fine. Marks, never deletes — a temporarily-offline cam keeps its
 * row so it can come back.
 *
 * Run: node validate.mjs   (from tools/validator/, after `npm install`)
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withHarness, classify, STATUS_LABEL, STREAMS_PATH, readJSON, writeJSON } from './lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORT_PATH = path.join(__dirname, 'last-report.json');

const data = readJSON(STREAMS_PATH);
const streams = data.streams || [];
const ids = streams.map(s => s.youtubeId).filter(Boolean);
const previousLiveCount = streams.filter(s => s.status === 'live').length;

console.log(`Validating ${ids.length} stream(s) via headless Chromium + YouTube IFrame API...\n`);

const verdicts = await withHarness(check => check(ids));

const checkedAt = new Date().toISOString();
const results = streams.map(s => {
  const raw = verdicts[s.youtubeId];
  if (!raw) return null;
  const v = classify(raw.outcome, raw.code);
  console.log(
    `  ${v.status === 'live' ? '✓' : '✗'} ${STATUS_LABEL[v.status].padEnd(14)}` +
    `${v.code ? `(code ${v.code}) ` : ''}${s.youtubeId}  ${s.cameraName}`
  );
  return { stream: s, v };
}).filter(Boolean);

const newLiveCount = results.filter(r => r.v.status === 'live').length;

/**
 * Sanity guard: a real-world week never crashes the live rate to near-zero —
 * that pattern (seen for months here) means the CHECKER failed, not that
 * every stream simultaneously lost embeddability. This is almost always
 * YouTube rejecting the runner's IP as a datacenter/bot address, not a real
 * embed-policy change. Refuse to write a result that looks like an
 * environment failure rather than a genuine mass die-off.
 */
const MIN_SAMPLE = 20;   // below this, ratios are too noisy to judge
const MAX_DROP_RATIO = 0.5; // refuse if live count falls to <50% of last-known-good
if (previousLiveCount >= MIN_SAMPLE && newLiveCount < previousLiveCount * MAX_DROP_RATIO) {
  console.error(
    `\nREFUSING TO WRITE: live count would collapse from ${previousLiveCount} to ${newLiveCount} ` +
    `(${ids.length} checked). This looks like a checker/environment failure (e.g. the runner's ` +
    `IP being rejected by YouTube), not a real mass embed-policy change. streams.json left ` +
    `untouched. Investigate (try running from a non-datacenter IP) before overriding.`
  );
  process.exit(1);
}

for (const { stream, v } of results) {
  stream.status = v.status;
  stream.errorCode = v.code;
  stream.lastChecked = checkedAt;
}

data.lastValidated = checkedAt;
data.count = streams.length;
writeJSON(STREAMS_PATH, data);

const tally = {};
for (const s of streams) tally[s.status] = (tally[s.status] || 0) + 1;
writeJSON(REPORT_PATH, {
  checkedAt,
  total: streams.length,
  tally,
  streams: streams.map(s => ({ id: s.youtubeId, status: s.status, code: s.errorCode })),
});

console.log('\nSummary:', JSON.stringify(tally));
console.log(`${tally.live || 0}/${streams.length} streams are live & embeddable.`);
