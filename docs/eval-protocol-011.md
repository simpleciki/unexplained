# Evaluation protocol 011 — A (model reads everything) vs C (our engine)

Pre-registered 2026-10-23 (America/Chicago) for task card `docs/cursor-tasks/011-compare-a-vs-c.md`.

**These rules were committed before the first A/C run; they are not changed after seeing results.**
If a rule turns out impossible to implement, the run stops and the reviewer decides; nothing is adapted
quietly. Any later change is a new, dated protocol file, never an edit of this one.

## Questions and groups

- Questions: `subsetQuestions(root, "dev")` (12) first. The same rules apply unchanged to `--subset full`
  (all 80 gold questions) and to any later group B (H-MEM as is) or repeated runs (the expansion ladder in
  `docs/cursor-tasks/011-compare-a-vs-c.md`).
- **Group A**: one model call per question. The model reads the records itself and answers in a fixed JSON
  shape. No engine, no cards, no seat graph.
- **Group C**: the engine — ingested model cards with human judgments applied (`review/judgments.jsonl`),
  seat graph, detectors, Router / Judge / Explainer / Skeptic, as in `eval:live`.
- One run per group per question. Same runtime, same default model order (lightning → super; ultra never),
  same cache. The answering model is recorded per call.

## Inputs and cut-off

- Both groups see only records with `source_recorded_at <= as_of` of the question (`as_of` null = all
  records). The number of records each group was given is printed per question.
- For C this means the engine for a question is built only from cards whose record was written by `as_of`
  (on top of the engine's own `decided_at <= as_of` rule), so a decision logged late is not seen early.
- **The document in hand.** Whatever document C's engine treats as the one in hand for a question (the quote
  version or invoice `focusOf` picks), A receives the same document. When it was written after `as_of` (a
  draft sent shortly after, as in "Before I send v3 …"), it is labelled "the document in hand (not sent
  yet)"; otherwise it is already among the records. (In the dev set this applies once: q-p1-nl02-send-v3,
  v3 sent 10:15, `as_of` 10:00.)

## Group A's prompt and reply

The prompt gives: the role (a contractor's office gatekeeper checking a quote or invoice before it goes
out), the question and its date, the records up to the cut-off (record id, type, author, time, text), the
seven patterns P1–P7 in one line each, and the reply shape:

```
{"verdict": "warn" | "clear" | "cannot_tell",
 "flags": ["P1", ...],
 "current": {"record_id", "quote", "mode"} | null,
 "in_effect": {"record_id", "quote", "mode"} | null,
 "reasons": [{"record_id", "quote", "mode"}],
 "cannot_tell_because": "..." | null}
```

It says plainly that `cannot_tell` is allowed and expected when the records do not settle the question.
The reply goes through the strict parser with the usual retries.

Reasons carry `mode`, like `current` and `in_effect`: the unchanged `matchCards` rule requires the same
record, the same mode and ≥ 0.8 quote overlap, so a reason without a mode could never match.

## One yardstick

- A's `current`, `in_effect` and each reason become cards (`record_id`, `quote`, `mode`) and are mapped to
  gold card ids with `matchCards` (same record, same mode, quote overlap ≥ 0.8 — the existing rule and
  threshold, unchanged). An unmatched one keeps its own id and so counts as wrong. A's `flags` are the
  predicted flags.
- C is "engine + human judgments". Its answer cites model cards and human-confirmed cards; all of them are
  mapped with the same `matchCards`. (Model extraction precision / recall elsewhere stays model-only; this
  mapping is only for scoring answers.) The result shows, per question, how many human-confirmed cards C
  cited. Fact checked on 2026-10-23 at commit time: `review/judgments.jsonl` holds 13 judgments, all on
  WO-NL-01; none of the 12 dev questions is about WO-NL-01; 4 of the 80 full-set questions are
  (q-t2-nl01-asof, q-ctrl-nl01-send, q-ctrl-nl01-inv, q-ctrl-nl01-ground).
- Both are scored with the existing `scoreQuestion`.

## Outcomes (every answer gets exactly one)

| outcome | rule |
|---|---|
| `correct` | `scoreQuestion(...).why` is empty (warnings recalled, no CTRL false alarm, current, in effect, reasons). Time tags are reported next to it, as in `eval:oracle`, and are not part of passing. |
| `handed_to_person` | not correct, AND — A: `verdict == "cannot_tell"` with a non-empty `cannot_tell_because`; C: `open_items` is non-empty and listed in the answer. |
| `confidently_wrong` | not correct and not handed to a person. |
| `unscorable` | no usable reply: A — prose after retries, upstream failure or invalid shape; C — the Router had no usable reply (prose after retries, upstream failure or invalid shape). Listed, never counted as right or wrong. |

A `cannot_tell` answer that passes the checks (for example a CTRL question with no flags) is `correct`.
Inside `correct`, **passed while abstaining** is counted separately for both groups, so a pass by abstaining
is never mistaken for a confident right answer: A — `verdict == "cannot_tell"`; C — `open_items` non-empty
(the check is "Not cleared").

### C's open items

No model call. For the jobs in the question's seats: the records routed to a person and not yet judged
(`needs_human`) and the open questions on the latest human judgments, both written by `as_of`. They are
listed in C's answer.

## Output

`npm run eval:compare -- --subset dev|full --max-calls N [--dry-run]` writes `eval/results/compare-<subset>.json`
and prints, per group, the counts of the four outcomes (with "passed while abstaining" inside `correct`) and
the calls used; per question, the records each group was given and the human-confirmed cards C cited; one row per question with both
outcomes and one line why (the first failing check, the first open item, or A's reason); and the answering
model per group with how often Nightshift answered with a model that was not requested.
