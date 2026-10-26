# Agent activity: how the agent reached its output

Every model call the agent makes is logged as one trace line. This folder holds two of those traces as the runs
wrote them, and step-by-step walkthroughs built from them, so you can follow one question from the first model
call to the scored answer. All data in this project is fictional.

| file | what it shows |
|---|---|
| [`q-p5-heron-why.md`](q-p5-heron-why.md) | "Otto has turned down all three Heron Court quotes. Why?" (job WO-PW-05), group A and group C |
| [`q-p5-heron-v4.md`](q-p5-heron-v4.md) | "What should Heron Court v4 fix before I send it to Otto?" |
| [`q-p7-heron-invoice.md`](q-p7-heron-invoice.md) | "Can we invoice anything on Heron Court yet?" |
| [`ingest-rec-0270.md`](ingest-rec-0270.md) | how Otto's third rejection (`rec-0270`, "Rejected.") became a decision card: extract → check → compare with the two earlier rejections |
| [`traces/trace-eval-compare-full-2026-10-24T21-44-49-432Z.jsonl`](traces/) | the full A-vs-C comparison run, 80 questions, NVIDIA direct route, 1,028 lines |
| [`traces/trace-ingest-2026-10-23T06-42-45-515Z.jsonl`](traces/) | the ingest of 2026-10-23 01:42 CDT through Nightshift (Meterless Runtime), 387 lines; it produced `state/` and `snapshot/ingest-2026-10-23/` |

## What a trace line means

```json
{"timestamp":"2026-10-24T21:44:49.437Z","run_id":"eval-compare-full-2026-10-24T21-44-49-432Z","phase":"compare",
 "agent":"GroupA","action":"model_call","input_ref":"7efbaa77…","output_ref":"",
 "outcome":"ok;cache=miss;route=nvidia-direct;requested=nvidia/nemotron-3.5-lightning-30b-a3b;model=nvidia/nemotron-3.5-lightning-30b-a3b",
 "retry_count":0,"latency_ms":45292}
```

- `phase`, `agent`: which step asked (`compare`/GroupA = one call reading the records; `answer`/Router, Skeptic.answer,
  Judge.explained, Explainer = the engine's answer path; `ingest`/Researcher.extract, Skeptic.cards, Keeper.relate).
- `outcome`: `ok` (a reply came back), `invalid` (the reply was not usable JSON or failed its schema; the next attempt
  quotes the error back), `error` (the route failed); then `cache` (`hit` = the reply was already on disk, no call),
  `route` (`nvidia-direct`, `nightshift`, or `cache`), `requested` (the mode or model asked for) and `model` (the model the
  route said answered). The 2026-10-23 ingest was written before `route`/`requested` were added, so those are blank there.
  `action: route_fallback` lines record a model that was dead or unavailable and the one used instead.
- `retry_count`: 0 for the first attempt, 1 and 2 for the retries after an unusable reply.
- `latency_ms`: measured time of that call. `timestamp` is when the run wrote its trace, which is at the end of the
  run for every line, so it is not the time of the call; the lines are in call order.
- `input_ref`: SHA-256 of the prompt (model, system, user). The prompt text, headers and keys are never logged.

## How the walkthroughs were built

`npm run activity:log -- --question <id>[,<id>] [--run <trace>]` and `npm run activity:log -- --record <rec-id> --run <trace>`.
No model call is made. The command runs the same comparison or ingest code on a temporary copy of `data/`, `state/`
and `review/`, reading replies from `cache/` and never writing it; a cache miss gets an unusable stand-in reply, which
is what the real run had when it kept no reply. That replay rebuilds each prompt, so the command can compute both its
trace hash (`input_ref`) and its cache file name (a different hash). A step appears in a walkthrough only when the
rebuilt hash equals a line in the trace; a rebuilt prompt that is not in the trace would be listed as "not found",
not guessed (all of them were found). The comparison run read its data through Zetaris, so the replay reads `data/`
in Zetaris row order (`ORDER BY` per table; the values are identical, see `../zetaris-parity-2026-10-25.txt`); the
page says which order matched.

Every table row is a trace line copied as the run wrote it (the left column is its line number in the copied trace).
Every reply is the cache file that step used, parsed, cut after 1,500 characters. The "how the run scored it" lines
come from `eval/results/compare-full.json`, written by the same run. Nothing on these pages was re-run or edited.

`npm run activity:log -- --copy-trace <trace>` copies a trace here after scanning every line for account ids,
NVIDIA keys (`nvapi-`), bearer tokens, local paths (`/Users/`), other API keys and NVIDIA's "not found for account"
error text, replacing anything it finds and listing it. For both traces above the scan found nothing to replace, so
the copies are byte-identical to the originals in `logs/`.
