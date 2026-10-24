# Task 014 — Never show "Clear" when the check had nothing to stand on

Decided by Ciki on 2026-10-24 (10:07 CDT): both cases below must stop showing green "Clear". This is the product's
own promise ("no truth is silently lost"): our measurement found the model's "nothing here" was wrong on 26 of 59
records, so a record the model read as empty cannot let a document pass.

Scope: `src/ui/api.ts` (`check`, `summary`), the check page / outbox (`src/ui/index.html`) where the wording or
colour depends on the state, their tests, and the README's runtime section. Do NOT touch `src/eval/*`, the gold
data, the scoring rules, `review/judgments.jsonl`, or anything an evaluation run reads. Do not commit.

A full evaluation run is in progress in Ciki's terminal (`eval-compare --subset full`, pid 17838). Do not stop it,
do not run any eval or model command, do not make any model call. The UI server on 8095 is down; you may start
it with `npm run ui` for the browser check.

## Before you change anything: count
Using the existing code with no model calls, print how many documents (quotes + invoices) are in each verdict
state (`warnings` / `not_cleared` / `clear`, count and money), and separately how many `clear` documents have
(a) zero records seen, (b) at least one spot-check record. Save the numbers; report them with the after numbers.

## Change 1 — zero records is not clear
Today `check()` returns `state: "clear"` when `seen.length === 0` ("Clear — no records on file before this …;
nothing to check against."). Make it `not_cleared` with plain text that says why, e.g.
"Not cleared — no records on file before this quote, so there is nothing to check it against." and a note that
names what is missing. Its money counts under `not_cleared` in `summary()`.

## Change 2 — a record the model read as empty blocks clear
Today records the model read as empty go into `info` ("open for spot-check") and do not block. Make them block:
when there are no fired warnings and at least one such record by the cut-off, the state is `not_cleared` and the
notes list them ("N record(s) the model read as empty need a person to spot-check before this can clear"). A
person confirming them through the existing judgment form must let the document clear again, as other judged
records do.

## Keep
- Fired warnings stay `warnings`, with their evidence.
- A document whose records are all judged and that has nothing open still shows the normal green Clear.
- Records written after the cut-off stay listed apart and never count.
- If the check page shows "Waiting on a person" or similar for `not_cleared`, make sure the wording is true for
  both new cases (no records; spot-check needed); adjust the text if it is not.

## README
The "Model runtime" section says "All model calls go through Nightshift … there is no other SDK or endpoint." That
is no longer true. Rewrite it to say: Nightshift (Meterless Runtime, 127.0.0.1:8088) is the default, primary
provider; `AI_PROVIDER=nvidia-direct` is an explicit route straight to NVIDIA's endpoint, added after Nightshift
1.2.1/1.2.2 failures, and used for the full evaluation run (see `docs/eval-protocol-011-amendment-2.md`); cached
replies are reused and marked as such. Meterless confirmed direct NVIDIA calls are fine (Sam Cummings, Help
Meterless, 2026-10-23). If the README describes the verdict states, update that text to match Changes 1 and 2.

## Done when
1. Tests added for: zero records -> not_cleared; spot-check open -> not_cleared; spot-check confirmed by a person
   -> clear; all judged, nothing open -> clear; warnings unchanged; post-cut-off records not counted.
2. `npm run typecheck` clean and `npm test` all pass (report counts).
3. Before / after state counts and money, from the same script.
4. Browser check at http://127.0.0.1:8095/outbox: one document of each new case shows the right state, colour
   and wording; the outbox totals match the API summary.
5. Report the diff stat. Do not commit.
