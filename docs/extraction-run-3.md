# Extraction run 3 — a second, targeted read of records that produced no card (pre-registered 2026-10-26, before the run)

Decided with Ciki on 2026-10-26 (08:12 CDT). Time box: the decision is made by the scheduled deadline of 12:00 CDT.

## Why
Error analysis of the 2026-10-23 cards against the 100 gold cards (no model call): 36 matched; 41 gold cards sit on a
record that produced no card at all; 17 are on the right record with the quote cut differently; 6 have the right words
with a different mode. The largest loss is records with no card: mostly records the model read as "nothing here"
(wrong on 26 of 59 when measured in `docs/cursor-tasks/009-no-truth-lost.md`), plus records answered in prose or failed
upstream. Run 2 (`docs/extraction-run-2.md`) showed that turning thinking off reads worse, so thinking stays on.

## What changes, and nothing else
- Input: only the records that produced **no card** in the 2026-10-23 ingest (`snapshot/ingest-2026-10-23/`), whatever
  the reason (read as empty, prose, failed upstream). Records that produced cards are not read again; their cards are
  kept as they are.
- One new prompt for this pass, written before the run and committed with the code: re-read the record and list every
  promise, price, date, approval, rejection, client rule and open item it contains, each with the exact words, or say
  there is none. Same card format and modes as the first pass.
- Route `nvidia-direct`, model `nvidia/nemotron-3.5-lightning-30b-a3b`, **thinking on**, `max_tokens` 4096, and the
  request carries `response_format: {"type": "json_object"}`. If NVIDIA rejects that field on the first call, the run
  stops; it is not silently dropped.
- New cards from this pass go through the same Skeptic step as first-pass cards. The result folder holds the 2026-10-23
  cards plus the accepted second-pass cards. Fresh replies only (own cache folder); `state/` and `snapshot/` are not written.
- Budget: the `--max-calls` printed by the dry-run, approved by Ciki. Scheduled cut-off: a run not finished by 11:00
  CDT is stopped and not used.

## How it is judged
`npm run extraction:compare` against `eval/gold/gold_cards.jsonl`, the 2026-10-23 snapshot as A and the run-3 folder as B,
in one command. Also reported: second-pass records read, new cards proposed, new cards kept by the Skeptic, and how many
of the new cards sit on records listed in `eval/gold/no_decision_records.json` (records that hold no decision).

**Adoption rule, fixed now:** run 3 replaces the 2026-10-23 cards only if its precision is not lower **and** its recall
is not lower. Otherwise the 2026-10-23 cards stay, and both results are reported as they are.

## If adopted
As in run 2: a new read-only snapshot, `value:metrics` and `demo:sample-day` re-run with no model call (definitions
unchanged), README and deck report both. The A-vs-C results are not re-run.
