// Task 006: a numbered plan that quotes {"cards":[]} from our own prompt must not be read as "no decision".
import { describe, expect, it } from "vitest";
import { MemoryCache } from "./cache.ts";
import { CallBudget, ModelClient } from "./client.ts";
import { FakeProvider } from "./fake.ts";
import { extractJson, isProseError } from "./json.ts";
import { parseCards } from "../agents/researcher.ts";
import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runIngest } from "../pipeline/ingest.ts";
import { makeRuntime } from "../pipeline/runtime.ts";

// The rec-0005 reply from the first real ingest, as quoted in the task card.
const PLAN =
  '1. Parse record metadata … 5. Copy each sentence exactly … 6. Assemble the JSON cards array; return {"cards":[]} only if no decision … is present.';
const CARDS = '{"cards":[{"mode":"decides","topic":"price","facets":["price.labor"],"scope":"client:cl.x","decided_at":"record_time","effective":"record_time","decided_by":"p.x.y","quote":"q"}]}';
const spec = { stage: "ingest", agent: "Researcher.extract", model: "meterless/auto", system: "sys", user: "Record rec-0005" };

describe("prose replies", () => {
  it("the rec-0005 plan throws 'reply was prose, not JSON'", () => {
    expect(() => extractJson(PLAN)).toThrow("reply was prose, not JSON");
    expect(isProseError("reply was prose, not JSON")).toBe(true);
  });

  it("the same JSON inside a ``` fence parses", () => {
    expect(extractJson("```json\n{\"cards\":[]}\n```")).toEqual({ cards: [] });
    expect(extractJson("Here you go:\n```\n" + CARDS + "\n```")).toMatchObject({ cards: [{ mode: "decides" }] });
  });

  it("bare JSON parses", () => {
    expect(extractJson(CARDS)).toMatchObject({ cards: [{ quote: "q" }] });
    expect(extractJson('\n  {"cards":[]}\n')).toEqual({ cards: [] });
  });

  it("an array-first reply for a schema expecting an object is still rejected with the schema message", () => {
    expect(() => parseCards(extractJson('[{"mode":"decides"}]'))).toThrow("reply must be an object");
  });

  it("client.json retries a prose reply, caches only the JSON one, and reports prose when it never recovers", async () => {
    const fake = new FakeProvider((_r, n) => (n === 1 ? PLAN : CARDS));
    const cache = new MemoryCache();
    const r = await new ModelClient(fake, cache, new CallBudget(5)).json(spec, parseCards, 2);
    expect(r.value).toHaveLength(1);
    expect(fake.calls[1].user).toMatch(/could not be used: reply was prose, not JSON/);
    expect([...cache.entries.values()].map((v) => v.text)).toEqual([CARDS]);

    const stubborn = new FakeProvider(() => PLAN);
    const bad = await new ModelClient(stubborn, new MemoryCache(), new CallBudget(5)).json(spec, parseCards, 2);
    expect(bad.value).toBeNull();
    expect(isProseError(bad.error)).toBe(true);
  });
});

describe("ingest makes prose replies loud", () => {
  it("lists a record whose extraction stayed prose and does not call the ingest complete", async () => {
    const root = mkdtempSync(join(tmpdir(), "unexplained-prose-"));
    cpSync(join(import.meta.dirname, "../../data"), join(root, "data"), { recursive: true });
    const fake = new FakeProvider((r) => (r.user.startsWith("Record rec-0005 ") ? PLAN : '{"cards":[]}'), ["meterless/auto"]);
    const rt = await makeRuntime(root, { maxCalls: 1000, sampleMode: false, provider: fake });
    const report = await runIngest(root, rt);
    expect(report.records_prose_reply).toEqual(["rec-0005"]);
    expect(report.complete).toBe(false);
    expect(report.stopped_reason).toMatch(/answered in prose/);
  });
});
