// Extraction run 2 (docs/extraction-run-2.md): a thinking-off run never reads a reply cached with thinking on, never
// writes cache/, and a run with --out never writes state/ or snapshot/.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cacheKey } from "../llm/cache.ts";
import { FakeProvider } from "../llm/fake.ts";
import { NVIDIA_DIRECT_ID } from "../llm/nvidia-direct.ts";
import { sampleOutDir } from "./ingest.ts";
import { makeRuntime, THINKING_OFF, THINKING_OFF_CACHE } from "./runtime.ts";

// A stand-in provider that reports itself as the direct NVIDIA route (no network).
const directFake = (...a: ConstructorParameters<typeof FakeProvider>) => Object.defineProperty(new FakeProvider(...a), "id", { value: NVIDIA_DIRECT_ID }) as FakeProvider;
const spec = { stage: "ingest", agent: "Researcher.extract", model: "meterless/auto", system: "You extract", user: "rec-0001" };
const env = { ...process.env };
afterEach(() => { process.env = { ...env }; });

function rootWithThinkingOnReply() {
  const root = mkdtempSync(join(tmpdir(), "unexplained-run2-"));
  mkdirSync(join(root, "cache"));
  // A reply cached by an earlier (thinking-on) run, under the original key; also copied into the thinking-off folder
  // under the same key, to prove the namespace alone keeps it from matching.
  const key = cacheKey({ model: spec.model, system: spec.system, user: spec.user, temperature: 0 });
  const reply = JSON.stringify({ text: "thinking-on reply", model: "nvidia/x", mode: "nvidia/x" });
  writeFileSync(join(root, "cache", `${key}.json`), reply);
  mkdirSync(join(root, THINKING_OFF_CACHE));
  writeFileSync(join(root, THINKING_OFF_CACHE, `${key}.json`), reply);
  return { root, key };
}

describe("thinking-off run isolation", () => {
  it("does not hit a thinking-on cache entry and writes only its own cache folder", async () => {
    const { root, key } = rootWithThinkingOnReply();
    process.env.AI_PROVIDER = "nvidia-direct";
    process.env.NVIDIA_DISABLE_THINKING = "1";
    const fake = directFake(() => "fresh thinking-off reply", ["nvidia/nemotron-3.5-lightning-30b-a3b"]);
    const rt = await makeRuntime(root, { maxCalls: 5, sampleMode: false, provider: fake, deadModesFile: join(root, "out", "dead-modes.json") });
    expect(rt.cacheNamespace).toBe(THINKING_OFF);
    expect(rt.cacheDir).toBe(join(root, THINKING_OFF_CACHE));
    const r = await rt.client.raw(spec);
    expect(r.fromCache).toBe(false);
    expect(r.text).toBe("fresh thinking-off reply");
    expect(fake.calls).toHaveLength(1);
    expect(readdirSync(join(root, "cache"))).toEqual([`${key}.json`]); // cache/ untouched
    const offKey = cacheKey({ model: spec.model, system: spec.system, user: spec.user, temperature: 0, namespace: THINKING_OFF });
    expect(existsSync(join(root, THINKING_OFF_CACHE, `${offKey}.json`))).toBe(true);
    // The same call again is a hit on the thinking-off reply, not the thinking-on one.
    const again = await rt.client.raw(spec);
    expect([again.fromCache, again.text]).toEqual([true, "fresh thinking-off reply"]);
    expect(existsSync(join(root, "state"))).toBe(false);
  });

  it("refuses to run thinking-off on cache/", async () => {
    const { root } = rootWithThinkingOnReply();
    process.env.AI_PROVIDER = "nvidia-direct";
    process.env.NVIDIA_DISABLE_THINKING = "1";
    await expect(makeRuntime(root, { maxCalls: 1, sampleMode: false, provider: directFake(() => "x"), cacheDir: "cache" })).rejects.toThrow(/must not use cache\//);
  });

  it("keeps the original key when no namespace is set, so existing cached replies still hit", () => {
    const k = { model: "m", system: "s", user: "u", temperature: 0 };
    expect(cacheKey(k)).toBe(cacheKey({ ...k, namespace: undefined }));
    expect(cacheKey(k)).not.toBe(cacheKey({ ...k, namespace: THINKING_OFF }));
  });

  it("never lets --out be state/, the repo root or anything under snapshot/", () => {
    const root = "/repo";
    expect(sampleOutDir(root, "state/run-2")).toBe("/repo/state/run-2");
    expect(() => sampleOutDir(root, "state")).toThrow();
    expect(() => sampleOutDir(root, ".")).toThrow();
    expect(() => sampleOutDir(root, "snapshot/ingest-2026-10-23")).toThrow(/snapshot/);
    expect(() => sampleOutDir(root, "snapshot")).toThrow(/snapshot/);
  });
});
