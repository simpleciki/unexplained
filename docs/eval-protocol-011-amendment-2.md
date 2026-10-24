# Evaluation protocol 011 — Amendment 2 (2026-10-24, before the full run)

Amends `docs/eval-protocol-011.md` (commit 0d8bc73), read together with Amendment 1 (commit d1985f6). Neither
file is edited. This amendment changes only the route of the `--subset full` run (all 80 gold questions).
Everything else, including every scoring rule and outcome definition, is unchanged.

## The change

The full run uses the direct NVIDIA route, for both groups:

```
AI_PROVIDER=nvidia-direct npm run eval:compare -- --subset full --max-calls 900
```

- **Route**: `nvidia-direct` (NVIDIA's OpenAI-compatible endpoint, `src/llm/nvidia-direct.ts`). Nightshift is not
  used in this run. Group A and group C use the same route.
- **Model order**: `nvidia/nemotron-3.5-lightning-30b-a3b` only. The protocol's default order is
  "lightning → super; ultra never". On this route super is not available to this account (direct calls to
  `nemotron-3-super-120b-a12b` return 404 "Not found for account", checked 2026-10-23), so the order is
  lightning alone. Ultra stays excluded, as before.
- **Request settings on this route**: `max_tokens` 4096 (as `NVIDIA_MAX_TOKENS` in the code); thinking left on
  (no `NVIDIA_DISABLE_THINKING`), as in the dev run. No `/no_think`, no `response_format`. Prompts unchanged.
- **Cache**: the same response cache as before, unchanged. A reply served from the cache is recorded with
  route `cache` and the model that originally answered it, so cached replies stay visible in the trace.
- **Budget**: at most 900 model calls. The dry-run on 2026-10-24 estimated 363 calls without retries and 886 in
  the worst case (every call retried), so the budget is set above the worst case and should never cut the run
  short. If it still runs out, the questions not reached are listed as not run; they are not scored and not
  re-run under this amendment.
- **No re-runs**: one run per group per question, as in the protocol. A question that ends `unscorable` stays
  `unscorable`.

## Why

The dev run (2026-10-23, through Nightshift 1.2.2) lost 6 of 24 answers to Nightshift stopping the request
before the first token ("The model sent no first token within the cloud first-token limit, so the lane was
stopped"). Nightshift's signed receipts show 19 such `ttfb_timeout` failures on lightning-30b between 11:21 and
12:49 CDT. Meterless has said the fix (configurable timeouts, exact model selection, thinking controls) ships in
the release planned for Sunday evening, 25 October (PST), which leaves too little time before the 27 October
deadline.

Meterless (Sam Cummings, Help Meterless channel, 2026-10-23): "Using NVIDIA directly for Nemotron calls is fine
from a technical standpoint." Nightshift stays the product's primary, default AI provider; this route is used for
this evaluation run only, and the result file records `route: nvidia-direct`.

## What this means for comparing results

The dev result (Nightshift, lightning plus cached super-vl replies) and the full result (direct, lightning only)
are different runs on different routes. They are reported separately and are not pooled.

## When

Written on 2026-10-24 at 09:0x CDT (America/Chicago), before the full run: no `eval/results/compare-full.json`
existed when it was written. Approved by Ciki on 2026-10-24 ("80 题全量现在走直连 NVIDIA，先写好带日期的修订再跑").
