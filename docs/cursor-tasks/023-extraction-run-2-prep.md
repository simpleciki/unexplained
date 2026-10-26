# Task 023 — Prepare extraction run 2 (no model calls)

Read `docs/extraction-run-2.md` (commit `cb9ad57`) first and do not change it. Ciki approved on 2026-10-26.
You make no model calls: Ciki runs the ingest in her own terminal with the command you give her.

## 1. Isolation
- A full ingest can write to its own folder (e.g. `--out state/run-2`, today `--out` only works with `--records`).
- Its cache is separate from `cache/`: a run with `NVIDIA_DISABLE_THINKING=1` must never read a reply cached with
  thinking on, and must not write into `cache/` (e.g. a cache directory flag, or the thinking setting in the cache key
  plus a separate folder). Add a test that a thinking-off run does not hit a thinking-on cache entry.
- `state/` and `snapshot/ingest-2026-10-23/` are never written.

## 2. Dry run
Print the dry-run estimate for the full run-2 ingest (`AI_PROVIDER=nvidia-direct NVIDIA_DISABLE_THINKING=1 ...
--dry-run`) and give the exact command Ciki pastes, with `--max-calls` set to the worst case.

## 3. Compare script
`npm run extraction:compare -- --a snapshot/ingest-2026-10-23 --b state/run-2` (no model): precision, recall,
cards, records answered in prose, records failed upstream, and median latency from each run's trace or report, using
`src/eval/extraction-score.ts` for both in the same command; prints the adoption decision by the pre-registered rule.
Run it now with `--b` = the 2026-10-23 snapshot itself to show it works (precision and recall equal on both sides).

## 4. Adoption path (do not run until Ciki's run finishes)
Describe in one paragraph exactly what you will do if run 2 is adopted (new snapshot folder, rerun value:metrics
and demo:sample-day, tests) so it can be done in under 30 minutes.

## Done when
typecheck clean, tests pass, dry-run numbers and the command for Ciki, the self-compare output. Do not commit.
