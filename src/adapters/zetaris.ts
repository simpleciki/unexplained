// The engine's in-memory dataset, loaded through Zetaris instead of data/: one query per view, values
// formatted exactly as data/ writes them. No silent fallback: an unreachable Zetaris is an error.
import { join, relative } from "node:path";
import { loadDataset } from "../engine/data.ts";
import { createTraceLogger } from "../trace.ts";
import type { Dataset, SourceRecord, Tables } from "../engine/types.ts";
import type { ZetarisClient } from "../zetaris/client.ts";
import { clientFromEnv } from "../zetaris/client.ts";
import type { QueryEvent } from "../zetaris/client.ts";
import { VIEWS, computeViews, formatViewRows, selectView } from "../zetaris/views.ts";
import { TABLES, formatValue, qualified, viewName } from "../zetaris/schema.ts";

export type DataSource = "files" | "zetaris";

// One trace line per Zetaris query: the table or view it read, SQL hash, rows, latency, outcome.
export async function traceZetaris(root: string, name: string, events: QueryEvent[]): Promise<string | null> {
  if (!events.length) return null;
  const trace = createTraceLogger(`${name}-zetaris-${new Date().toISOString().replace(/[:.]/g, "-")}`, join(root, "logs"));
  for (const e of events) {
    await trace.append({ phase: "zetaris", agent: name, action: e.action, input_ref: e.target ? `${e.target}:${e.sql_hash}` : e.sql_hash, output_ref: String(e.rows), outcome: e.outcome, retry_count: 0, latency_ms: e.latency_ms });
  }
  return relative(root, trace.path);
}

export function selectFor(t: (typeof TABLES)[number]): string {
  return `SELECT ${t.columns.map(([c]) => c).join(", ")} FROM ${qualified(viewName(t))} ORDER BY ${t.orderBy.join(", ")}`;
}

export async function loadDatasetFromZetaris(client: ZetarisClient): Promise<Dataset> {
  const tables = {} as Tables;
  const records: SourceRecord[] = [];
  for (const t of TABLES) {
    const cols = t.columns.map(([c]) => c);
    const rows = (await client.query(selectFor(t), cols, viewName(t))).map((r) => Object.fromEntries(t.columns.map(([c, type]) => [c, formatValue(r[c], type)])));
    if (t.key.startsWith("records_")) {
      for (const r of rows) {
        const { row_key, ...rest } = r;
        records.push({ ...(rest as Omit<SourceRecord, "row_key">), ...(row_key ? { row_key } : {}) } as SourceRecord);
      }
    } else tables[t.key as keyof Tables] = rows;
  }
  records.sort((a, b) => a.record_id.localeCompare(b.record_id));
  // The cross-source views, read through Zetaris: the client portal joined to the contractor's records.
  const views: NonNullable<Dataset["views"]> = {};
  for (const v of VIEWS) views[v.name] = formatViewRows(v, await client.query(selectView(v), v.columns.map(([c]) => c), v.view));
  return { records, tables, views };
}

// --source zetaris (default) or files. With files, the views are computed in memory from data/.
// SAMPLE_MODE always reads files: judges replay the samples without Docker or Zetaris.
export async function loadData(root: string, source: DataSource = "zetaris", onEvent?: (e: QueryEvent) => void): Promise<Dataset> {
  if (source === "files") {
    const data = loadDataset(root);
    return { ...data, views: computeViews(data) };
  }
  return loadDatasetFromZetaris(clientFromEnv(onEvent));
}
