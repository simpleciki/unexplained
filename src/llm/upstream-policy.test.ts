// Live-run fixes: numeric org ids, transient upstream 404s on a working route, per-record isolation in
// ingest, redaction of truncated errors, and a comma list of pinned models.
import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { MemoryCache } from "./cache.ts";
import { CallBudget, ModelClient, TRANSIENT_RETRY_MS } from "./client.ts";
import { FakeProvider } from "./fake.ts";
import { classifyRoute } from "./http.ts";
import { DEFAULT_MODE_ORDER, EXCLUDED_MODELS, MemoryDeadModes, candidateModes, parseModeOrder } from "./modes.ts";
import { ProviderError } from "./provider.ts";
import type { ChatRequest } from "./provider.ts";
import { readLogin } from "../zetaris/client.ts";
import { runIngest } from "../pipeline/ingest.ts";
import { makeRuntime } from "../pipeline/runtime.ts";

const PINNED = "nvidia/nemotron-3.5-lightning-30b-a3b,nvidia/nemotron-3-super-120b-a12b";
const [LIGHT, SUPER] = PINNED.split(",");
const ULTRA = "nvidia/nemotron-3-ultra-550b-a55b";
const unavailable = () => new ProviderError("route_unavailable", "nvidia_404: Function 'f-1': Not found for account [redacted]", 502);
const spec = (user: string) => ({ stage: "s", agent: "Researcher.extract", model: "meterless/auto", system: "sys", user });

describe("Zetaris login with a numeric org id", () => {
  it("accepts numbers and names only the keys it saw when something is missing", () => {
    expect(readLogin({ idToken: "t", refreshToken: "r", orgId: 42 })).toEqual({ token: "t", orgId: "42" });
    const err = (() => {
      try {
        readLogin({ idToken: "t", refreshToken: "SECRET-REFRESH", orgId: "" });
      } catch (e) {
        return (e as Error).message;
      }
    })();
    expect(err).toMatch(/without an org id .*keys present: idToken, refreshToken, orgId/);
    expect(err).not.toContain("SECRET-REFRESH");
  });
});

describe("transient upstream 404 on a route that already worked", () => {
  it("retries the same route after 3 s then 10 s, counting each attempt, without marking it dead", async () => {
    let n = 0;
    const fake = new FakeProvider(() => {
      n++;
      if (n === 2 || n === 3) throw unavailable();
      return "ok";
    });
    const sleep = vi.fn(async (_ms: number) => {});
    const dead = new MemoryDeadModes();
    const budget = new CallBudget(10);
    const client = new ModelClient(fake, new MemoryCache(), budget, undefined, { modeOrder: parseModeOrder(PINNED), deadModes: dead, sleep, warn: () => {} });
    await client.text(spec("record 1"));
    await client.text(spec("record 2"));
    expect(fake.calls.map((c) => c.model)).toEqual([LIGHT, LIGHT, LIGHT, LIGHT]);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual(TRANSIENT_RETRY_MS);
    expect(budget.used).toBe(4);
    expect(dead.isDead(LIGHT)).toBeUndefined();
  });

  it("moves to the next pinned model only after both retries fail", async () => {
    let n = 0;
    const fake = new FakeProvider((r: ChatRequest) => {
      n++;
      if (r.model === LIGHT && n > 1) throw unavailable();
      return "ok";
    });
    const dead = new MemoryDeadModes();
    const client = new ModelClient(fake, new MemoryCache(), new CallBudget(10), undefined, { modeOrder: parseModeOrder(PINNED), deadModes: dead, sleep: async () => {}, warn: () => {} });
    await client.text(spec("record 1"));
    await client.text(spec("record 2"));
    expect(fake.calls.map((c) => c.model)).toEqual([LIGHT, LIGHT, LIGHT, LIGHT, SUPER]);
    expect(dead.isDead(LIGHT)).toBeUndefined(); // it worked earlier: not remembered as dead
  });

  it("a route that never worked still switches at once and is remembered", async () => {
    const fake = new FakeProvider((r) => {
      if (r.model === LIGHT) throw unavailable();
      return "ok";
    });
    const dead = new MemoryDeadModes();
    const sleep = vi.fn(async () => {});
    await new ModelClient(fake, new MemoryCache(), new CallBudget(10), undefined, { modeOrder: parseModeOrder(PINNED), deadModes: dead, sleep, warn: () => {} }).text(spec("x"));
    expect(fake.calls.map((c) => c.model)).toEqual([LIGHT, SUPER]);
    expect(sleep).not.toHaveBeenCalled();
    expect(dead.isDead(LIGHT)?.reason).toBe("unavailable");
  });
});

