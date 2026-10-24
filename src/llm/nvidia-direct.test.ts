// AI_PROVIDER=nvidia-direct, with a fake fetch (no network). The key used here is a made-up test value.
import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadDataset } from "../engine/data.ts";
import { runCompare } from "../eval/compare.ts";
import { makeRuntime, providerLine, routeFromEnv, routeLines, writeTrace } from "../pipeline/runtime.ts";
import { CallBudget, ModelClient } from "./client.ts";
import { MemoryCache } from "./cache.ts";
import { candidateModes, EXCLUDED_MODELS } from "./modes.ts";
import { NVIDIA_DIRECT_ORDER, NVIDIA_DIRECT_URL, NvidiaDirect } from "./nvidia-direct.ts";
import { ProviderError } from "./provider.ts";

const KEY = "test-key-not-real-0123456789";
type Sent = { url: string; init: RequestInit };

function fakeFetch(reply: (n: number) => { status?: number; body: unknown }) {
  const sent: Sent[] = [];
  const f = (async (url: string, init: RequestInit) => {
    sent.push({ url, init });
    const r = reply(sent.length);
    return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { f, sent };
}
const answer = (content: unknown, reasoning: unknown = "Let me think about the records first.") => ({
  model: "nvidia/nemotron-3.5-lightning-30b-a3b",
  choices: [{ message: { role: "assistant", content, reasoning_content: reasoning } }],
});
const req = { model: "nvidia/nemotron-3.5-lightning-30b-a3b", system: "You extract", user: "Record rec-1", temperature: 0 };

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("AI_PROVIDER", () => {
  it("defaults to nightshift; only an explicit nvidia-direct switches; anything else is an error", () => {
    expect(routeFromEnv(undefined)).toBe("nightshift");
    expect(routeFromEnv("")).toBe("nightshift");
    expect(routeFromEnv("nightshift")).toBe("nightshift");
    expect(routeFromEnv("nvidia-direct")).toBe("nvidia-direct");
    expect(() => routeFromEnv("nvidia")).toThrow(/AI_PROVIDER must be nightshift/);
    expect(providerLine("nvidia-direct")).toBe("provider: nvidia-direct (Nightshift is NOT used in this run)");
  });
});

describe("nvidia-direct provider", () => {
  it("sends the OpenAI-compatible request: URL, bearer key from the options, model, messages, max_tokens", async () => {
    const { f, sent } = fakeFetch(() => ({ body: answer('{"cards":[]}') }));
    const p = new NvidiaDirect({ apiKey: KEY, fetch: f, sleep: async () => {} });
    const r = await p.chat(req);
    expect(r).toMatchObject({ text: '{"cards":[]}', model: "nvidia/nemotron-3.5-lightning-30b-a3b" });
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe(NVIDIA_DIRECT_URL);
    expect(sent[0].url).toBe("https://integrate.api.nvidia.com/v1/chat/completions");
    expect(new Headers(sent[0].init.headers).get("authorization")).toBe(`Bearer ${KEY}`);
    const body = JSON.parse(String(sent[0].init.body));
    expect(body).toEqual({ model: req.model, messages: [{ role: "system", content: "You extract" }, { role: "user", content: "Record rec-1" }], max_tokens: 4096, temperature: 0 });
  });

  it("adds enable_thinking=false only with NVIDIA_DISABLE_THINKING", async () => {
    const { f, sent } = fakeFetch(() => ({ body: answer("{}") }));
    await new NvidiaDirect({ apiKey: KEY, fetch: f, disableThinking: true }).chat(req);
    expect(JSON.parse(String(sent[0].init.body)).chat_template_kwargs).toEqual({ enable_thinking: false });
  });

  it("uses content only: reasoning_content is never the answer; empty content is no valid reply", async () => {
    const { f } = fakeFetch((n) => ({ body: n === 1 ? answer(null, '{"cards":[{"looks":"like json"}]}') : answer("") }));
    const p = new NvidiaDirect({ apiKey: KEY, fetch: f });
    expect((await p.chat(req)).text).toBe("");
    expect((await p.chat(req)).text).toBe("");
    // Through the client: an empty answer is invalid, retried, and never cached.
    const { f: f2 } = fakeFetch(() => ({ body: answer(null, '{"cards":[]}') }));
    const events: { outcome: string }[] = [];
    const client = new ModelClient(new NvidiaDirect({ apiKey: KEY, fetch: f2 }), new MemoryCache(), new CallBudget(10), (e) => events.push(e), { modeOrder: NVIDIA_DIRECT_ORDER, route: "nvidia-direct" });
    const out = await client.json({ stage: "ingest", agent: "Researcher.extract", model: "meterless/auto", system: "You extract", user: "Record rec-1" }, (v) => v, 2);
    expect(out.value).toBeNull();
    expect(events.filter((e) => e.outcome === "invalid")).toHaveLength(3);
  });

  it("never puts the key in a log line or an error message", async () => {
    const logs: string[] = [];
    for (const m of ["log", "warn", "error", "info"] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a.join(" ")));
    const { f } = fakeFetch(() => ({ status: 404, body: { status: 404, title: "Not Found", detail: "Function '84bf12ff': Not found for account 'acct-999'" } }));
    const err = await new NvidiaDirect({ apiKey: KEY, fetch: f }).chat(req).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).kind).toBe("route_unavailable");
    expect((err as ProviderError).message).not.toContain(KEY);
    expect((err as ProviderError).message).not.toContain("acct-999"); // the account is redacted too
    const { f: f401 } = fakeFetch(() => ({ status: 401, body: { detail: "Unauthorized" } }));
    const e401 = await new NvidiaDirect({ apiKey: KEY, fetch: f401 }).chat(req).catch((e) => e);
    expect((e401 as ProviderError).kind).toBe("unauthorized");
    expect(String((e401 as Error).message)).not.toContain(KEY);
    expect(logs.join("\n")).not.toContain(KEY);
  });

  it("keeps ultra excluded and refuses routing modes", async () => {
    const { f, sent } = fakeFetch(() => ({ body: answer("{}") }));
    const p = new NvidiaDirect({ apiKey: KEY, fetch: f });
    expect(EXCLUDED_MODELS).toContain("nvidia/nemotron-3-ultra-550b-a55b");
    expect(NVIDIA_DIRECT_ORDER).not.toContain("nvidia/nemotron-3-ultra-550b-a55b");
    await expect(p.chat({ ...req, model: "nvidia/nemotron-3-ultra-550b-a55b" })).rejects.toThrow(/excluded/);
    await expect(p.chat({ ...req, model: "meterless/auto" })).rejects.toThrow(/not an NVIDIA model id/);
    expect(sent).toHaveLength(0);
    expect(candidateModes("meterless/auto", { order: ["nvidia/nemotron-3-ultra-550b-a55b", ...NVIDIA_DIRECT_ORDER] })).toEqual(NVIDIA_DIRECT_ORDER);
  });
});

