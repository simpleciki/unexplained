# Ingest snapshot (read-only)

`ingest-2026-10-23/` is a copy of one full model ingest. It lets a fresh clone open the check page
(`npm run ui`) and reproduce `npm run value:metrics` without a key, a `.env` or a model call. Every record
and every name in it is fictional, like the rest of `data/`.

- **Produced by:** `npm run ingest`, finished 2026-10-23 01:42 CDT (run id `ingest-2026-10-23T06-42-45-515Z`, in UTC).
  The last commit before the run was `d4b15ba` (2026-10-22 22:54 CDT). Whether the working tree had
  uncommitted changes at that moment is not recorded.
- **Copied:** 2026-10-25 from `state/`, unchanged except for one redaction (below).

| file | what it is | read by |
|---|---|---|
| `cards.json` | the 73 model cards the ingest accepted | the check page, `value:metrics` |
| `edges.json` | the relations between cards (`REPLACES`, `SAME`, ...) | the check page, `value:metrics` |
| `ingest-report.json` | what happened to each of the 116 records | the review ledger ("Needs you") |
| `seats.json` | the seat table that ingest built (the authority) | nothing; kept for reference |
| `hmem-snapshot.json` | H-MEM's store after that ingest | nothing; the engine rebuilds H-MEM from the cards on every start |

**Redacted.** For the 3 records that failed upstream (rec-0006, rec-0079, rec-0128), `ingest-report.json`
contained the provider's raw error bodies, with request ids, model details and an NVIDIA error text. Each one is
replaced by a short line that keeps the runtime's own message, which is all the check page shows. Nothing else
was changed. `dead-modes.json` (run bookkeeping that holds an NVIDIA account error) and `review-queue.json` (rebuilt
from these files) were left out.

**Which one is used.** Reads use `state/` when it has a local ingest (`state/cards.json`), otherwise this folder,
and say which one when they start:
`reading cards from snapshot/ingest-2026-10-23 (no local ingest found)`. Nothing writes here: an ingest
writes `state/`, and judgments go to `review/judgments.jsonl` (or to `.demo/` with `--demo`). The code is
`src/pipeline/ingest-source.ts`.
