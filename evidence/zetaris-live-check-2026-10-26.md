# One end-to-end request through a running Zetaris (2026-10-26)

No model call. All data fictional. Credentials come from `.env` and are never printed; nothing below contains one.

## What ran

- 2026-10-26 16:00:09 CDT, on the builder's machine, code commit `63aa4f7`. Zetaris self-hosted in Docker (4 containers healthy); `npm run sources:serve` serving the two source systems.
- Command: `UI_PORT=8099 node --env-file-if-exists=.env --import tsx src/cli/ui.ts --source zetaris` (the check page; it reads every table and view through Zetaris SQL at start).
- Request: `GET http://127.0.0.1:8099/api/check?doc=Q-PW-05-v2` → HTTP 200.

The cards it checks against are read from the local ingest (`state/`), byte-identical to the committed `snapshot/ingest-2026-10-23/` a fresh clone reads (`cards.json`, `edges.json`, `seats.json`: same SHA-256).

Check page output, verbatim:

```
reading cards from state/ (local ingest)
116 records = 46 auto + 34 empty (open for spot-check) + 31 need you + 5 confirmed; unaccounted: 0
home (the call): http://127.0.0.1:8099/  ·  outbox (the check page): http://127.0.0.1:8099/outbox  (data from zetaris; no model calls)
```

## Zetaris reaching the two source systems during this run

Zetaris pulls the registered REST tables from the source server, which logs every read. Summary of the log lines for this run (time UTC, path, rows returned, HTTP status):

| time (UTC) | source path | rows | status |
|---|---|---|---|
| 21:00:10.056 | `/portal/clients` | 4 | 200 |
| 21:00:10.379 | `/portal/quote_versions` | 47 | 200 |
| 21:00:10.542 | `/portal/quote_lines` | 198 | 200 |
| 21:00:10.792 | `/portal/submission_events` | 108 | 200 |
| 21:00:11.003 | `/portal/invoices` | 11 | 200 |
| 21:00:11.246 | `/portal/invoice_lines` | 47 | 200 |
| 21:00:11.444 | `/ops/work_orders` | 18 | 200 |
| 21:00:11.628 | `/portal/records_client_message` | 52 | 200 |
| 21:00:12.543 | `/portal/records_quote_version` | 47 | 200 |
| 21:00:12.721 | `/portal/records_submission_event` | 108 | 200 |
| 21:00:12.868 | `/portal/records_invoice` | 11 | 200 |
| 21:00:13.019 | `/ops/records_work_order` | 18 | 200 |
| 21:00:13.183 | `/ops/records_internal_note` | 28 | 200 |
| 21:00:13.783 | `/ops/records_field_note` | 36 | 200 |
| 21:00:14.509 | `/portal/invoices` | 11 | 200 |
| 21:00:14.547 | `/portal/quote_versions` | 47 | 200 |
| 21:00:14.581 | `/ops/work_orders` | 18 | 200 |
| 21:00:14.759 | `/portal/invoices` | 11 | 200 |
| 21:00:15.623 | `/portal/records_client_message` | 52 | 200 |
| 21:00:16.120 | `/ops/records_internal_note` | 28 | 200 |
| 21:00:16.254 | `/ops/records_field_note` | 36 | 200 |

## Input and output

**Input:** quote `Q-PW-05-v2` (Heron Court roof drain, $1,626), checked as of its send time.

**Output (excerpt of the JSON response):** verdict `warnings`, "Warnings found (2)".

- **P1 · A promise never closed**. Fix: "Before sending: send Otto Gell the result of “We'll check that first and tell you what we find.” that Mira Kell promised on 30 Apr, or add one line to the cover note saying it is still pending and when it will be done."
  - evidence record `rec-0250`: "We'll check that first and tell you what we find."
- **P5 · Rejection blamed on price by default**. Fix: "Don't cut the price yet. Ask Otto Gell which it was: a version was voided and resent within 30 minutes, the cover note names a different quote id, the same quote was announced 3 times or a promised check or requested finding had no recorded result."
  - evidence record `rec-0260`: "Not approving this one."

Notes on the same response: 1 record in this job written before this quote is not judged yet; the result can change; 3 records the model read as empty need a person to spot-check before this can clear; P2 (Unexplained change between versions) needs the Judge model step, not run here.

## Same answer from files

The same request against `--source files` (reading `data/` directly) returned an identical response (SHA-256 prefix `d5463cb14438bdaa` both ways; identical: True). The committed parity run (`evidence/zetaris-parity-2026-10-25.txt`) shows the tables themselves are identical.

