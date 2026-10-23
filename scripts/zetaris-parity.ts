// npm run zetaris:parity: load the dataset from data/ and through Zetaris, compare every table.
// Exits non-zero on any difference. Each Zetaris query is traced (SQL hash, rows, latency, outcome).
import { join } from "node:path";
import { loadData } from "../src/adapters/zetaris.ts";
import { createTraceLogger } from "../src/trace.ts";
import type { QueryEvent } from "../src/zetaris/client.ts";
import { compareDatasets } from "../src/zetaris/parity.ts";

const root = join(import.meta.dirname, "..");
const events: QueryEvent[] = [];
const files = await loadData(root, "files"); // views computed in memory from data/
let zetaris;
try {
  zetaris = await loadData(root, "zetaris", (e) => events.push(e)); // tables and views read through Zetaris
} catch (e) {
  console.error(`error: ${(e as Error).message}`);
  process.exit(1);
}
const trace = createTraceLogger(`zetaris-parity-${new Date().toISOString().replace(/[:.]/g, "-")}`, join(root, "logs"));
for (const e of events) await trace.append({ phase: "zetaris", agent: "parity", action: e.action, input_ref: e.target ? `${e.target}:${e.sql_hash}` : e.sql_hash, output_ref: String(e.rows), outcome: e.outcome, retry_count: 0, latency_ms: e.latency_ms });

const rows = compareDatasets(files, zetaris);
console.log("table or cross-source view         files  zetaris  result");
for (const r of rows) console.log(`${r.table.padEnd(34)} ${String(r.files).padStart(5)}  ${String(r.zetaris).padStart(7)}  ${r.firstDifference ? `DIFFERS: ${r.firstDifference}` : "same"}`);
const bad = rows.filter((r) => r.firstDifference);
console.log(bad.length ? `\n${bad.length} table(s) differ.` : "\nparity: every table identical.");
process.exit(bad.length ? 1 : 0);