describe("ingest keeps going past a record that fails upstream", () => {
  const tempRoot = () => {
    const dir = mkdtempSync(join(tmpdir(), "unexplained-upstream-"));
    cpSync(join(import.meta.dirname, "../../data"), join(dir, "data"), { recursive: true });
    return dir;
  };
  const extractReply = '{"cards": []}';

  it("marks the failed record, continues, reports it, and a rerun retries it", async () => {
    const root = tempRoot();
    const failing = (r: ChatRequest) => {
      if (r.user.startsWith("Record rec-0005 ")) throw unavailable();
      return extractReply;
    };
    const rt = await makeRuntime(root, { maxCalls: 500, sampleMode: false, provider: new FakeProvider(failing, ["meterless/auto"]) });
    const report = await runIngest(root, rt);
    expect(report.records_failed_upstream.map((r) => r.record_id)).toEqual(["rec-0005"]);
    expect(report.records_failed_upstream_count).toBe(1);
    expect(report.records_done).toBe(report.records_total - 1);
    expect(report.complete).toBe(false);
    expect(report.stopped_reason).toMatch(/rerun to retry/);

    const healthy = new FakeProvider(() => extractReply, ["meterless/auto"]);
    const rt2 = await makeRuntime(root, { maxCalls: 500, sampleMode: false, provider: healthy });
    const again = await runIngest(root, rt2);
    expect(again.records_failed_upstream_count).toBe(0);
    expect(healthy.calls.map((c) => c.user.match(/^Record (rec-\d+)/)?.[1])).toContain("rec-0005");
  });

  it("stops after 5 failed records in a row and says why", async () => {
    const root = tempRoot();
    const rt = await makeRuntime(root, { maxCalls: 500, sampleMode: false, provider: new FakeProvider(() => { throw unavailable(); }, ["meterless/auto"]) });
    const report = await runIngest(root, rt);
    expect(report.records_failed_upstream_count).toBe(5);
    expect(report.stopped_reason).toMatch(/stopped after 5 consecutive upstream failures; last: .*for account \[redacted\]/);
  });
});

describe("redaction and pinned lists", () => {
  it("recognises and redacts a truncated error body with no closing quote", () => {
    const truncated = '{"error":{"code":"provider_error","meterless_detail":"nvidia_404: {\\"status\\":404,\\"title\\":\\"Not Found\\",\\"detail\\":\\"Function \'f-9\': Not found for account \'acct-31415926';
    const c = classifyRoute(truncated);
    expect(c.kind).toBe("unavailable");
    expect(c.message).toMatch(/for account \[redacted\]$/);
    expect(c.message).not.toContain("acct-31415926");
  });

  it("a comma list of pinned models is used in that order", () => {
    const order = parseModeOrder(PINNED);
    expect(order).toEqual([LIGHT, SUPER]);
    expect(candidateModes("meterless/auto", { order, available: ["meterless/auto", "meterless/deep"] })).toEqual([LIGHT, SUPER]);
  });

  it("ultra-550b is never used: refused when pinned and never picked as a fallback", () => {
    expect(() => parseModeOrder(`${LIGHT},${ULTRA}`)).toThrow(/ultra-550b-a55b is excluded/);
    expect(candidateModes(ULTRA, { order: [ULTRA, LIGHT] })).toEqual([LIGHT]);
    expect(candidateModes(ULTRA, {})).not.toContain(ULTRA);
  });

  it("the default order is lightning then super, with no ultra", () => {
    expect(DEFAULT_MODE_ORDER).toEqual([LIGHT, SUPER]);
    expect(DEFAULT_MODE_ORDER).not.toContain(ULTRA);
    expect(EXCLUDED_MODELS).toContain(ULTRA);
  });
});
