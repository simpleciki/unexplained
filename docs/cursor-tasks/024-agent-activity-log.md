# Task 024 — A committed agent activity log judges can read

The organisers asked three times (22 and 24 October announcements, 26 October email) for "agent activity being
logged, so the judges can see how your agent reached its output". Every model call is already traced in `logs/`
(git-ignored), and replies are in `cache/` keyed by the same prompt hash (`input_ref`). Nothing reaches a judge yet.
No model calls. Do not change engine, prompts, verdicts, gold or `review/judgments.jsonl`. Do not commit.

## 1. Readable walkthroughs
`npm run activity:log -- --question <id> [--run <trace file>]` writes `evidence/agent-activity/<id>.md` from an existing
trace and the cache: every step in order (phase, agent, route, requested mode, model that answered, cache hit or
miss, latency, retry), and for each model call the parsed reply the step used (from the cache), truncated sensibly,
plus the records it cited. Make it for the questions about WO-PW-05 in the full run
(`logs/trace-eval-compare-full-2026-10-24T21-44-49-432Z.jsonl`), and one ingest walkthrough for a WO-PW-05 record
from the 2026-10-23 01:42 CDT ingest trace (`logs/trace-ingest-2026-10-23T06-42-45-515Z.jsonl`, Nightshift route).

## 2. Raw traces
Copy those two trace files to `evidence/agent-activity/traces/` after scanning them for account ids, keys, tokens, paths
and NVIDIA error text ("for account", `nvapi-`, `Bearer`, `/Users/`); redact what you find and list it. Add
`evidence/agent-activity/README.md`: what a trace line means, how the walkthroughs were built, and that every value comes
from the run as it happened.

## 3. Link
Report the one-paragraph wording for the README (the hub session edits README.md, you do not).

## Done when
typecheck clean, tests pass (add a test for the walkthrough builder on a small fixture), the walkthrough files listed
with their size, the scan reported, diff stat. Do not commit.
