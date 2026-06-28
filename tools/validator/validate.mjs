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

console.log(`Validating ${ids.length} stream(s) via headless Chromium + YouTube IFrame API...\n`);

const verdicts = await withHarness(check => check(ids));

const checkedAt = new Date().toISOString();
for (const s of streams) {
  const raw = verdicts[s.youtubeId];
  if (!raw) continue;
  const v = classify(raw.outcome, raw.code);
  s.status = v.status;
  s.errorCode = v.code;
  s.lastChecked = checkedAt;
  console.log(
    `  ${v.status === 'live' ? '✓' : '✗'} ${STATUS_LABEL[v.status].padEnd(14)}` +
    `${v.code ? `(code ${v.code}) ` : ''}${s.youtubeId}  ${s.cameraName}`
  );
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
