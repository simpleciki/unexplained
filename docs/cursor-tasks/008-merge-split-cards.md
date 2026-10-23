# Task 008 — Merge cards that split one statement (deterministic, no model calls)

Everything below the line is the task. Do step 0 first and report it.

---

## 0. Commit Task 007 (Ciki approved, 2026-10-22 22:47 CDT)

Commit the Task 007 work (Researcher prompt, sample mode, sample score, mode-disputes script, tests, card 007/008) as Conventional Commits, e.g.
`feat(ingest): one decision per card, mode definitions aligned with gold, sample mode`. Nothing under `.env`, `cache/`, `state/` (including `state/sample-007/`), `logs/` staged. Check the `-0500` offset with `git log -3 --format='%ai %h %s'` and paste it.

## Why (reviewer, 2026-10-22 22:4x CDT)

Sample run of the new prompt (12 records): precision 0.250 → 0.455, recall 0.231 → 0.385, both controls held (rec-0200 3/3, rec-0107 0 cards), 0 prose replies. But short client messages are still split even though the prompt says not to:
`Do the gauges. Then tell me what failed.` → `Do the gauges.` + `Then tell me what failed.`; same for rec-0112 and rec-0069. The model does not follow that instruction reliably, so fix it in code, not in the prompt.

Ciki's scope decision: keep the new prompt; fix splitting deterministically; leave the weak modes (proposes / gives_reason / mentions) for now; move on to the UI after this.

Also seen in the sample trace (for the README later, no action here): we request lightning/super, but Nightshift answered 10 of 23 extraction attempts with `nemotron-3-ultra-550b-a55b` anyway. The strict parser rejected its prose replies; the answering model is recorded per call in the trace.

## Build

1. `src/engine/merge-cards.ts` (or next to `verifyCards`): `mergeSplitCards(cards, records)`. Merge card B into card A when ALL hold:
   - same `record_id`, `mode`, `decided_by`, `scope`, `decided_at`, `effective`;
   - in that record's `text`, B's quote starts right after A's quote ends, with only whitespace between them (both quotes are already exact substrings — find their positions; if a quote occurs twice, do not merge).
   The merged quote is `text.slice(startA, endB)` — still an exact substring. `topic` = A's; `facets` = union in order; keep A's `card_id` and add `merged_from: [B's id, ...]`. Apply repeatedly so a chain of three becomes one card.
   Different `effective` (rec-0200: "$96 from 1 June" vs "$88 until 1 June") must stay two cards. A different `mode` must stay separate.
2. Pipeline: run it after the quote/record gate (`verifyCards`) and before `Skeptic.cards`, in both full and sample ingest. Count merges in the ingest report (`cards_merged`) and print it.
3. **Measure without any model call**: `npm run cards:merge-check` reads the current `state/cards.json` (77 cards, old prompt) and `state/sample-007/cards.json`, applies `mergeSplitCards` in memory, writes nothing, and prints precision / recall / per-mode matched against gold, before and after, for (a) the **full set — the headline number**, and (b) the sample. List every merge it made (record id, the quotes before, the quote after).
   Honesty note to print under the table: the rule was designed after looking at the sample, so the full-set number is the one to report.
4. Tests (no network): adjacent same-everything cards merge into an exact substring; a chain of three merges into one; different `effective` does not merge (rec-0200 shape, invented text); text between the quotes blocks a merge; a duplicate quote blocks a merge; different `mode` does not merge.

## Do not

- Call any model. Edit gold, data, vocab, or `RULES`. Read `.env`.
- Commit the Task 008 code; Ciki approves it after seeing the numbers.

## Done when

- Step 0 `git log` lines.
- typecheck + test summary.
- `cards:merge-check` output pasted in full.
- The command for Ciki's next full ingest (new prompt + merge), preceded by a one-line backup of the current state so the 77-card baseline survives, e.g.
  `cp -R state "state-baseline-2026-10-22-77cards" && npm run ingest -- --max-calls 400`
  with a dry-run estimate for it (cache probe: how many extraction calls miss).