describe("route in the runtime, trace and results", () => {
  it("prints the route, records it on every call and in the trace; cache keys do not depend on it", async () => {
    const root = mkdtempSync(join(tmpdir(), "unexplained-direct-"));
    const { f, sent } = fakeFetch(() => ({ body: answer('{"ok":true}') }));
    const rt = await makeRuntime(root, { maxCalls: 5, sampleMode: false, provider: new NvidiaDirect({ apiKey: KEY, fetch: f }) });
    expect(rt.route).toBe("nvidia-direct");
    expect(rt.modeOrder).toEqual(NVIDIA_DIRECT_ORDER);
    expect(routeLines(rt)[0]).toBe("provider: nvidia-direct (Nightshift is NOT used in this run)");
    expect(routeLines(rt)[1]).toBe("Researcher.extract: nvidia/nemotron-3.5-lightning-30b-a3b (the nvidia-direct order)");
    const spec = { stage: "ingest", agent: "Researcher.extract", model: "meterless/auto", system: "You extract", user: "Record rec-1" };
    await rt.client.json(spec, (v) => v, 0);
    expect(rt.events.at(-1)).toMatchObject({ route: "nvidia-direct", requested: "nvidia/nemotron-3.5-lightning-30b-a3b", model_answered: "nvidia/nemotron-3.5-lightning-30b-a3b", cache: "miss" });
    // Same prompt again: a cache hit, under the key of the mode the agent asked for (not the route).
    await rt.client.json(spec, (v) => v, 0);
    expect(rt.events.at(-1)).toMatchObject({ route: "cache", cache: "hit" });
    expect(sent).toHaveLength(1);
    expect(rt.client.keyOf(spec)).toBe(new ModelClient(null, new MemoryCache(), new CallBudget(0)).keyOf(spec));
    const trace = readFileSync(join(root, await writeTrace(root, "direct-test", rt.events)), "utf8");
    expect(trace).toContain("route=nvidia-direct;requested=nvidia/nemotron-3.5-lightning-30b-a3b;model=nvidia/nemotron-3.5-lightning-30b-a3b");
    expect(trace).not.toContain(KEY);
  });

  it("the compare results record the route", async () => {
    const root = mkdtempSync(join(tmpdir(), "unexplained-direct-cmp-"));
    cpSync(join(import.meta.dirname, "../../data"), join(root, "data"), { recursive: true });
    cpSync(join(import.meta.dirname, "../../eval/gold"), join(root, "eval/gold"), { recursive: true });
    const { f } = fakeFetch(() => ({ body: answer("{}") }));
    const rt = await makeRuntime(root, { maxCalls: 1, sampleMode: false, provider: new NvidiaDirect({ apiKey: KEY, fetch: f }) });
    const out = await runCompare(root, rt, [], ["a"], loadDataset(root));
    expect(out.route).toBe("nvidia-direct");
  });

  it("without AI_PROVIDER the runtime is Nightshift and asks for the runtime token", async () => {
    vi.stubEnv("AI_PROVIDER", "");
    vi.stubEnv("METERLESS_RUNTIME_TOKEN", "");
    await expect(makeRuntime(mkdtempSync(join(tmpdir(), "unexplained-ns-")), { maxCalls: 1, sampleMode: false })).rejects.toThrow(/METERLESS_RUNTIME_TOKEN is not set/);
    vi.stubEnv("AI_PROVIDER", "nvidia-direct");
    vi.stubEnv("NVIDIA_API_KEY", "");
    await expect(makeRuntime(mkdtempSync(join(tmpdir(), "unexplained-nd-")), { maxCalls: 1, sampleMode: false })).rejects.toThrow(/needs NVIDIA_API_KEY/);
  });
});
