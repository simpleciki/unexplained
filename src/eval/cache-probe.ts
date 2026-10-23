// How many ingest calls would miss the cache right now, with no model call: run the real ingest code on a
// temporary copy of data/ and cache/, with a stand-in provider that answers every miss with a minimal valid
// reply. Extraction misses are exact (their prompts depend only on the record). Skeptic and Keeper misses
// are a lower bound: a record whose extraction misses gets no cards here, so its checks are not counted.
import { cpSync, existsSync, mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeProvider } from "../llm/fake.ts";
import { FALLBACK_MODES } from "../llm/modes.ts";
import type { ChatRequest } from "../llm/provider.ts";
import { type IngestSample, runIngest } from "../pipeline/ingest.ts";
import { makeRuntime } from "../pipeline/runtime.ts";

function standIn(req: ChatRequest): string {
  const sys = req.system ?? "";
  if (sys.startsWith("You extract")) return '{"cards":[]}';
  if (sys.startsWith("You check extracted")) {
    const ids = [...req.user.matchAll(/"id":"([^"]+)"/g)].map((m) => m[1]);
    return JSON.stringify({ verdicts: ids.map((id) => ({ id, supported: true })) });
  }
  if (sys.startsWith("You compare")) return '{"relation":"UNRELATED","reason":"probe"}';
  return "{}";
}

// sample: probe an ingest --records run (its out directory is inside the temporary copy).
export async function probeCacheMisses(root: string, sample?: Pick<IngestSample, "records">) {
  const tmp = mkdtempSync(join(tmpdir(), "unexplained-probe-"));
  cpSync(join(root, "data"), join(tmp, "data"), { recursive: true });
  const cache = join(root, "cache");
  let cached = 0;
  if (existsSync(cache)) {
    // Top-level entries only: quarantined and sample replies are not what an ingest reads.
    for (const f of readdirSync(cache).filter((f) => f.endsWith(".json") && statSync(join(cache, f)).isFile())) {
      cpSync(join(cache, f), join(tmp, "cache", f));
      cached++;
    }
  }
  // The runtime listed every routing mode (deep included), so Keeper and Skeptic ask for meterless/deep.
  const rt = await makeRuntime(tmp, { maxCalls: 100_000, sampleMode: false, provider: new FakeProvider(standIn, FALLBACK_MODES) });
  await runIngest(tmp, rt, undefined, sample ? { records: sample.records, out: "probe-out" } : undefined);
  const byAgent: Record<string, { hit: number; miss: number }> = {};
  for (const e of rt.events) {
    if (e.action === "route_fallback" || e.outcome === "invalid") continue;
    const a = (byAgent[e.agent] ??= { hit: 0, miss: 0 });
    a[e.cache]++;
  }
  return { cached, byAgent, misses: Object.values(byAgent).reduce((s, a) => s + a.miss, 0) };
}
