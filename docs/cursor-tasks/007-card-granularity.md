# Task 007 — One decision, one card (extraction prompt), tried on a 12-record sample first

Everything below the line is the task. Do step 0 first and report its result before step 1.

---

## 0. Commit Task 006 first (Ciki approved, 2026-10-22 21:48 CDT)

Commit everything from Task 006 and the model-order change as one or a few Conventional Commits, for example
`fix(llm): reject prose replies instead of reading quoted JSON as an empty answer`. Include the task cards in `docs/cursor-tasks/`.
Do not commit `.env`, `cache/`, `state/`, `logs/`, `docs/session-archive/` (check `.gitignore` covers them; `git status` must not list them as staged).
After committing, run `git log -3 --format='%ai %h %s'`: the offset must be `-0500`. If it shows `+0000`, amend the date to local time (nothing is pushed; there is no remote).
Paste the `git log` lines.

## Why (reviewer, 2026-10-22 21:4x CDT)

Second ingest (169 calls): 77 cards, precision 0.364, recall 0.28. Of the 49 model cards that match no gold card:

| cause | cards | example |
|---|---|---|
| one decision split into sentence cards | ~23 | gold `Fine. Swap the heater.` (one card); model `Fine.` + `Swap the heater.` — both below 0.8 overlap, both counted wrong |
| right quote, different mode | 11 | `Helen approved Q-OC-04-v1 on 22 April at 14:10.` model `mentions`, gold `decides` |
| different quote and mode | 10 | client's refusal: model `decides`, gold `gives_reason` |
| extra card on an already-matched record | 5 | a second `Approved.` |

Gold cards still missed, by mode: proposes 14/14, gives_reason 17/19, mentions 15/16, decides 26/51.

The first cause is **our spec contradicting itself**: `src/agents/researcher.ts` SYSTEM says "A card is one sentence-level statement", while `eval/gold/gold_cards.jsonl` (spec: `docs/cursor-tasks/002-synthetic-data.md` — quote is an exact substring of the record) uses the whole span that states one decision, often two or three sentences. The model follows our prompt. The product also wants the full span: a gatekeeper quoting "Fine." alone explains nothing.

## Build

1. **Prompt** (`src/agents/researcher.ts` SYSTEM only; do not touch `RULES` in shared.ts, so other agents keep their cache):
   - A card is **one decision, reason, proposal or report**. Its `quote` is the shortest exact span of the record that states it completely — usually one or two sentences. Do not split one decision into several cards; do not merge two different decisions into one card.
   - One short definition for each mode, written so the boundaries are clear:
     - `decides` — the person with authority (client reviewer) decides, approves, rejects or sets/withdraws a rule, in their own words.
     - `gives_reason` — someone states why: why a quote was rejected, why a price changed, why something is needed. A refusal that comes with its cause is the reason; keep the decision itself as its own `decides` card only if it is a separate statement.
     - `proposes` — a promise, offer or plan about the future ("we'll inspect again", "I'll tell you either way", a submitted quote).
     - `mentions` — the writer reports a decision someone else made ("Ria said on the call that v3 is approved").
   - One worked example per mode. **Invent the examples** (different names, jobs, amounts). Do not copy or paraphrase any text from `data/records/` — the sample below is evaluated on those records, and an example taken from them would leak the answer.
2. **Sample mode** for ingest: `npm run ingest -- --records <id,id,...> --out state/sample-007 [--max-calls N]`. Runs Researcher.extract + Skeptic.cards for those records only (no Keeper), writes cards and the report to the `--out` directory, and **never** touches `state/cards.json` or other `state/` files. At the end it prints, for exactly those records: extraction precision/recall against gold (gold restricted to those records), and the same numbers for the current `state/cards.json` restricted to those records, side by side, plus per-mode matched counts. The cache works as usual (the new prompt means new keys; old entries stay).
3. **Suspected gold**: the "right quote, different mode" cards (list them from the current `state/cards.json` with `matchCards` logic: same record, quote overlap ≥ 0.8, mode differs). Print them with the record text so Ciki can judge each one. **Do not edit gold.** Add them to `SUSPECTED_GOLD_ERRORS` only after Ciki rules.
4. Tests (no network): `--records` restricts to those ids; `--out` leaves `state/cards.json` byte-identical; the side-by-side score uses gold restricted to the sample.
5. Dry-run the sample (`--dry-run`) and paste the call estimate.

## The sample (12 records)

| record | why it is in the sample |
|---|---|
| rec-0028, rec-0043, rec-0112 | one decision, split into sentence cards last time |
| rec-0006, rec-0123, rec-0291 | `proposes`, never extracted |
| rec-0069 | refusal with reasons: model said `decides`, gold `gives_reason` |
| rec-0023, rec-0282 | `mentions`, never extracted |
| rec-0016 | quote right, mode disputed (`mentions` vs gold `decides`) |
| rec-0200 | control: last run got both cards exactly right — must not get worse |
| rec-0107 | control: gold says no decision here — must stay at 0 cards |

## Do not

- Call any model. Ciki runs the sample herself.
- Edit gold, data or vocab. Read `.env`.
- Change `RULES` in `src/agents/shared.ts` (cache keys of every other agent).

## Done when

- Step 0 `git log` lines pasted.
- typecheck + test summary lines.
- The new SYSTEM prompt pasted in full (so the reviewer can check the examples are invented).
- Dry-run estimate for the sample, and the exact command Ciki pastes:
  `npm run ingest -- --records rec-0028,rec-0043,rec-0112,rec-0006,rec-0123,rec-0291,rec-0069,rec-0023,rec-0282,rec-0016,rec-0200,rec-0107 --out state/sample-007 --max-calls 40`
- The suspected-gold list (step 3) with record text.
