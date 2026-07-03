#!/usr/bin/env node
/**
 * It's Still There — assemble picks into streams.json.
 *
 * Turns per-target picks into full streams.json entries, deriving youtubeUrl /
 * embedUrl and copying city/state/country/lat/lng/timezone/sourceType from the
 * target so entries are consistent and hand-edit-free. Merges into the existing
 * streams.json (dedupe by youtubeId). Run `node validate.mjs` afterward to set
 * authoritative status.
 *
 * Picks come from tools/validator/picks.json:
 *   [ { "targetId": "...", "youtubeId": "...", "cameraName": "(optional override)" } ]
 *
 * Run: node assemble.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STREAMS_PATH, readJSON, writeJSON } from './lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TARGETS_PATH = path.join(__dirname, 'targets.json');
const PICKS_PATH = path.join(__dirname, 'picks.json');

const targets = Object.fromEntries(readJSON(TARGETS_PATH).map(t => [t.id, t]));
const picks = readJSON(PICKS_PATH);
const data = readJSON(STREAMS_PATH);
const byId = new Map(data.streams.map(s => [s.youtubeId, s]));

// Entry ids must be unique even when a target yields multiple cams.
const idCount = {};
data.streams.forEach(s => { idCount[s.id] = (idCount[s.id] || 0) + 1; });
function uniqueEntryId(baseId) {
  const n = (idCount[baseId] || 0) + 1;
  idCount[baseId] = n;
  return n === 1 ? baseId : `${baseId}-${n}`;
}

let added = 0, skipped = 0;
for (const pick of picks) {
  const t = targets[pick.targetId];
  if (!t) { console.error(`! unknown targetId: ${pick.targetId}`); skipped++; continue; }
  if (byId.has(pick.youtubeId)) { console.error(`. already present: ${pick.youtubeId}`); skipped++; continue; }

  const entry = {
    id: uniqueEntryId(t.id),
    cameraName: pick.cameraName || t.cameraName || t.city,
    city: t.city.replace(/\s*\(.*\)\s*/, '').trim(),   // keep grouping clean; detail lives in cameraName
    state: t.state || '',
    country: t.country,
    lat: t.lat,
    lng: t.lng,
    timezone: t.timezone,
    sourceType: t.sourceType,
    channelName: pick.channelName || '',
    youtubeId: pick.youtubeId,
    youtubeUrl: `https://www.youtube.com/watch?v=${pick.youtubeId}`,
    embedUrl: `https://www.youtube.com/embed/${pick.youtubeId}`,
    status: 'unverified',
    verifiedOn: null,
    errorCode: null,
    lastChecked: null,
  };
  data.streams.push(entry);
  byId.set(pick.youtubeId, entry);
  added++;
}

data.count = data.streams.length;
writeJSON(STREAMS_PATH, data);
console.log(`Added ${added}, skipped ${skipped}. streams.json now has ${data.streams.length} entries.`);
console.log('Run `node validate.mjs` to set authoritative status.');
