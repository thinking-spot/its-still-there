#!/usr/bin/env node
// Turn scrape-out.json ("City, ST" -> candidates) into pipeline inputs:
//   - appends missing targets to targets.json (id, city, state, coords, tz, sourceType)
//   - writes candidates.json keyed by targetId
// City metadata comes from citymeta.json: { "City, ST": [lat, lng, "IANA/Zone"] }.
// Cities without metadata are skipped loudly (never guessed).
import fs from 'node:fs';

const scrape = JSON.parse(fs.readFileSync('scrape-out.json', 'utf8'));
const meta = JSON.parse(fs.readFileSync('citymeta.json', 'utf8'));
const targets = JSON.parse(fs.readFileSync('targets.json', 'utf8'));
const have = new Set(targets.map(t => t.id));

const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const candidates = {};
let added = 0, skipped = [];

for (const [key, cands] of Object.entries(scrape)) {
  const m = meta[key];
  if (!m) { skipped.push(key); continue; }
  const [city, st] = key.split(',').map(x => x.trim());
  const [lat, lng, timezone, sourceType = 'street'] = m;
  try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }); }
  catch { skipped.push(key + ' (bad tz)'); continue; }
  let id = slug(`${city}-${st}`);
  if (!have.has(id)) {
    targets.push({ id, city, state: st, country: 'USA', lat, lng, timezone,
      sourceType, queries: [`${city} live webcam`] });
    have.add(id);
    added++;
  }
  candidates[id] = cands.map(c => c.id);
}

fs.writeFileSync('targets.json', JSON.stringify(targets, null, 2) + '\n');
fs.writeFileSync('candidates.json', JSON.stringify(candidates, null, 1) + '\n');
console.log(`targets added: ${added} | candidate sets: ${Object.keys(candidates).length}`);
if (skipped.length) console.log('SKIPPED (no metadata):', skipped.join(' | '));
