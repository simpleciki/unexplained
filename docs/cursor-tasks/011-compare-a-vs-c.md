# Task 011 — Compare A (model reads everything) with C (our engine): right / confidently wrong / handed to a person

Everything below the line is the task. Build only; Ciki runs the model calls herself.

---

## Why (reviewer, 2026-10-23 09:2x CDT; Ciki approved 09:23)

The project's thesis (card 009): the system does not promise to be right about everything; it promises not to lose the truth, and to hand what it cannot judge to a person. Accuracy alone cannot show that. So every answer is classified into one of three outcomes, plus one bucket for replies that cannot be scored:

| outcome | meaning |
|---|---|
| `correct` | passes the existing `scoreQuestion` checks |
| `confidently_wrong` | gives a definite answer that fails those checks |
| `handed_to_person` | does not pass, but explicitly says it cannot conclude yet and why |
| `unscorable` | no usable reply (prose after retries, upstream failure, invalid shape) — listed, never counted as right or wrong |

The original plan (80 questions × 3 groups × 3 repeats ≈ 3,300 calls) does not fit the time left. Scope now: **12 dev questions (`subsetQuestions(root, "dev")`), groups A and C, one run each.** Group B (H-MEM as is) is a stretch goal, not in this card.

## 0. Pre-register the scoring rules (commit BEFORE any run)

Write `docs/eval-protocol-011.md`: the four outcomes above, exactly how each group's "handed to a person" is detected (rules below), the inputs each group gets, the cut-off rule, the model order, and the sentence "these rules were committed before the first A/C run; they are not changed after seeing results". Commit it alone: `docs(eval): pre-register the A vs C scoring rules`. Paste the commit line.

## Build

1. **Same inputs, same cut-off.** Both groups see only records with `source_recorded_at <= as_of` of the question (C already does this through the engine; make A do the same). Print, per question, how many records each group was given.
2. **Group A** (`src/eval/group-a.ts`): one model call per question through the same runtime and default model order as C (lightning → super; record the answering model per question, as the trace already does). The prompt contains: the role (a contractor's office gatekeeper checking a quote/invoice before it goes out), the question and its date, the records up to the cut-off (record id, type, author, time, text; the table renderings are already records), the seven patterns P1–P7 in one line each, and the reply schema:
   `{"verdict": "warn" | "clear" | "cannot_tell", "flags": ["P1", ...], "current": {"record_id", "quote", "mode"} | null, "in_effect": {...} | null, "reasons": [{"record_id", "quote"}], "cannot_tell_because": "..." | null}`
   The prompt must say plainly that "cannot_tell" is allowed and expected when the records do not settle the question — A must have the same right to abstain as C. Use the strict parser; retries as usual.
3. **Score A with the same yardstick as C**: map A's `current` / `in_effect` / `reasons` quotes to gold card ids with `matchCards` (same record, mode, ≥0.8 overlap — the existing rule, unchanged), map `flags` to `predicted_flags`, then call the existing `scoreQuestion`.
4. **C's "handed to a person"**: add `open_items` to C's answer (no model call): the needs_human records and open questions written before `as_of` on the jobs of the question's seats (reuse the ledger/queue code from 009/010). C counts as `handed_to_person` only when it did not pass AND `open_items` is non-empty AND the answer shows them (the CLI/ask output lists them). A counts as `handed_to_person` only when it did not pass AND `verdict == "cannot_tell"` with a non-empty `cannot_tell_because`.
5. `npm run eval:compare -- --subset dev --max-calls N` (`src/cli/eval-compare.ts`): runs A then C (C = the existing live path with judgments applied), writes `eval/results/compare-dev.json`, and prints:
   - per group: correct / confidently_wrong / handed_to_person / unscorable (counts of 12), and calls used;
   - one row per question: A outcome, C outcome, and one line why (for wrong ones, the first failing check; for handed ones, the first open item / A's reason);
   - the answering model per group (and how many times Nightshift answered with a model we did not request).
   `--dry-run` prints the call estimate and cache probe only.
6. Tests (no network, fake provider): A's prompt contains no record after `as_of`; A `cannot_tell` + failing → handed_to_person, `cannot_tell` + passing → correct; A prose after retries → unscorable; C with open items + failing → handed_to_person, without open items → confidently_wrong; A's quotes go through `matchCards` with the unchanged threshold.

## Do not

- Call any model. Install packages. Edit gold, data, vocab, `RULES`, `review/judgments.jsonl`. Read `.env`.
- Change the scoring rules after step 0's commit. If something in them turns out impossible to implement, stop and tell the reviewer; do not quietly adapt.
- Commit the 011 code yet.

## Done when

- Step 0 commit line.
- typecheck + tests.
- `npm run eval:compare -- --subset dev --dry-run --max-calls 150` output (estimate + cache probe), and the exact command for Ciki.

## If this finishes early — expansion ladder (Ciki, 2026-10-23 09:24 CDT)

The scope above is sized for "we may not finish". If the 12-question A/C run is done and reviewed with time left, expand in this order, one rung at a time, each with a dry-run estimate shown to Ciki before she runs it:
1. A and C on all 80 questions (one run each) — same pre-registered rules, no changes.
2. Group B (H-MEM as is): first find out whether its `add()` / retrieval calls a model; then run it on the dev 12, then on 80.
3. Repeats (3 per question) and bootstrap confidence intervals on the totals, as in the original design.
Build the code so that `--subset full` and a later `--group b` need no redesign.
