# Stream validator

Re-verifies every webcam in `database.csv` and writes a **trustworthy `Status`**
back to `database.csv` and `streams.json`.

## Why a headless browser (and not oEmbed)

A YouTube stream can be real, public, and live — and *still* refuse to play
inside our app, because its owner disabled off-site embedding. The IFrame Player
API surfaces this as `onError` **code 150** (or `101`). **oEmbed and plain HTTP
checks cannot see it** — they report embed-blocked videos as fine. So this tool
drives real `YT.Player` instances in headless Chromium, exactly like the app does
at view time.

## Status values

| Status          | Meaning                                                      |
|-----------------|-------------------------------------------------------------|
| `Live`          | Embeddable **and** broadcasting right now                   |
| `Embed Blocked` | Real stream, but owner disallows embedding (IFrame 150/101) |
| `Unavailable`   | Removed / private / bad ID (IFrame 100)                     |
| `Offline`       | Embeddable but not broadcasting at check time               |
| `Error`         | Other IFrame error code                                     |

`streams.json` additionally records `errorCode` and `lastChecked` per stream.
A full audit trail is written to `last-report.json`.

## Run locally

```bash
cd tools/validator
npm install
npx playwright install --with-deps chromium
node validate.mjs
```

## Automated

`.github/workflows/validate-streams.yml` runs this every Monday (13:00 UTC) and
on manual dispatch, committing any status changes back to the repo. It does **not**
delete rows — a stream that is temporarily `Offline` keeps its row so it can come
back; curation stays a human decision.
