import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { MemoryCache } from "./cache.ts";
import { AllRoutesDead, CallBudget, ModelClient } from "./client.ts";
import type { CallEvent } from "./client.ts";
import { FakeProvider } from "./fake.ts";
import { classifyRouteDead } from "./http.ts";
import { FileDeadModes, MemoryDeadModes, candidateModes, parseModeOrder } from "./modes.ts";
import { MeterlessRuntime } from "./meterless.ts";
import { ProviderError } from "./provider.ts";
import type { ChatRequest } from "./provider.ts";
import { runIngest } from "../pipeline/ingest.ts";
import { makeRuntime } from "../pipeline/runtime.ts";

// The shape the runtime returned when auto landed on a retired upstream model.
const DEAD_BODY = JSON.stringify({
  error: {
    message: "410: The model 'nvidia/nemotron-3-nano-30b-a3b' has reached its end of life on 2026-09-01T09:00:00Z and is no longer available.",
    type: "api_error",
    code: "provider_error",
    meterless_detail: "nvidia_410: model gone",
    meterless: { request_id: "r-1", requested_model: "meterless/auto" },
  },
});
const dead = (model: string) => new ProviderError("route_dead", `model '${model}' has reached its end of life`, 502, model);
const spec = { stage: "s", agent: "Researcher.extract", model: "meterless/auto", system: "sys", user: "u1" };

