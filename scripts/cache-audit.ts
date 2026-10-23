// npm run cache:audit -- [--quarantine]
// Re-parses every cache/*.json reply with the strict JSON reader and prints counts by model:
// ok (usable JSON), prose (a plan or explanation, not JSON), invalid (starts like JSON but does not parse).
// --quarantine MOVES (never deletes) prose and invalid entries to cache/_quarantined-<YYYY-MM-DD>/.
// cache/samples/ is reported, never touched. Do not run --quarantine while eval:live or ingest is running.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { extractJson, isProseError } from "../src/llm/json.ts";

const root = join(import.meta.dirname, "..");
const dir = join(root, "cache");
const quarantine = process.argv.includes("--quarantine");

if (!existsSync(dir)) {
  console.log("no cache/ directory");
  process.exit(0);
}

type Verdict = "ok" | "prose" | "invalid";
const counts = new Map<string, Record<Verdict, number>>();
const failing: string[] = [];
for (const f of readdirSync(dir)) {
  const path = join(dir, f);
  if (!f.endsWith(".json") || !statSync(path).isFile()) continue;
  let verdict: Verdict = "ok";
  let model = "unknown";
  try {
    const entry = JSON.parse(readFileSync(path, "utf8")) as { text?: string; model?: string };
    model = entry.model || "unknown";
    extractJson(entry.text ?? "");
  } catch (e) {
    verdict = isProseError((e as Error).message) ? "prose" : "invalid";
  }
  const c = counts.get(model) ?? { ok: 0, prose: 0, invalid: 0 };
  c[verdict]++;
  counts.set(model, c);
  if (verdict !== "ok") failing.push(f);
}

const rows = [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
const total = rows.reduce((t, [, c]) => ({ ok: t.ok + c.ok, prose: t.prose + c.prose, invalid: t.invalid + c.invalid }), { ok: 0, prose: 0, invalid: 0 });
console.log("model                                        ok  prose  invalid  prose rate");
for (const [m, c] of [...rows, ["total", total] as const]) {
  const n = c.ok + c.prose + c.invalid;
  console.log(`${m.padEnd(42)} ${String(c.ok).padStart(4)} ${String(c.prose).padStart(6)} ${String(c.invalid).padStart(8)}  ${n ? `${Math.round((c.prose / n) * 100)}%` : "-"}`);
}
const samples = join(dir, "samples");
if (existsSync(samples)) console.log(`\ncache/samples/: ${readdirSync(samples).filter((f) => f.endsWith(".json")).length} entries (not audited, not touched)`);

if (!quarantine) {
  console.log(`\n${failing.length} failing entries. Run with --quarantine to move them (only while no eval:live or ingest is running).`);
  process.exit(0);
}
const d = new Date();
const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const target = join(dir, `_quarantined-${day}`);
mkdirSync(target, { recursive: true });
for (const f of failing) renameSync(join(dir, f), join(target, f));
console.log(`\nmoved ${failing.length} entries to cache/_quarantined-${day}/ (nothing deleted). The next run will ask for them again.`);
