# Task 004 — Model layer: Researcher, Keeper, Skeptic, Explainer (live, via Meterless Runtime)

Everything below the line is the task.

---

## Goal

Replace the oracle inputs from Task 003 with real model work, keep every deterministic check in front of and behind the model, and measure the drop from the oracle ceiling honestly. All model calls go through `src/llm/meterless.ts` (Meterless Runtime on `127.0.0.1:8088`, which routes to NVIDIA Nemotron). No other provider, no SDK, no direct NVIDIA endpoint.

## Ground rules

- **Call budget is a hard limit.** Every command that can call a model takes `--max-calls N` and refuses to run without it. Before the first call it prints a dry-run estimate (calls per stage, total). It stops cleanly at the budget and writes what it has.
- **Never run a live command yourself.** Build everything, test it with a fake provider, run the dry-run estimates, then stop and report. The human runs the live commands in their own terminal.
- **Cache.** Every model response is cached under `cache/` keyed by SHA-256 of (model id, system, user, temperature). Re-runs hit the cache first. `cache/` is gitignored except `cache/samples/` (see SAMPLE_MODE).
- **Temperature 0.** JSON outputs are validated against a schema; invalid JSON counts as one retry.
- **Trace.** Every call writes a trace event with stage, agent, prompt hash, cache hit/miss, retry count, latency, and the **model that actually answered** (the response `model` field). Never log the prompt text, headers or token.
- **Token.** The runtime token is read from `.env` (`METERLESS_RUNTIME_TOKEN`) via `node --env-file=.env`; never print it. `.env` is created by the human.
- The engine still never reads `eval/gold/`.

## Agents (each one file under `src/agents/`, each ≤200 lines)

| agent | input | output | deterministic gate after it | retry budget |
|---|---|---|---|---|
| Researcher.extract | one record (client_message, internal_note, field_note) + full vocab | 0..n candidate cards (mode, topic, facets, scope, decided_at phrase, effective phrase, decided_by, quote) | `verify.ts` (verbatim quote, keys, decider downgrade) + `time.ts` (phrase → interval, code not model) | 2 per record → `REJECTED` |
| Keeper.relate | two `decides` cards on the same seat | REPLACES / SAME / REFINES / UNRELATED + one-line reason | `seats.ts` orders by time; contradictions → `UNRESOLVED_CONFLICT` | 1 |
| Router | question + vocab + list of jobs/clients | question type, seats, focus quote or invoice id, as_of | seat keys must exist; unknown → `NOT_FOUND` | 1 |
| Judge.explained | one version diff from the P2 detector + the client-facing quote text | per changed line: explained / not explained + quote | quote must be verbatim in the quote record | 1 |
| Explainer | structured answer from `answer.ts` | short prose answer for the office gatekeeper (what will the client push back on, why, what to fix) that cites record ids | — | — |
| Skeptic | stage 1: each card used vs its source text; stage 2: each sentence of the prose vs the structured answer | supported / not supported + why | unsupported card → re-extract (Researcher, max 2); unsupported sentence → remove it and list it under "unresolved" | 2 per card, 2 per answer |

Rules the prompts must enforce (and the Skeptic must check): reasons only from `gives_reason` cards; say "the records do not say" instead of guessing; never conclude "too expensive" without the client saying so; never use the quote/invoice status column for a past date.

Model choice: `meterless/auto` for Researcher and Router; `meterless/deep` for Keeper, Judge and Skeptic if `/v1/models` lists it (else `auto`). Record which id answered.

## Pipeline commands

- `npm run ingest -- --max-calls N` — Researcher + Keeper over all records → `state/cards.json`, `state/edges.json`, seat graph, H-MEM snapshot.
- `npm run ask -- --question "..." [--as-of ISO] --max-calls N` — one question end to end → JSON + prose to stdout.
- `npm run eval:live -- --subset dev|full --max-calls N` — run the gold questions with model outputs instead of oracle inputs. `dev` = 12 questions: the 3 hero-case questions + one per pattern P1–P7 + one T10 + one CTRL. Score with the same scorer as `eval:oracle`, plus extraction precision / recall against gold cards (card match: same record, quote token overlap ≥ 0.8, same mode) and relation accuracy against gold edges. Write `eval/results/live-<subset>.json`. Print a side-by-side table: oracle vs live per metric.

## SAMPLE_MODE

`SAMPLE_MODE=true npm run ask -- --sample <id>` answers the 3 judge sample questions (`eval/gold/samples.json`) with no runtime and no token, from responses recorded in `cache/samples/`. Deterministic parts run for real. Any non-sample question in SAMPLE_MODE fails with "needs model credentials". Add `npm run record:samples -- --max-calls N` that fills `cache/samples/` from a live run.

## Cleanup (Guardian warning from the first commit)

Split files over 200 lines into modules without changing behaviour: `src/llm/meterless.ts`, `src/engine/seats.ts`, `src/eval/oracle.ts`. Data scripts in `scripts/` are exempt.

## Done when

- typecheck, all tests, `validate:data`, `eval:oracle` (still all pass) green; new agents have unit tests with a fake provider, including: invalid JSON retry, budget stop, cache hit, Skeptic removing an unsupported sentence, verbatim-quote rejection of a hallucinated card.
- Dry-run estimates printed for: `ingest`, `eval:live --subset dev`, `eval:live --subset full`, `record:samples`.
- Report the estimates and the exact commands the human should run, in this order: (1) `ingest`, (2) `eval:live --subset dev`. Then stop. No live calls, no commit, no push.
