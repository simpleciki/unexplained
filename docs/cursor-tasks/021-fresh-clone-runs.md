# Task 021 — A fresh clone opens the check page and reproduces the value metrics

Decided by Ciki on 2026-10-25 (20:13 CDT). Judges will clone the public repo with no keys, no `.env`, no Docker.
Today `state/` is git-ignored and `cache/samples/` does not exist, so a fresh clone cannot open the check page,
cannot run `npm run value:metrics`, and SAMPLE_MODE has nothing to replay.

No model calls. Do not change the engine, detectors, verdicts, gold, scoring or `review/judgments.jsonl`. Do not
commit.

## 1. A committed snapshot of the ingest
- Copy what the check page and `value:metrics` need from `state/` into a tracked folder, e.g.
  `snapshot/ingest-2026-10-23/` (cards, edges, the H-MEM snapshot, the ingest report, and whatever else they read).
- Scan every file you copy for account ids, tokens, keys, local paths and NVIDIA error bodies (e.g. "for account",
  `nvapi-`, `Bearer`, `/Users/`). Leave out files that are only run bookkeeping (e.g. `dead-modes.json`); if a needed
  file contains such text, redact that text and say what you redacted. Report the scan.
- Add `snapshot/README.md`: what it is, when and with which code it was produced, and that it is read-only.

## 2. Read from the snapshot when state/ is missing
The check page (`npm run ui`) and `npm run value:metrics` use `state/` when it exists, else the snapshot, and say
which one on start ("reading cards from snapshot/ingest-2026-10-23 (no local ingest found)"). They never write into the
snapshot. With the snapshot, `value:metrics` must give exactly the numbers in the committed
`eval/results/value-metrics.json` (ignore time and commit fields). Add a test.

## 3. SAMPLE_MODE
The README says judges can replay three sample questions with SAMPLE_MODE. Check whether `cache/samples/` can be built
from replies already in `cache/` with no model call. If yes, build and commit it and make sure `SAMPLE_MODE=true npm run
ask -- --sample <id>` works for each. If not, say so; the hub session will remove that claim from the README.

## 4. Test it in a clean directory
`git clone` this repo (with your uncommitted changes stashed into a temporary commit on a scratch branch, or by copying
the tracked files) into a temp folder outside the repo; no `.env`, no `state/`, no `cache/` beyond what is tracked.
There: `npm ci`, `npm test`, `npm run eval:oracle -- --source files`, `npm run value:metrics`, then
`npm run ui -- --demo` and fetch `/outbox` and `/api/summary` (HTTP 200, the 58 documents). Report each command's
result. Delete the temp folder and any scratch branch afterwards; leave this repo's working tree as it was plus your
changes.

## Done when
Snapshot scan reported; the four steps reported; typecheck and tests pass here too; diff stat; do not commit.
