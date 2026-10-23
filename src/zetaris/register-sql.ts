// The SQL that registers both source systems in Zetaris: two Lightning databases, one REST table per
// served path, one flattening SchemaStore view per table (numbers cast), and three cross-source views.
import { CONTAINER, DATABASES, TABLES, qualified, viewName } from "./schema.ts";
import type { ColType, TableDef } from "./schema.ts";

// DESCRIBE BY allows only letters, digits, spaces and _ . - ,
export function describeBy(text: string): string {
  if (!/^[A-Za-z0-9 _.\-,]+$/.test(text)) throw new Error(`DESCRIBE BY text has a character Zetaris refuses: ${text}`);
  return `"${text}"`;
}

const CAST: Record<ColType, (c: string) => string> = {
  string: (c) => `r.\`${c}\``,
  int: (c) => `CAST(r.\`${c}\` AS INT)`,
  money: (c) => `CAST(r.\`${c}\` AS DECIMAL(12,2))`,
  number: (c) => `CAST(r.\`${c}\` AS DOUBLE)`,
};

export const rawTable = (t: TableDef) => `${t.path}_raw`;

export function registerStatements(port: number): { label: string; sql: string }[] {
  const out: { label: string; sql: string }[] = [];
  for (const db of Object.values(DATABASES)) out.push({ label: `database ${db.name}`, sql: `CREATE LIGHTNING DATABASE ${db.name} DESCRIBE BY ${describeBy(db.describe)}` });
  out.push({ label: `container ${CONTAINER}`, sql: `CREATE SCHEMASTORE CONTAINER ${CONTAINER}` });
  for (const t of TABLES) {
    const db = DATABASES[t.source].name;
    out.push({
      label: `REST table ${db}.${rawTable(t)}`,
      sql: `CREATE LIGHTNING REST TABLE ${rawTable(t)} FROM ${db} REQUEST(endpoint "http://host.docker.internal:${port}/${t.source}/${t.path}", method "get", response_type "json", http_encoding "URLENCODED") HEADER () BODY ()`,
    });
  }
  for (const t of TABLES) {
    const cols = t.columns.map(([c, type]) => `${CAST[type](c)} AS \`${c}\``).join(", ");
    out.push({
      label: `view ${viewName(t)}`,
      sql: `CREATE SCHEMASTORE VIEW ${viewName(t)} WITH CONTAINER ${CONTAINER} AS SELECT ${cols} FROM ${DATABASES[t.source].name.toLowerCase()}.${rawTable(t)} LATERAL VIEW explode(data) AS r`,
    });
  }
  // Cross-source views for the demo. Each per-table view appears once per query (Zetaris refuses an
  // explode() view referenced twice in one query).
  const v = (path: string, source: "portal" | "ops") => qualified(`${source}_${path}`);
  out.push({
    label: "cross-source view v_quotes_by_trade",
    sql: `CREATE SCHEMASTORE VIEW v_quotes_by_trade WITH CONTAINER ${CONTAINER} AS SELECT q.quote_id, q.work_order_id, w.client_id, w.trade, w.job_title, q.version, q.submitted_at, q.total_labor, q.total_material, q.total FROM ${v("quote_versions", "portal")} q JOIN ${v("work_orders", "ops")} w ON q.work_order_id = w.work_order_id`,
  });
  out.push({
    label: "cross-source view v_invoice_vs_approved",
    // status here is end-of-window state: fine to show, never used by the engine for a past date.
    sql: `CREATE SCHEMASTORE VIEW v_invoice_vs_approved WITH CONTAINER ${CONTAINER} AS SELECT i.invoice_id, i.work_order_id, w.trade, i.quote_id AS billed_quote_id, q.quote_id AS approved_quote_id, i.total AS invoice_total, q.total AS approved_total FROM ${v("invoices", "portal")} i JOIN ${v("quote_versions", "portal")} q ON q.work_order_id = i.work_order_id AND q.status = 'approved' JOIN ${v("work_orders", "ops")} w ON w.work_order_id = i.work_order_id`,
  });
  const timeline = (path: string, source: "portal" | "ops", system: string) =>
    `SELECT thread_id AS work_order_id, source_recorded_at, '${system}' AS system, source_type, record_id, \`text\` FROM ${v(path, source)}`;
  out.push({
    label: "cross-source view v_job_evidence_timeline",
    sql: `CREATE SCHEMASTORE VIEW v_job_evidence_timeline WITH CONTAINER ${CONTAINER} AS ${[
      timeline("records_client_message", "portal", "client portal"),
      timeline("records_internal_note", "ops", "contractor ops"),
      timeline("records_field_note", "ops", "contractor ops"),
    ].join(" UNION ALL ")}`,
  });
  return out;
}

export const alreadyExists = (message: string) => /already exists|exists already|duplicate/i.test(message);

// Runs the statements one by one through run-query (DDL included). "Already exists" counts as there;
// any other error stops the run and is returned with the statement it failed on.
export async function applyStatements(
  run: (sql: string) => Promise<unknown>,
  statements: { label: string; sql: string }[],
  log: (line: string) => void = () => {},
): Promise<{ created: number; skipped: number; failed?: { label: string; message: string } }> {
  let created = 0;
  let skipped = 0;
  for (const s of statements) {
    try {
      await run(s.sql);
      created++;
      log(`created  ${s.label}`);
    } catch (e) {
      const message = (e as Error).message;
      if (alreadyExists(message)) {
        skipped++;
        log(`exists   ${s.label}`);
        continue;
      }
      return { created, skipped, failed: { label: s.label, message } };
    }
  }
  return { created, skipped };
}
