# Task 025 — Build extraction run 3: a second read of records with no card (no model calls)

Read `docs/extraction-run-3.md` (commit `9145e11`) first and do not change it. Ciki approved on 2026-10-26 at 08:12 CDT;
the whole thing is time-boxed (scheduled deadline 12:00 CDT), so keep it tight. You make no model calls: Ciki runs it.

1. A second-pass mode for the ingest (e.g. `--second-pass-of snapshot/ingest-2026-10-23 --out state/run-3`): list the
   extractable records that produced no card there (whatever the reason) and print the count and the reasons; read only
   those with the new second-pass prompt (write it as the pre-registration says; commit-ready text in the code); keep the
   first-pass cards; run the new cards through the same Skeptic step; write the merged cards, report and a `run.json`
   into `--out`. Thinking on, route nvidia-direct, `response_format: {"type":"json_object"}` on the request, and stop the
   run on the first call if NVIDIA rejects that field (do not drop it silently). Its own cache folder (e.g.
   `cache-second-pass/`, git-ignored). Never write `state/`, `snapshot/` or `cache/`.
2. Tests: the record selection (only no-card records), the merge (first-pass cards unchanged), the cache isolation, the
   stop on a rejected `response_format`.
3. Dry-run estimate and the exact command for Ciki with `--max-calls` at the worst case.
4. Extend `npm run extraction:compare` output for run 3 with: second-pass records read, cards proposed, kept by the
   Skeptic, and new cards on records in `eval/gold/no_decision_records.json`.

Done when: typecheck clean, tests pass, the record count and reasons, the dry-run numbers and the command. Do not edit
README.md. Do not commit.
