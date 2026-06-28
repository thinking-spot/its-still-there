# Stream tooling

`streams.json` (repo root) is the **canonical** data source — the app reads it directly. These
tools keep it trustworthy and help it grow.

## Why a headless browser (and not oEmbed)

A YouTube stream can be real, public, and live — and *still* refuse to play inside our app, because
its owner disabled off-site embedding. The IFrame Player API surfaces this as `onError` **code 150**
(or `101`). **oEmbed and plain HTTP checks cannot see it.** So everything here drives real `YT.Player`
instances in headless Chromium (`harness.html` → `window.checkBatch`), exactly like the app at view time.

## Scripts

| Script          | Purpose |
|-----------------|---------|
| `validate.mjs`  | Re-verify every stream in `streams.json`; write `status`, `errorCode`, `lastChecked`. Marks, never deletes. |
| `discover.mjs`  | Verify candidate IDs per target (`targets.json` + `candidates.json`, or YouTube Data API via `YT_API_KEY`); write a per-target `shortlist.json` of live, embeddable options. |
| `assemble.mjs`  | Turn picks (`picks.json`) into full `streams.json` entries (derives URLs, copies coords/timezone/sourceType from the target). |
| `lib.mjs`       | Shared harness/browser/classify core. |

## Status values

| Status          | Meaning                                                      |
|-----------------|-------------------------------------------------------------|
| `live`          | Embeddable **and** broadcasting                              |
| `embed_blocked` | Real stream, owner disallows embedding (IFrame 150/101)      |
| `unavailable`   | Removed / private / bad ID (IFrame 100)                      |
| `offline`       | Embeddable but not broadcasting at check time               |
| `error`         | Other IFrame error code                                      |

## Setup

```bash
cd tools/validator
npm install
npx playwright install --with-deps chromium
```

## Widening workflow

1. Add places to `targets.json` (`{id, city, state, country, lat, lng, timezone, sourceType, queries}`).
2. Collect candidate IDs into `candidates.json` (`{ "<targetId>": ["id", ...] }`), or set `YT_API_KEY`.
3. `node discover.mjs` → review `shortlist.json`.
4. Put chosen `{targetId, youtubeId, cameraName, channelName}` into `picks.json`; `node assemble.mjs`.
5. `node validate.mjs` → confirms status in `streams.json` + `last-report.json`.

`candidates.json`, `picks.json`, and `shortlist.json` are scratch inputs/outputs — not committed.

## Automated

`.github/workflows/validate-streams.yml` runs `validate.mjs` weekly (Mondays 13:00 UTC) and on
demand, committing status changes back so the dataset heals itself.
