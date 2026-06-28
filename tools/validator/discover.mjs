#!/usr/bin/env node
/**
 * It's Still There — candidate discovery.
 *
 * Takes a list of target places (targets.json) plus candidate YouTube video IDs
 * for each, verifies which are embeddable AND live via headless Chromium, and
 * writes a per-target ranked shortlist (with real titles) for a human to pick from.
 *
 * Candidate IDs come from one of:
 *   - YT_API_KEY env set  -> auto-pulled from YouTube Data API search.list (eventType=live)
 *   - otherwise           -> tools/validator/candidates.json  ({ "<targetId>": ["id1","id2"] })
 *                            (populated by research agents / WebSearch)
 *
 * Run: node discover.mjs            (uses candidates.json)
 *      YT_API_KEY=... node discover.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withHarness, classify, oembed, readJSON, writeJSON } from './lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TARGETS_PATH = path.join(__dirname, 'targets.json');
const CANDIDATES_PATH = path.join(__dirname, 'candidates.json');
const SHORTLIST_PATH = path.join(__dirname, 'shortlist.json');

const targets = readJSON(TARGETS_PATH);

// 1. Gather candidate IDs per target.
const candidatesByTarget = {};
if (process.env.YT_API_KEY) {
  const key = process.env.YT_API_KEY;
  for (const t of targets) {
    const ids = new Set();
    for (const q of t.queries || [t.city]) {
      const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&eventType=live`
        + `&maxResults=6&q=${encodeURIComponent(q)}&key=${key}`;
      try {
        const r = await fetch(url);
        const d = await r.json();
        (d.items || []).forEach(it => it.id?.videoId && ids.add(it.id.videoId));
      } catch (e) { console.error(`search failed for "${q}": ${e.message}`); }
    }
    candidatesByTarget[t.id] = [...ids];
  }
} else {
  if (!fs.existsSync(CANDIDATES_PATH)) {
    console.error(`No YT_API_KEY and no ${CANDIDATES_PATH}. Provide one.`);
    process.exit(1);
  }
  Object.assign(candidatesByTarget, readJSON(CANDIDATES_PATH));
}

// 2. Flatten to a unique id list (dedupe across targets), remembering origins.
const idToTargets = new Map();
for (const [targetId, ids] of Object.entries(candidatesByTarget)) {
  for (const id of ids) {
    if (!idToTargets.has(id)) idToTargets.set(id, new Set());
    idToTargets.get(id).add(targetId);
  }
}
const allIds = [...idToTargets.keys()];
console.log(`Verifying ${allIds.length} candidate(s) across ${targets.length} target(s)...\n`);

// 3. Verify embeddable + live.
const verdicts = await withHarness(check => check(allIds, { batchSize: 4, timeoutMs: 20000 }));

// 4. Keep the live ones, attach real title/author, group by target.
const shortlist = {};
for (const t of targets) shortlist[t.id] = [];
for (const [id, raw] of Object.entries(verdicts)) {
  const v = classify(raw.outcome, raw.code);
  if (v.status !== 'live') continue;
  const meta = await oembed(id);
  for (const targetId of idToTargets.get(id)) {
    shortlist[targetId].push({ id, title: meta?.title ?? null, author: meta?.author ?? null });
  }
}

writeJSON(SHORTLIST_PATH, shortlist);

// 5. Console summary: which targets have a live, embeddable option.
let hit = 0;
for (const t of targets) {
  const n = shortlist[t.id].length;
  if (n) hit++;
  const top = shortlist[t.id][0];
  console.log(`  ${n ? '✓' : ' '} ${(t.city + ', ' + (t.state || t.country)).padEnd(28)} ${n} live` +
    (top ? `  → ${top.id} [${top.author}]` : ''));
}
console.log(`\n${hit}/${targets.length} targets have at least one live, embeddable cam.`);
console.log(`Shortlist written to ${SHORTLIST_PATH}`);
