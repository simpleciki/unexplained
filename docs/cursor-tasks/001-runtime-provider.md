# Task 001 — Model provider layer + Meterless Runtime smoke test

Paste everything below the line into Cursor (Agent mode). Do not run the smoke test yourself; the human runs it.

---

You are working in a brand-new, empty TypeScript repository. All data in this project will be synthetic. Follow `.cursor/rules/00-isolation.mdc` at all times.

## Goal

Build the smallest model-provider layer this project needs, with Meterless Runtime as the primary provider, plus one smoke-test script. No agent logic yet.

## Setup

- Node 26, TypeScript, ESM, `tsx` for running scripts, `vitest` for tests. No web framework.
- `package.json` scripts: `typecheck`, `test`, `smoke:runtime`.
- Add `.env.example` with `METERLESS_BASE_URL=http://127.0.0.1:8088/v1`, `METERLESS_RUNTIME_TOKEN=`, `METERLESS_APP_ID=unexplained`. Never create a real `.env`; never print the token.

## Provider contract (Meterless Runtime 1.4, provider contract v4 — implement exactly)

File: `src/llm/meterless.ts`, behind an interface in `src/llm/provider.ts`:

```ts
export interface ChatProvider {
  id: string;
  status(): Promise<"online" | "unauthorized" | "offline">;
  listModels(): Promise<string[]>;
  chat(req: { model: string; system?: string; user: string; temperature?: number }): Promise<{ text: string; model: string; latencyMs: number }>;
}
```

1. Provider id `meterless`, name `Meterless Runtime`, default base URL `http://127.0.0.1:8088/v1`.
2. Normalise any configured URL (with or without scheme; ending in `/v1`, `/v1/chat/completions`, `/v1/models`, or `/healthz`) to `<scheme>://<host>:<port>/v1`. Never produce `/v1/v1`. Unit-test this with at least 8 cases.
3. Every request sends `Authorization: Bearer <token>` and `meterless-app: unexplained`. Chat requests also send `meterless-scope: user`. Reject the placeholder token `rt-local` before sending.
4. Model ids are routing modes, not models: `meterless/auto`, `meterless/fast`, `meterless/deep`, `meterless/cheap`, `meterless/local`, `meterless/fusion`, and `meterless/<class>[.<disposition>]`. Read them from `GET /v1/models`; keep any `meterless/*` id you do not recognise.
5. `status()`: `GET /v1/models` decides. 401 or 403 → `unauthorized`; 200 with at least one `meterless/*` id → `online`; anything else (including network error) → `offline`. `GET /healthz` is only a liveness hint, never the decision.
6. Plain text requests are an OpenAI-style chat completion with a string `content`. Timeout 180 s (model load can take minutes). On timeout or 5xx: one retry after 2 s, then throw a typed `ProviderError` with `kind: "timeout" | "http" | "unauthorized" | "offline"`.
7. Client-side rate limit: at most 30 requests per minute (the upstream NVIDIA free tier allows 40).

## Trace logging (required by the hackathon; must be produced by real runs, never hand-written)

`src/trace.ts`: append JSONL to `logs/trace-<run_id>.jsonl` with fields `timestamp, run_id, phase, agent, action, input_ref, output_ref, outcome, retry_count, latency_ms`. Never log tokens, headers, or full prompts; log a SHA-256 of the prompt as `input_ref`.

## Smoke test

`scripts/smoke-runtime.ts`, run with `npm run smoke:runtime`:
1. Print the normalised base URL.
2. Call `status()` and print it.
3. If online: print the model ids, then send ONE request on `meterless/auto` with user text `Reply with exactly: runtime ok` and print the reply and latency.
4. Write the trace file and print its path.
5. Exit code 0 only if the reply is a non-empty string.

It reads the token from the environment variable `METERLESS_RUNTIME_TOKEN` only.

## Done when

- `npm run typecheck` and `npm test` pass (URL normalisation, status mapping for 200/401/403/500/network error with a mocked `fetch`, `rt-local` rejection, retry-once behaviour).
- `npm run smoke:runtime` with a wrong token prints `unauthorized`, not `offline` (the human will check this).
- No file outside this repository was read. No real `.env` was created.

Show me the file list and test output when finished. Do not run `smoke:runtime`.
