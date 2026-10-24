// How many eval:compare calls would miss the cache right now, with no model call: the real comparison code
// runs on a temporary copy of data/, eval/gold/, state/, review/ and cache/ with a stand-in provider that
// answers every miss with a minimal valid reply. A's misses are exact (its prompt depends only on the
// question and the records); C's later steps depend on earlier replies, so their misses are a lower bound.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadDataset } from "../engine/data.ts";
import { FakeProvider } from "../llm/fake.ts";
import { FALLBACK_MODES } from "../llm/modes.ts";
import type { ChatRequest } from "../llm/provider.ts";
import { makeRuntime } from "../pipeline/runtime.ts";
import { runCompare } from "./compare.ts";
import type { GoldQuestion } from "./scoring.ts";

function standIn(req: ChatRequest): string {
  const sys = req.system ?? "";
  if (sys.startsWith("You are the gatekeeper")) return JSON.stringify({ verdict: "cannot_tell", flags: [], current: null, in_effect: null, reasons: [], cannot_tell_because: "probe" });
  if (sys.startsWith("You route")) return JSON.stringify({ question_type: "other", seats: [], topic: null, facets: [], as_of: null });
  if (sys.startsWith("You check whether")) return JSON.stringify({ lines: [] });
  if (sys.startsWith("You write")) return JSON.stringify({ sentences: [] });
  if (sys.startsWith("You check a short answer")) return JSON.stringify({ verdicts: [] });
  return "{}";
}

export async function probeCompare(root: string, questions: GoldQuestion[], groups: string[]) {
  const tmp = mkdtempSync(join(tmpdir(), "unexplained-compare-probe-"));
  for (const d of ["data", "eval/gold"]) cpSync(join(root, d), join(tmp, d), { recursive: true });
  mkdirSync(join(tmp, "state"));
  for (const f of ["cards.json", "edges.json", "ingest-report.json"]) if (existsSync(join(root, "state", f))) cpSync(join(root, "state", f), join(tmp, "state", f));
  if (existsSync(join(root, "review"))) cpSync(join(root, "review"), join(tmp, "review"), { recursive: true });
  let cached = 0;
  const cache = join(root, "cache");
  if (existsSync(cache)) {
    for (const f of readdirSync(cache).filter((f) => f.endsWith(".json") && statSync(join(cache, f)).isFile())) {
      cpSync(join(cache, f), join(tmp, "cache", f));
      cached++;
    }
  }
  const rt = await makeRuntime(tmp, { maxCalls: 100_000, sampleMode: false, provider: new FakeProvider(standIn, FALLBACK_MODES) });
  await runCompare(tmp, rt, questions, groups, loadDataset(tmp));
  const byAgent: Record<string, { hit: number; miss: number }> = {};
  for (const e of rt.events) {
    if (e.action === "route_fallback" || e.outcome === "invalid") continue;
    const a = (byAgent[e.agent] ??= { hit: 0, miss: 0 });
    a[e.cache]++;
  }
  return { cached, byAgent, misses: Object.values(byAgent).reduce((s, a) => s + a.miss, 0) };
}
