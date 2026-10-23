// Second live run fixes: only valid replies are cached, tolerant JSON, not-entitled routes, pinned models.
import { describe, expect, it } from "vitest";
import { MemoryCache } from "./cache.ts";
import { CallBudget, ModelClient } from "./client.ts";
import type { CallEvent } from "./client.ts";
import { FakeProvider } from "./fake.ts";
import { classifyRoute } from "./http.ts";
import { extractJson, obj, str } from "./json.ts";
import { MeterlessRuntime } from "./meterless.ts";
import { MemoryDeadModes, candidateModes, parseModeOrder } from "./modes.ts";
import { ProviderError } from "./provider.ts";
import { routeLines } from "../pipeline/runtime.ts";
import type { Runtime } from "../pipeline/runtime.ts";

const spec = { stage: "s", agent: "Researcher.extract", model: "meterless/auto", system: "sys", user: "extract" };
const parseOk = (v: unknown) => str(obj(v, "reply").ok, "ok");
const ACCOUNT = "acct-9f8e7d6c5b";
const NOT_ENTITLED = JSON.stringify({
  error: {
    message: "Provider error",
    code: "provider_error",
    meterless_detail: `nvidia_404: {"status":404,"title":"Not Found","detail":"Function '0a1b2c3d-1111-2222-3333-444455556666': Not found for account '${ACCOUNT}'"}`,
    meterless: { request_id: "r-2", requested_model: "meterless/code" },
  },
});

describe("only valid replies are cached", () => {
  it("an invalid reply is never written; the retry goes to the provider; the valid reply is cached once", async () => {
    const fake = new FakeProvider((_r, n) => (n === 1 ? '{"cards": "not a list"}' : '{"ok":"yes"}'));
    const cache = new MemoryCache();
    const events: CallEvent[] = [];
    const client = new ModelClient(fake, cache, new CallBudget(5), (e) => events.push(e));
    const r = await client.json(spec, parseOk, 2);
    expect(r.value).toBe("yes");
    expect(fake.calls).toHaveLength(2);
    expect([...cache.entries.values()].map((v) => v.text)).toEqual(['{"ok":"yes"}']); // only the valid one
    expect(events.find((e) => e.outcome === "invalid")?.cache).toBe("miss"); // it came from a live call

    // The next run answers from the cache in one hit, with no call.
    const again = new ModelClient(new FakeProvider(() => "should not be called"), cache, new CallBudget(0));
    expect((await again.json(spec, parseOk, 2)).value).toBe("yes");
  });

  it("an invalid reply left in an old cache is not trusted: the retry bypasses the cache", async () => {
    const cache = new MemoryCache();
    const old = new ModelClient(null, cache, new CallBudget(0));
    cache.set(old.keyOf(spec), { text: "garbage from an older version", model: "m" });
    const fake = new FakeProvider(() => '{"ok":"fresh"}');
    const r = await new ModelClient(fake, cache, new CallBudget(5)).json(spec, parseOk, 1);
    expect(r.value).toBe("fresh");
    expect(fake.calls).toHaveLength(1);
    expect(cache.get(old.keyOf(spec))?.text).toBe('{"ok":"fresh"}');
  });
});

describe("JSON reply shape", () => {
  it("accepts a fenced block or a reply that starts with JSON, and takes its first complete value", () => {
    expect(extractJson('Sure! Here it is:\n```json\n{"cards": [{"quote": "a {brace} inside"}]}\n```\nHope that helps {really}.')).toEqual({ cards: [{ quote: "a {brace} inside" }] });
    expect(extractJson('  {"ok": "x"} and then {"other": 1}')).toEqual({ ok: "x" });
    // Prose before JSON is no longer accepted (Task 006): the object may be an example quoted from our prompt.
    expect(() => extractJson('Answer: {"ok": "x"}')).toThrow(/reply was prose, not JSON/);
    expect(() => extractJson("no json here")).toThrow(/reply was prose, not JSON/);
  });
});

