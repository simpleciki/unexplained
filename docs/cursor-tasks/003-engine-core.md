# Task 003 — Deterministic engine core + H-MEM storage (no model calls)

Everything below the line is the task. No model API calls anywhere in this task; model-judged steps are fed from gold files ("oracle mode") so the deterministic layer can be measured on its own.

---

## Why this task exists

`unexplained` answers from decisions that are still in force. Some steps need a model (extracting cards from prose, judging whether two decisions replace each other, writing the explanation). Everything else is deterministic code, and this task builds all of it first. In **oracle mode** the model steps are replaced by the gold files (`eval/gold/gold_cards.jsonl` as extracted cards, `eval/gold/gold_edges.jsonl` as relation judgments). That gives the upper bound of the engine and proves the plumbing before any model is wired in.

Read first: `data/README.md`, `data/vocab.yaml`, the gold files, `src/llm/`, `src/trace.ts`, and `vendor/meterless-hmem/VENDOR.md`.

## Rules

- Never edit `vendor/meterless-hmem/src/`. Import it as `../../vendor/meterless-hmem/src/index.ts` and wrap it.
- Never read `eval/gold/` from inside `src/engine/` at answer time. Only `scripts/` and `src/eval/` may load gold files, and they pass them in explicitly as oracle inputs.
- Never use the `status` column of `quote_versions.csv` / `invoices.csv` to answer an as-of question (it is end-of-window state). Derive state from dated records.
- Time: every comparison uses explicit offsets; America/Chicago. A decision's order comes from `decided_at`, never from `source_recorded_at` or ingestion time.
- Write a JSONL trace for every run through `src/trace.ts` (real runs only).

## Modules (under `src/engine/`)

1. `types.ts` — `SourceRecord`, `DecisionCard`, `Seat` (`topic|facet|scope`), result enum: `PASS`, `REPLACED_BY_SUCCESSOR`, `UNRESOLVED_CONFLICT`, `NOT_FOUND`, `OUT_OF_SCOPE`, `REJECTED`.
2. `time.ts` — parse ISO datetimes and coarse forms (`2026-05`, `2026-W19`, `2026-Q2`, date-only) into closed intervals; `compare(a, b)` → `before | after | overlap | incomparable` (null → incomparable). Unit tests with the four cases in the design (3/4 vs 3/15 before; March vs 3/15 overlap; week vs later day before; unknown incomparable).
3. `vocab.ts` — load `data/vocab.yaml`; validate topic / facet / scope keys; scope parent chain (`job → client → global`); decider check (a `decides` card whose `decided_by` is not in `deciders[topic]` is downgraded to `mentions`, with a trace event).
4. `verify.ts` — quote check: normalise whitespace, curly quotes and NFC, then the quote must be a substring of the record text; key check; decider check. Rejected cards get `REJECTED` with a reason.
5. `seats.ts` — the seat graph:
   - project every `decides` card onto each `(topic, facet, scope)` seat;
   - relations come in as input (oracle: gold edges). Only `REPLACES` pairs are ordered by `decided_at`; `overlap` → explicit-reference wins, otherwise `UNRESOLVED_CONFLICT`; `incomparable` → that pair only is `UNRESOLVED_CONFLICT`; a replacement that predates what it replaces → `UNRESOLVED_CONFLICT`;
   - `current(seat)`, `inEffect(seat, D)` (latest card on the chain whose `effective` start ≤ D), `asRecorded(seat, D)` (rebuild using only cards whose record `source_recorded_at` ≤ D);
   - scope fallback: an empty job seat falls back to the client seat, then global, and the answer says so.
   Unit tests: partial replacement (labor new, material old), revert A → B → A′, two coexisting facets that must not conflict, decided-but-not-yet-effective (answer old value and name the scheduled change), late record ordered by `decided_at`.
6. `detectors.ts` — deterministic evidence for each pattern, from tables + cards as of D. Each detector returns `{ pattern, fired, evidence: record_ids[], details }`:
   - P1 open promise: a `proposes` card on `open_item` with no later replacing card in its seat as of D; list the quotes that still price the dependent item.
   - P2 version change: line-level diff between consecutive versions (added / removed / changed qty or unit price, delta in dollars). Whether the client-facing text explains a change is a model judgment: in oracle mode take it from `expected_client_explanation`; report the diff either way.
   - P3 no progress: the same open item appears across ≥2 versions with no result card.
   - P4 rule broken: client rules in force as of D checked against submission events and quote totals (recipients / copy list, portal vs email, pre-approval cap, quiet period). Withdrawn rules ignored.
   - P5 unexplained rejection: rejection with no `gives_reason` card → list candidate causes with evidence (voids / recreations / mismatched ids / repeated notices, price deltas, scope growth, open promises). Never pick one cause.
   - P6 off-norm: the client's norm per trade = line kinds and order, labor/material split and amount range, built ONLY from that client's approved versions as of D (respecting a later explicit structure instruction); compare the new version.
   - P7 invoice mismatch: find the approved version as of the invoice date; diff invoice lines against it; flag invoices built from voided / rejected / unapproved versions, and unbilled work not on any approved version.
7. `memory.ts` — after the seat graph is built, write every accepted card into H-MEM (`new HMEM({ clock })`), idempotent by `card_id`: `add({ content: quote, type: "factual", source: record_id, provenance: { origin: "document", learnedAt: <decided_at ms>, label: record_id, refs: [card_id] }, tags: [topic, ...facets, scope] })`; for each `REPLACES` edge set `supersedes` on the new memory and `update(old, { supersededBy: new })`. If H-MEM auto-links a different `supersedes`, overwrite it with ours and log the override to its trust ledger. The seat table (`state/seats.json`) is the authority; on any disagreement, log a drift event. Save `state/hmem-snapshot.json` via `snapshotAll()`. This is the Meterless engine doing real work (storage, provenance, supersession audit), so add a test that reads a superseded card back and checks `supersededBy`.
8. `answer.ts` — assemble the structured answer for one question (no prose yet): `{ question_id, as_of, seats: [{ seat, state, current_card, in_effect_card, chain, reasons, scope_fallback }], flags: [{ pattern, evidence }], unresolved: [] }`.

## Oracle evaluation

`src/eval/oracle.ts` + `npm run eval:oracle`: for every gold question, run the engine with gold cards + gold edges as inputs and `as_of` as the clock, then score:

| metric | rule |
|---|---|
| flags exact | predicted flag set == `expected_flags` |
| flags precision / recall | per pattern, over all questions |
| current card | == `expected_current_card` |
| in-effect card | == `expected_in_effect_card` |
| reasons | predicted reason cards ⊇ expected (treat `not_recorded` as "no reason card") |
| false alarms on CTRL | any flag on a CTRL question counts as a failure |

Write `eval/results/oracle.json` and print a table per pattern. **Report the numbers as they are**; list every failing question with one line on why. Do not edit gold files to make the score go up; if a gold answer looks wrong, list it separately as "suspected gold error" with the record ids.

## Done when

- `npm run -s typecheck`, `npx vitest run`, `npm run validate:data` all pass.
- `npm run eval:oracle` runs end to end and writes the results file and a trace file.
- Show me: the per-pattern table, the overall numbers, the failing questions, and any suspected gold errors. Do not commit or push.
