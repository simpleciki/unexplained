# The live Zetaris request in the demo video (2026-10-27)

No model call. All data fictional. Credentials come from `.env` and are never printed; nothing below contains one.

## What ran

- 2026-10-27, on the builder's machine, code commit `3007251`. Zetaris self-hosted in Docker (4 containers healthy),
  restarted that morning from the volumes kept since 10-26; `npm run sources:serve` serving the two source systems.
- Before recording: `npm run zetaris:parity` → every table and cross-source view identical through Zetaris and from
  files (16 of 16, same counts as `zetaris-parity-2026-10-25.txt`).
- Recorded: `npm run ui -- --source zetaris` (port 8099) started at 09:09:08 CDT, then the check page for
  `Q-PW-05-v2` opened as soon as the command printed its address. The recording shows the command's own output, every
  read Zetaris made of the two source systems as the source server logged it, and the check page with its two named
  warnings. The reads part is shown at 3× speed (marked on screen); the check page at real speed.

## Zetaris reaching the two source systems during the recorded run

From the source server's trace (`logs/trace-sources-2026-10-27T14-04-05-703Z.jsonl`, not committed; times converted
to CDT): 22 reads, all HTTP 200, 09:09:08.948 to 09:09:15.252 CDT.

| time (CDT) | source path | rows |
|---|---|---|
| 09:09:08.948 | `/portal/clients` | 4 |
| 09:09:09.140 | `/portal/quote_versions` | 47 |
| 09:09:09.326 | `/portal/quote_lines` | 198 |
| 09:09:09.513 | `/portal/submission_events` | 108 |
| 09:09:10.137 | `/portal/invoices` | 11 |
| 09:09:10.338 | `/portal/invoice_lines` | 47 |
| 09:09:10.837 | `/ops/work_orders` | 18 |
| 09:09:11.120 | `/portal/records_client_message` | 52 |
| 09:09:11.317 | `/portal/records_quote_version` | 47 |
| 09:09:12.103 | `/portal/records_submission_event` | 108 |
| 09:09:12.292 | `/portal/records_invoice` | 11 |
| 09:09:12.476 | `/ops/records_work_order` | 18 |
| 09:09:12.645 | `/ops/records_internal_note` | 28 |
| 09:09:12.820 | `/ops/records_field_note` | 36 |
| 09:09:13.524 | `/portal/invoices` | 11 |
| 09:09:13.569 | `/portal/quote_versions` | 47 |
| 09:09:13.616 | `/ops/work_orders` | 18 |
| 09:09:13.734 | `/portal/invoices` | 11 |
| 09:09:13.777 | `/portal/invoices` | 11 |
| 09:09:15.083 | `/portal/records_client_message` | 52 |
| 09:09:15.207 | `/ops/records_internal_note` | 28 |
| 09:09:15.252 | `/ops/records_field_note` | 36 |

## Where it is in the video

Demo video, 1:30.7–1:36.0, under the line "The data comes through Zetaris. The client portal and the job system, two
sources, joined." The rest of that scene (Meterless Nightshift receipts, Nemotron) is unchanged: it shows the committed
receipts summary, not a live model call.
