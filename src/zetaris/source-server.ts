// npm run sources:serve: the two source systems as read-only JSON over HTTP, bound to 127.0.0.1 only,
// for Zetaris REST tables. GET /portal/<name> and /ops/<name> return {"data":[...]}; nothing else exists.
import { createServer } from "node:http";
import type { Server } from "node:http";
import { join } from "node:path";
import { loadDataset } from "../engine/data.ts";
import type { Dataset } from "../engine/types.ts";
import { createTraceLogger } from "../trace.ts";
import { TABLES } from "./schema.ts";
import type { TableDef } from "./schema.ts";

// Rows exactly as data/ holds them; records always carry row_key ("" when absent) so every row has one shape.
export function rowsFor(data: Dataset, t: TableDef): Record<string, string>[] {
  if (t.key.startsWith("records_")) {
    const type = t.key.slice("records_".length);
    return data.records
      .filter((r) => r.source_type === type)
      .map((r) => Object.fromEntries(t.columns.map(([c]) => [c, String((r as Record<string, unknown>)[c] ?? "")])));
  }
  return data.tables[t.key as keyof Dataset["tables"]];
}

export function routes(data: Dataset): Map<string, Record<string, string>[]> {
  return new Map(TABLES.map((t) => [`/${t.source}/${t.path}`, rowsFor(data, t)]));
}

export function startSourceServer(root: string, port: number, onRequest: (method: string, path: string, status: number, rows: number) => void = () => {}): Promise<Server> {
  const table = routes(loadDataset(root));
  const server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    const rows = table.get(path);
    const status = req.method !== "GET" ? 405 : rows ? 200 : 404;
    res.writeHead(status, { "content-type": "application/json" });
    res.end(status === 200 ? JSON.stringify({ data: rows }) : JSON.stringify({ error: status === 405 ? "read-only" : "not found" }));
    onRequest(req.method ?? "", path, status, status === 200 ? rows!.length : 0);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

if (process.argv[1]?.endsWith("source-server.ts")) {
  const root = join(import.meta.dirname, "../..");
  const port = Number(process.env.SOURCE_PORT ?? 8790);
  const trace = createTraceLogger(`sources-${new Date().toISOString().replace(/[:.]/g, "-")}`, join(root, "logs"));
  startSourceServer(root, port, (method, path, status, rows) => {
    console.log(`${method} ${path} -> ${status} (${rows} rows)`);
    void trace.append({ phase: "sources", agent: "source-server", action: method, input_ref: path, output_ref: String(rows), outcome: String(status), retry_count: 0, latency_ms: 0 });
  }).then(() => {
    console.log(`serving ${TABLES.length} paths on http://127.0.0.1:${port} (Zetaris reaches it as http://host.docker.internal:${port})`);
    for (const t of TABLES) console.log(`  /${t.source}/${t.path}`);
  });
}