describe("not-entitled upstream routes", () => {
  it("is classified route_unavailable and the account id is redacted everywhere", async () => {
    const c = classifyRoute(NOT_ENTITLED);
    expect(c.kind).toBe("unavailable");
    expect(c.message).toMatch(/Not found for account \[redacted\]/);
    expect(c.message).not.toContain(ACCOUNT);
    const fetch = async () => new Response(NOT_ENTITLED, { status: 502 });
    const rt = new MeterlessRuntime({ token: "t", fetch, sleep: async () => {} });
    const err = await rt.chat({ model: "meterless/code", user: "x" }).catch((e) => e);
    expect(err).toMatchObject({ kind: "route_unavailable" });
    expect(String(err.message)).not.toContain(ACCOUNT);
  });

  it("switches route, remembers it as unavailable, and names the route when the error names no model", async () => {
    const fake = new FakeProvider((r) => {
      if (r.model === "meterless/auto") throw new ProviderError("route_unavailable", "Not found for account [redacted]", 502);
      return '{"ok":"y"}';
    });
    const dead = new MemoryDeadModes();
    const events: CallEvent[] = [];
    await new ModelClient(fake, new MemoryCache(), new CallBudget(5), (e) => events.push(e), { deadModes: dead, warn: () => {} }).json(spec, parseOk, 0);
    expect(fake.calls.map((c) => c.model)).toEqual(["meterless/auto", "meterless/deep"]);
    expect(dead.isDead("meterless/auto")).toMatchObject({ dead_model: "meterless/auto", reason: "unavailable" });
    expect(events.find((e) => e.action === "route_fallback")?.dead_model).toBe("meterless/auto (unavailable)");
  });

  it("uses an upstream model name the runtime attaches", () => {
    const body = JSON.stringify({ error: { code: "provider_error", message: "nvidia_404: Not found for account 'x'", meterless: { upstream_model: "nvidia/some-model" } } });
    expect(classifyRoute(body)).toMatchObject({ kind: "unavailable", model: "nvidia/some-model" });
  });
});

describe("pinned provider model ids", () => {
  it("METERLESS_MODE_ORDER accepts nvidia/<model>, passes it through although /v1/models lists only modes", async () => {
    const pinned = parseModeOrder("nvidia/nemotron-3.5-lightning-30b-a3b");
    expect(pinned).toEqual(["nvidia/nemotron-3.5-lightning-30b-a3b"]);
    expect(() => parseModeOrder("openai/gpt-x")).toThrow(/unknown mode/);
    expect(candidateModes("meterless/auto", { order: pinned, available: ["meterless/auto"] })).toEqual(pinned);
    const fake = new FakeProvider(() => '{"ok":"pinned"}', ["meterless/auto"], "nvidia/nemotron-3.5-lightning-30b-a3b");
    const client = new ModelClient(fake, new MemoryCache(), new CallBudget(2), undefined, { availableModels: ["meterless/auto"], modeOrder: pinned });
    expect((await client.json(spec, parseOk, 0)).value).toBe("pinned");
    expect(fake.calls[0].model).toBe("nvidia/nemotron-3.5-lightning-30b-a3b");
  });

  it("prints the effective route per agent: pinned, and after a fallback", () => {
    const client = new ModelClient(null, new MemoryCache(), new CallBudget(0));
    const models = { researcher: "meterless/auto", router: "meterless/auto", explainer: "meterless/auto", keeper: "meterless/deep", judge: "meterless/deep", skeptic: "meterless/deep" };
    const rt: Runtime = { client, models, events: [], sampleMode: false, modeOrder: ["nvidia/nemotron-3.5-lightning-30b-a3b"], orderSource: "env" };
    expect(routeLines(rt)[0]).toBe("Researcher.extract: nvidia/nemotron-3.5-lightning-30b-a3b (pinned by METERLESS_MODE_ORDER)");
    expect(routeLines({ ...rt, orderSource: "default" })[0]).toBe("Researcher.extract: nvidia/nemotron-3.5-lightning-30b-a3b (default order)");
    client.sticky.set("Keeper.relate", "meterless/judge");
    expect(routeLines({ ...rt, modeOrder: undefined })).toContain("Keeper.relate: meterless/judge (after a fallback)");
    expect(routeLines({ ...rt, modeOrder: undefined })).toContain("Router: meterless/auto");
  });
});
