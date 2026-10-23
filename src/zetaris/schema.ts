// The two source systems Zetaris joins, and how each table looks. One definition drives the source
// server, the registration SQL, the adapter and the parity check, so they cannot drift apart.
// Client portal = what the client sees. Contractor ops = what only the office sees.
import type { Tables } from "../engine/types.ts";

export type ColType = "string" | "int" | "money" | "number";
export type SourceName = "portal" | "ops";
export type TableDef = {
  source: SourceName;
  path: string; // served at /<source>/<path>
  key: keyof Tables | `records_${string}`;
  columns: [string, ColType][];
  orderBy: string[];
};

const RECORD_COLUMNS: [string, ColType][] = [
  ["record_id", "string"],
  ["source_type", "string"],
  ["source_version", "string"],
  ["text", "string"],
  ["author", "string"],
  ["source_recorded_at", "string"],
  ["thread_id", "string"],
  ["row_key", "string"],
];
const LINE_COLUMNS: [string, ColType][] = [
  ["line_no", "int"],
  ["kind", "string"],
  ["category", "string"],
  ["description", "string"],
  ["qty", "number"],
  ["unit_price", "money"],
  ["amount", "money"],
];

export const PORTAL_RECORD_TYPES = ["client_message", "quote_version", "submission_event", "invoice"];
export const OPS_RECORD_TYPES = ["work_order", "internal_note", "field_note"];

export const TABLES: TableDef[] = [
  { source: "portal", path: "clients", key: "clients", columns: [["client_id", "string"], ["name", "string"], ["portal_categories", "string"]], orderBy: ["client_id"] },
  {
    source: "portal",
    path: "quote_versions",
    key: "quotes",
    columns: [["quote_id", "string"], ["work_order_id", "string"], ["version", "int"], ["submitted_at", "string"], ["submitted_by", "string"], ["status", "string"], ["total_labor", "money"], ["total_material", "money"], ["total", "money"], ["scope_summary", "string"]],
    orderBy: ["quote_id"],
  },
  { source: "portal", path: "quote_lines", key: "quoteLines", columns: [["quote_id", "string"], ...LINE_COLUMNS], orderBy: ["quote_id", "line_no"] },
  {
    source: "portal",
    path: "submission_events",
    key: "events",
    columns: [["event_id", "string"], ["quote_id", "string"], ["work_order_id", "string"], ["event", "string"], ["at", "string"], ["recipients_count", "int"]],
    orderBy: ["event_id"],
  },
  {
    source: "portal",
    path: "invoices",
    key: "invoices",
    columns: [["invoice_id", "string"], ["work_order_id", "string"], ["quote_id", "string"], ["quote_version", "int"], ["issued_at", "string"], ["total_labor", "money"], ["total_material", "money"], ["total", "money"], ["status", "string"]],
    orderBy: ["invoice_id"],
  },
  { source: "portal", path: "invoice_lines", key: "invoiceLines", columns: [["invoice_id", "string"], ...LINE_COLUMNS], orderBy: ["invoice_id", "line_no"] },
  {
    source: "ops",
    path: "work_orders",
    key: "workOrders",
    columns: [["work_order_id", "string"], ["client_id", "string"], ["job_title", "string"], ["trade", "string"], ["opened_at", "string"], ["status", "string"]],
    orderBy: ["work_order_id"],
  },
  ...PORTAL_RECORD_TYPES.map((t): TableDef => ({ source: "portal", path: `records_${t}`, key: `records_${t}`, columns: RECORD_COLUMNS, orderBy: ["record_id"] })),
  ...OPS_RECORD_TYPES.map((t): TableDef => ({ source: "ops", path: `records_${t}`, key: `records_${t}`, columns: RECORD_COLUMNS, orderBy: ["record_id"] })),
];

export const DATABASES: Record<SourceName, { name: string; describe: string }> = {
  portal: { name: "CLIENT_PORTAL", describe: "Client portal of the fictional repair clients - quotes, quote lines, submissions, invoices, client messages" },
  ops: { name: "CONTRACTOR_OPS", describe: "Contractor job system of the fictional repair company - work orders, internal notes, field notes" },
};

export const CONTAINER = "unexplained";
export const viewName = (t: TableDef) => `${t.source}_${t.path}`;
// How SchemaStore views are addressed in SQL. Not documented for 2.4.3.1; one place to change it.
export const qualified = (view: string) => `${CONTAINER}.${view}`;

// The exact text a value has in data/ (the CSV writer's format), so both sources compare strictly.
export function formatValue(v: unknown, type: ColType): string {
  if (v === null || v === undefined) return "";
  if (type === "string") return String(v);
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isFinite(n)) throw new Error(`not a number: ${String(v)}`);
  if (type === "money") return n.toFixed(2);
  if (type === "int") return String(Math.round(n));
  return String(Number(n.toPrecision(12)));
}