describe("route_dead classification", () => {
  it("reads the dead upstream model from a provider_error body, whatever the HTTP status", () => {
    expect(classifyRouteDead(DEAD_BODY)).toMatchObject({ dead: true, model: "nvidia/nemotron-3-nano-30b-a3b" });
    expect(classifyRouteDead(JSON.stringify({ error: { code: "provider_error", message: "upstream timeout" } })).dead).toBe(false);
    expect(classifyRouteDead(JSON.stringify({ error: { code: "rate_limited", message: "410 requests" } })).dead).toBe(false);
  });

  it("the runtime client raises route_dead at once instead of using its 5xx retry", async () => {
    const fetch = vi.fn(async () => new Response(DEAD_BODY, { status: 502 }));
    const rt = new MeterlessRuntime({ token: "t", fetch, sleep: async () => {} });
    await expect(rt.chat({ model: "meterless/auto", user: "x" })).rejects.toMatchObject({ kind: "route_dead", deadModel: "nvidia/nemotron-3-nano-30b-a3b" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("a normal 5xx still gets the existing single retry, and no fallback", async () => {
    const ok = { model: "meterless/auto", choices: [{ message: { content: "{}" } }] };
    const fetch = vi.fn().mockResolvedValueOnce(new Response("busy", { status: 503 })).mockResolvedValueOnce(new Response(JSON.stringify(ok), { status: 200 }));
    const rt = new MeterlessRuntime({ token: "t", fetch, sleep: async () => {} });
    await expect(rt.chat({ model: "meterless/auto", user: "x" })).resolves.toMatchObject({ text: "{}" });
    expect(fetch).toHaveBeenCalledTimes(2);

    const fake = new FakeProvider(() => {
      throw new ProviderError("http", "busy", 503);
    });
    const client = new ModelClient(fake, new MemoryCache(), new CallBudget(5));
    await expect(client.text(spec)).rejects.toMatchObject({ kind: "http" });
    expect(fake.calls.map((c) => c.model)).toEqual(["meterless/auto"]);
  });
});

describe("route fallback in the model client", () => {
  it("falls back from a dead mode, sticks to the one that worked, counts every attempt, traces it and warns once", async () => {
    const fake = new FakeProvider((r: ChatRequest) => {
      if (r.model === "meterless/auto") throw dead("nvidia/nemotron-3-nano-30b-a3b");
      return '{"ok":true}';
    }, [], "nvidia/nemotron-3.5-lightning-30b-a3b");
    const events: CallEvent[] = [];
    const warn = vi.fn();
    const budget = new CallBudget(10);
    const client = new ModelClient(fake, new MemoryCache(), budget, (e) => events.push(e), { availableModels: ["meterless/auto", "meterless/deep", "meterless/fusion"], warn });
    await client.text(spec);
    await client.text({ ...spec, user: "u2" });
    expect(fake.calls.map((c) => c.model)).toEqual(["meterless/auto", "meterless/deep", "meterless/deep"]);
    expect(budget.used).toBe(3);
    expect(client.sticky.get("Researcher.extract")).toBe("meterless/deep");
    const fb = events.filter((e) => e.action === "route_fallback");
    expect(fb).toHaveLength(1);
    expect(fb[0]).toMatchObject({ requested_mode: "meterless/auto", dead_model: "nvidia/nemotron-3-nano-30b-a3b (dead)", mode_used: "meterless/deep", model_answered: "nvidia/nemotron-3.5-lightning-30b-a3b" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/retired or unavailable model/);
  });

  it("skips modes the runtime does not list", async () => {
    const fake = new FakeProvider((r) => {
      if (r.model !== "meterless/fusion") throw dead(`up-${r.model}`);
      return "ok";
    });
    const client = new ModelClient(fake, new MemoryCache(), new CallBudget(10), undefined, { availableModels: ["meterless/auto", "meterless/fusion"], warn: () => {} });
    await client.text(spec);
    expect(fake.calls.map((c) => c.model)).toEqual(["meterless/auto", "meterless/fusion"]);
  });

  it("when every mode is dead it stops with the dead models named", async () => {
    const fake = new FakeProvider((r) => {
      throw dead(`retired-for-${r.model}`);
    });
    const client = new ModelClient(fake, new MemoryCache(), new CallBudget(10), undefined, { warn: () => {} });
    const err = await client.text(spec).catch((e) => e);
    expect(err).toBeInstanceOf(AllRoutesDead);
    expect(err.message).toMatch(/retired-for-meterless\/auto.*retired-for-meterless\/fusion.*retired-for-meterless\/cluster/);
    expect(fake.calls.map((c) => c.model)).toEqual(["auto", "deep", "text", "fusion", "code", "judge", "cluster"].map((m) => `meterless/${m}`));
  });

  it("an ingest whose routes are all dead stops cleanly and keeps what it has", async () => {
    const root = mkdtempSync(join(tmpdir(), "unexplained-dead-"));
    const repo = join(import.meta.dirname, "../..");
    cpSync(join(repo, "data"), join(root, "data"), { recursive: true });
    const fake = new FakeProvider((r) => {
      throw dead(`gone-${r.model}`);
    }, ["meterless/auto", "meterless/deep"]);
    const rt = await makeRuntime(root, { maxCalls: 50, sampleMode: false, provider: fake });
    const report = await runIngest(root, rt);
    expect(report.complete).toBe(false);
    // Each record fails on both default pinned models; after 5 records in a row the run stops, naming them.
    expect(report.stopped_reason).toMatch(/stopped after 5 consecutive upstream failures; last: every routing mode is dead or unavailable: nvidia\/nemotron-3\.5-lightning-30b-a3b -> gone-nvidia\/nemotron-3\.5-lightning-30b-a3b \(dead: [^)]*\); nvidia\/nemotron-3-super-120b-a12b -> gone-nvidia\/nemotron-3-super-120b-a12b \(dead/); // the reason is cut at 300 characters
    expect(report.records_failed_upstream_count).toBe(5);
    expect(fake.calls).toHaveLength(10);
  });
});

describe("mode order, pinning and dead-mode memory", () => {
  it("tries auto, deep, text, fusion, code, judge, cluster, and never local or media modes", async () => {
    const fake = new FakeProvider((r) => {
      if (r.model !== "meterless/cluster") throw dead(`gone-${r.model}`);
      return "ok";
    });
    const available = ["local", "image", "vision", "speech", "auto", "deep", "text", "fusion", "code", "judge", "cluster"].map((m) => `meterless/${m}`);
    const client = new ModelClient(fake, new MemoryCache(), new CallBudget(20), undefined, { availableModels: available, warn: () => {} });
    await client.text(spec);
    expect(fake.calls.map((c) => c.model)).toEqual(["auto", "deep", "text", "fusion", "code", "judge", "cluster"].map((m) => `meterless/${m}`));
    expect(candidateModes("meterless/local", { available })).not.toContain("meterless/local");
  });

  it("METERLESS_MODE_ORDER pins the mode; blocked or unknown modes are refused", async () => {
    expect(parseModeOrder("judge")).toEqual(["meterless/judge"]);
    expect(parseModeOrder(" meterless/deep , judge ")).toEqual(["meterless/deep", "meterless/judge"]);
    expect(parseModeOrder("")).toBeUndefined();
    expect(() => parseModeOrder("local")).toThrow(/not allowed for text tasks/);
    expect(() => parseModeOrder("vision,judge")).toThrow(/not allowed/);
    expect(() => parseModeOrder("turbo")).toThrow(/unknown mode/);
    const fake = new FakeProvider(() => "ok");
    const events: CallEvent[] = [];
    const client = new ModelClient(fake, new MemoryCache(), new CallBudget(5), (e) => events.push(e), { modeOrder: ["meterless/judge"], warn: () => {} });
    await client.text(spec); // the agent asked for auto
    expect(fake.calls.map((c) => c.model)).toEqual(["meterless/judge"]);
    expect(events.some((e) => e.action === "route_fallback")).toBe(false);
  });

  it("remembers dead modes across runs, tries them last, and retries them after 6 hours", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "unexplained-modes-")), "state/dead-modes.json");
    let now = Date.parse("2026-10-22T16:00:00Z");
    const clock = () => now;
    const provider = () =>
      new FakeProvider((r) => {
        if (r.model === "meterless/auto") throw dead("nvidia/nemotron-3-nano-30b-a3b");
        return "ok";
      });

    // Run 1: auto dies, deep works; the file records auto.
    const run1 = provider();
    await new ModelClient(run1, new MemoryCache(), new CallBudget(5), undefined, { deadModes: new FileDeadModes(file, clock), warn: () => {} }).text(spec);
    expect(run1.calls.map((c) => c.model)).toEqual(["meterless/auto", "meterless/deep"]);
    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(saved["meterless/auto"]).toMatchObject({ dead_model: "nvidia/nemotron-3-nano-30b-a3b", first_seen: "2026-10-22T16:00:00.000Z" });

    // Run 2, an hour later: auto is tried last, so the first call already goes to deep.
    now += 60 * 60 * 1000;
    const run2 = provider();
    const events: CallEvent[] = [];
    await new ModelClient(run2, new MemoryCache(), new CallBudget(5), (e) => events.push(e), { deadModes: new FileDeadModes(file, clock), warn: () => {} }).text(spec);
    expect(run2.calls.map((c) => c.model)).toEqual(["meterless/deep"]);
    expect(events.find((e) => e.action === "route_fallback")?.dead_model).toMatch(/nemotron-3-nano.*known dead since/);

    // Run 3, 7 hours after it was last seen: the entry has expired and auto is tried first again.
    now += 7 * 60 * 60 * 1000;
    const run3 = provider();
    await new ModelClient(run3, new MemoryCache(), new CallBudget(5), undefined, { deadModes: new FileDeadModes(file, clock), warn: () => {} }).text(spec);
    expect(run3.calls[0].model).toBe("meterless/auto");
  });

  it("a mode that works again is removed from the memory", () => {
    const store = new MemoryDeadModes(() => Date.parse("2026-10-22T16:00:00Z"));
    store.markDead("meterless/auto", "x");
    expect(store.isDead("meterless/auto")).toBeDefined();
    store.markAlive("meterless/auto");
    expect(store.isDead("meterless/auto")).toBeUndefined();
  });
});
