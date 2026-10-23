# Task 009 — No truth lost: ledger, review queue, human judgments, gatekeeper screen

Everything below the line is the task. Two parts: do **Part A**, report, wait for the reviewer's go, then **Part B**.

---

## The principle (Ciki, 2026-10-23 07:24 CDT — this is the thesis of the project)

> Nobody, person or model, can guarantee to know everything or be 100% right. Trusting a confident but incomplete or wrong assertion costs real trust and real money. What everyone has to learn is the agreement **not to lose the truth** — then every judgment stays traceable, auditable, reviewable, judgeable, learnable and analysable.

So the system does not promise to be right about everything. It promises that **nothing is silently dropped**: whatever it cannot judge reliably is put in front of a human with the original text, and the human's decision and reason are kept.

## Why (reviewer, measured on the current `state/cards.json`, 116 extractable records)

| outcome | records | of which gold has a decision |
|---|---|---|
| model produced cards | 47 | 47 |
| failed (prose after retries / upstream) — already listed loudly | 10 | 10 |
| **model said "nothing here" (`{"cards":[]}`)** | **59** | **26 ← silent loss** |

Zero-card records by type: `client_message` 4 (all 4 had decisions), `internal_note` 21 (19 had decisions), `field_note` 34 (3 had decisions).
Honesty note for the README: the routing rule below was chosen after seeing these numbers; its justification is the meaning of the record types (client messages and office notes are where decisions are made; field notes are work logs).

## Part A — ledger, queue, judgments (no UI yet)

1. **Ledger** in ingest (full and sample): every extractable record ends in exactly one bucket, with a one-line `why`:
   - `auto_cards` — has cards that passed the gate and Skeptic;
   - `auto_empty` — zero cards AND `source_type` is `field_note`;
   - `needs_human` — anything else: failed upstream; prose after retries; any card rejected by the quote gate; any card dropped by Skeptic; zero cards on a `client_message` or `internal_note`; and any other source type with zero cards (default to a human, never to empty);
   - `human_confirmed` — the latest human judgment exists for that record (overrides the three above).
   Write `state/review-queue.json` (buckets + per-record why). The CLI prints one line: `116 records = A auto + E empty + H need you + C confirmed; silent loss: 0`. **Invariant: the buckets add up to the total; if not, `complete=false` and the line says LEDGER MISMATCH.** Keep the routing rules in one small, commented module so they are easy to read in the video.
2. `npm run queue [-- --job WO-xx]`: prints the needs_human items (record id, type, author, job, why, full text, model's candidate cards if any), optionally for one job only. Reads state; no model calls.
3. **Judgments**, append-only `review/judgments.jsonl` (new top-level folder, committed — it is reviewer data, not gold):
   `{judgment_id, record_id, verdict: "cards"|"no_decision", cards: [{mode, quote, decided_by, topic?}], reason, reviewer, judged_at, supersedes?}`
   - `quote` must be an exact substring of that record's text; `reason` is required and non-empty; unknown record ids are rejected.
   - `judged_at` = the server's local clock **at the moment the human submits** (ISO with offset, e.g. `-05:00`). Say so in a code comment.
   - A new judgment for the same record appends; the latest wins; history stays.
   - `src/review/judgments.ts`: load, validate, append, latest-per-record.
4. **Use the judgments**: when cards are loaded for the engine, a human-judged record uses the human cards (`source: "human"`, `judgment_id`) instead of model cards; `no_decision` means zero cards for that record. Answers that rely on a human card can cite "confirmed by <reviewer> on <date>: <reason>".
5. **Keep the scores honest**: model extraction P/R (`extraction-score`, live eval) must use **model cards only** — never human cards. Add a separate, clearly labelled "system" line (model + human-confirmed) where scores are printed. Nothing is ever written to `eval/gold/`.
6. Tests (no network): buckets add up (and a forced mismatch flips `complete`); each routing rule; judgment validation (non-substring quote, empty reason, unknown record → rejected); latest-wins; human cards replace model cards for that record only; model P/R ignores human cards.

Report Part A with: typecheck + tests, the ledger line and bucket counts on the current state (it can be computed from `state/cards.json` + `state/ingest-report.json` without re-running ingest — add `npm run queue -- --rebuild` for that), and `npm run queue` output for one job.

## Part B — gatekeeper screen (after the reviewer's go)

No new dependencies (the sandbox cannot reach npm): Node's `http` + one HTML file with vanilla JS/CSS. `npm run ui` serves on `127.0.0.1:${UI_PORT:-8095}` only. **The UI never calls a model.**

- Top strip: the ledger line, live (`116 records = … ; silent loss: 0`).
- Left: jobs, and under each job its quote versions and invoices.
- Pick a document → **Check**: the engine's warnings (P1–P7) for it, each with quoted evidence, who said it and when. Then **"Needs your judgment (N)"**: the needs_human items of that job only — full record text, why it was routed, the model's candidate if any.
- Judging an item: select the words in the record text (the selection becomes the exact quote) or press "No decision here"; choose mode and who decided; write the reason (required); submit → `POST /api/judgments` → appended → the item moves to "Confirmed by <reviewer>, <date>: <reason>" and the ledger updates.
- Reviewer name: a field remembered in `localStorage` (default "Ciki").
- Look: light, calm, readable at 1920×1080 for the video; one accent colour; money in tabular figures; no animation needed.
- Tests: API handlers (list jobs, check document, list queue, post judgment valid/invalid) without network.

## Do not

- Call any model. Install packages. Edit gold, data, vocab or `RULES`. Read `.env`.
- Commit; Ciki approves after seeing Part A numbers and Part B on screen.
