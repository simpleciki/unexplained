# Extraction run 2 — thinking off, same prompts (pre-registered 2026-10-26, before the run)

Decided with Ciki on 2026-10-26 (07:09 CDT). Time box: the decision is made by the scheduled deadline of 12:00 CDT.
Model extraction is the weakest layer (the 2026-10-23 ingest scored low precision and recall against the gold
cards), and other teams report that Nemotron replies faster and in cleaner JSON with thinking turned off. This run
tests that, once, under fixed rules.

## What changes, and nothing else
- Route `nvidia-direct`, model `nvidia/nemotron-3.5-lightning-30b-a3b` only, `NVIDIA_DISABLE_THINKING=1`
  (`chat_template_kwargs.enable_thinking = false`), `max_tokens` 4096 as today.
- Same prompts, same agents (Researcher, Skeptic, Keeper), same 116 records, same gold cards.
- Fresh replies only: no reply cached by an earlier run is reused (separate cache namespace); the run writes to its
  own state folder and never overwrites `state/` or `snapshot/ingest-2026-10-23/`.
- Budget: the `--max-calls` printed by the dry-run, approved by Ciki before the run. Scheduled cut-off: a run not
  finished by 11:00 CDT is stopped and not used.

## How it is judged
Extraction precision and recall against `eval/gold/gold_cards.jsonl`, computed by `src/eval/extraction-score.ts`
for **both** the 2026-10-23 cards (`snapshot/ingest-2026-10-23/cards.json`) and the run-2 cards, in the same command,
so neither number is quoted from memory. Also reported: records answered in prose, records failed upstream, cards,
median latency per call.

**Adoption rule, fixed now:** run 2 replaces the 2026-10-23 cards only if its precision is not lower **and** its recall
is not lower. Otherwise the 2026-10-23 cards stay, and both results are reported as they are.

## If adopted
A new read-only snapshot `snapshot/ingest-2026-10-26/`; `value:metrics` and `demo:sample-day` re-run with no model call
(definitions unchanged); the README reports both ingests side by side. The A-vs-C results (`compare-dev.json`,
`compare-full.json`) were produced on the old cards and are not re-run; the README says so.
