// The replay behind npm run activity:log (task 024): the real eval:compare / ingest code runs on a temporary copy of
// data/, state/ and review/, reading replies from cache/ and never writing it, with a stand-in provider that answers
// every cache miss with an unusable reply (a miss means the real run kept no reply either). No model call. It only
// rebuilds the prompts, so each one can be hashed the way the trace and the cache hash it (src/activity/walkthrough.ts).
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadData } from "../adapters/zetaris.ts";
import type { Dataset } from "../engine/types.ts";
import type { CachedResponse, ResponseCache } from "../llm/cache.ts";
import { CallBudget, type CallEvent, type CallSpec, ModelClient } from "../llm/client.ts";
import { FakeProvider } from "../llm/fake.ts";
import { extractJson } from "../llm/json.ts";
import { FALLBACK_MODES } from "../llm/modes.ts";
import { type Runtime, chooseModels } from "../pipeline/runtime.ts";
import { TABLES } from "../zetaris/schema.ts";
import { type ReplayCall, type StepReply, citedIds, sha } from "./walkthrough.ts";

const MISS = "replay: no cached reply for this prompt";

// Reads cache/ and never writes it.
class ReadOnlyCache implements ResponseCache {
  constructor(private dir: string) {}
  get(key: string): CachedResponse | undefined {
    const f = join(this.dir, `${key}.json`);
    return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as CachedResponse) : undefined;
  }
  set(): void {}
}

export type Recorded = ReplayCall & { user: string; retry: number };

// A ModelClient that notes every prompt it is asked for (attempt 0 only; retries quote the error back).
class RecordingClient extends ModelClient {
  readonly calls: Recorded[] = [];
  override async raw(spec: CallSpec, retry = 0, cacheUse?: { read: boolean; write: boolean }) {
    if (retry === 0)
      this.calls.push({
        stage: spec.stage,
        agent: spec.agent,
        prompt_hash: sha(`${spec.model}\n${spec.system}\n${spec.user}`),
        invalid_hash: sha(spec.user),
        cache_key: this.keyOf(spec),
        role: spec.system.split("\n")[0].slice(0, 160),
        inputs: citedIds(spec.user),
        user: spec.user,
        retry,
      });
    return super.raw(spec, retry, cacheUse);
  }
}

// A throwaway copy of what the compare and ingest code read, so the replay writes nothing in the repo.
function tempRoot(root: string): string {
  const tmp = mkdtempSync(join(tmpdir(), "unexplained-activity-"));
  for (const d of ["data", "eval/gold", "review"]) if (existsSync(join(root, d))) cpSync(join(root, d), join(tmp, d), { recursive: true });
  mkdirSync(join(tmp, "state"));
  for (const f of readdirSync(join(root, "state"))) if (f.endsWith(".json")) cpSync(join(root, "state", f), join(tmp, "state", f));
  return tmp;
}

function runtime(root: string, deep: boolean): { rt: Runtime; client: RecordingClient } {
  const events: CallEvent[] = [];
  const available = deep ? FALLBACK_MODES : FALLBACK_MODES.filter((m) => !m.endsWith("/deep"));
  const provider = new FakeProvider(() => MISS, available, "replay/none");
  const client = new RecordingClient(provider, new ReadOnlyCache(join(root, "cache")), new CallBudget(1_000_000), (e) => events.push(e), { availableModels: available, route: "replay" });
  return { rt: { client, models: chooseModels(available), events, sampleMode: false, route: "replay" }, client };
}

// data/ in the row order a --source zetaris run reads it: each table ORDER BY its declared columns (src/zetaris/
// schema.ts), records by record_id. Values are the same (evidence/zetaris-parity-2026-10-25.txt); only order differs,
// and the order is in the prompts. No Zetaris call is made.
const cmp = (a: unknown, b: unknown) => (typeof a === "number" && typeof b === "number" ? a - b : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);
function zetarisOrder(data: Dataset): Dataset {
  const tables = { ...data.tables } as Record<string, Array<Record<string, unknown>>>;
  for (const t of TABLES) {
    const rows = tables[t.key];
    if (rows) tables[t.key] = [...rows].sort((a, b) => t.orderBy.map((c) => cmp(a[c], b[c])).find((x) => x !== 0) ?? 0);
  }
  return { ...data, tables: tables as unknown as Dataset["tables"], records: [...data.records].sort((a, b) => a.record_id.localeCompare(b.record_id)) };
}

export type Variant = { deep: boolean; order: "files" | "zetaris" };

// The replay that rebuilds the most of the trace's prompts wins: whether meterless/deep was listed that day, and
// whether the run read data/ (files) or Zetaris. The choice is printed on the page; nothing else is tuned.
export async function bestReplay(root: string, run: (rt: Runtime, tmp: string, data: Dataset) => Promise<unknown>, traceRefs: Set<string>) {
  let best: { calls: Recorded[]; hits: number; variant: Variant } | null = null;
  for (const deep of [false, true])
    for (const order of ["files", "zetaris"] as const) {
      const tmp = tempRoot(root);
      try {
        const { rt, client } = runtime(root, deep);
        const files = await loadData(tmp, "files");
        await run(rt, tmp, order === "zetaris" ? zetarisOrder(files) : files);
        const hits = client.calls.filter((c) => traceRefs.has(c.prompt_hash)).length;
        if (!best || hits > best.hits) best = { calls: client.calls, hits, variant: { deep, order } };
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    }
  return best!;
}

export function replyFor(root: string, call: ReplayCall): StepReply {
  const f = join(root, "cache", `${call.cache_key}.json`);
  if (!existsSync(f)) return null;
  const c = JSON.parse(readFileSync(f, "utf8")) as CachedResponse;
  let parsed: unknown = null;
  try {
    parsed = extractJson(c.text);
  } catch {
    parsed = null;
  }
  return { model: c.model, mode: c.mode, parsed, raw: c.text };
}
