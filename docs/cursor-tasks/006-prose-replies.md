# Task 006 — Prose replies are being read as "no decision here"

Everything below the line is the task.

---

## Why (reviewer, 2026-10-22 18:16 CDT, read-only audit)

First real ingest: 47 cards. Scored with our own `src/eval/extraction-score.ts` against `eval/gold/gold_cards.jsonl`: **precision 0.383, recall 0.18 (18 of 100 matched)**. All 83 gold records are extractable and were ingested; 54 of them produced no card at all.

Root cause, from `cache/` (163 entries):

- Many replies are not JSON. They are a numbered plan of what the model *would* do, e.g. for `rec-0005`: `1. Parse record metadata … 5. Copy each sentence exactly … 6. Assemble the JSON cards array; return {"cards":[]} only if no decision … is present.`
- `extractJson` (`src/llm/json.ts`) takes **the first complete JSON value anywhere in the text**. In these plans that is the `{"cards":[]}` quoted from our own instruction. It parses, it passes the schema, so `client.json()` accepts it and **caches it** as a good reply. The record is silently recorded as "nothing here". A rerun replays the same cached plan.
- Count of extraction replies (contain `cards`) in the cache, by shape → what the current parser returns:

  | reply shape | model | parsed as |  n |
  |---|---|---|---|
  | prose plan | ultra-550b | 0 cards | 51 |
  | prose plan | ultra-550b | >0 cards | 10 |
  | prose plan | super-vl-120b | 0 cards | 8 |
  | prose plan | lightning-30b | 0 cards | 4 |
  | JSON | lightning-30b | >0 / 0 cards | 16 / 11 |
  | JSON | super-vl-120b | >0 / 0 cards | 5 / 3 |

  ultra-550b answered prose in essentially every extraction call. The 9 `reply must be an object` rejections in `state/ingest-report.json` are the same disease where the first bracket was an array.

This is the failure shape we must never ship: bad input, clean-looking output. Fix the general logic. **Do not edit gold, data, or vocab.**

## Build

1. **Strict reply shape** in `src/llm/json.ts`: a reply is usable only if, after trimming, it starts with `{` or `[`, or the JSON sits inside a ``` fence. Anything else throws `reply was prose, not JSON` (so `client.json()` retries with the existing "Reply with the JSON object only" nudge, and nothing is cached). Update the header comment. Check every caller of `extractJson` still works; if one truly needs the lenient behaviour, give it an explicitly named lenient function — no silent default.
2. **Prompt**: in the shared system prompt used by all agents (`src/agents/shared.ts` or where the researcher's `Return JSON only` lives), add one line: the first character of the reply must be `{`; do not list steps or explain. Keep the rest of the prompts unchanged.
3. **Cache audit** `scripts/cache-audit.ts` + `npm run cache:audit -- [--quarantine]`: re-parse every `cache/*.json` with the strict parser; print counts by model × (ok / prose / invalid). With `--quarantine`, **move** (never delete) failing entries to `cache/_quarantined-<YYYY-MM-DD>/` and print how many moved. `cache/samples/` is out of scope — report it, do not touch it.
4. **Make it loud**: `IngestReport` gets `records_prose_reply` (records whose final attempt was still prose). `npm run ingest` prints it next to `records_rejected`, and `complete` is false if it is non-zero. Same counter for pairs if the judge path uses `client.json()`.
5. **Tests** (vitest, no network): the exact `rec-0005` plan text above as a fixture → throws; the same JSON inside a ``` fence → parses; bare JSON → parses; `[`-first reply for a schema expecting an object → still rejected with the schema message.

6. **Addendum (reviewer, after Ciki's 12-question `eval:live` finished at 18:5x CDT; 51/120 calls)** — live scoring compares model card ids with gold card ids directly (`src/eval/scoring.ts` `current_card` / `in_effect_card` / `reasons`). Model ids look like `m.rec-0200.0.0`, gold ids like `card.rm.labor.new`, so live can never score above 0 on these even when the answer is right. Seen in this run: `q-t10-rm-may` picked exactly the right two cards (same record, same mode, same quote) and was marked wrong on both. Fix: in the live path only, translate model card ids to gold ids with `matchCards` from `src/eval/extraction-score.ts` (same record + mode + quote overlap, one-to-one) before scoring; an unmatched model card stays as its own id and counts as wrong. Oracle path unchanged (it already uses gold ids). Add a test: a model card with a matching quote scores `current_ok`; one with a different quote does not. **Do not change the 0.8 threshold** — that is Ciki's call (see below).

## Do not

- Run `ingest`, `eval:live`, or anything that calls a model. Ciki runs those herself.
- Touch `cache/` while `eval:live` is running (`pgrep -f eval-live` must print nothing before step 3 runs with `--quarantine`).
- Read `.env`.

## Done when

- `npm run typecheck` and `npm test` pass (paste the summary lines).
- `npm run cache:audit` output pasted (before quarantine), then `--quarantine` output pasted.
- `npm run eval:oracle` still 80/80 (it does not call models).
- One paragraph: how many extraction calls the next ingest will need (= quarantined entries), so Ciki can budget it, and the per-model prose rate so she can decide the model order.
