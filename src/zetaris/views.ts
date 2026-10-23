// The two cross-source views the engine reads, as definitions shared by the SQL and by an in-memory
// equivalent (for --source files). Both must give the same rows; parity checks that.
// v_invoice_vs_approved joins on the end-of-window approval status: it is context for the reader, never
// the as-of answer (P7 still works out the approved version from dated records).
import type { Dataset, Row } from "../engine/types.ts";
import type { ColType } from "./schema.ts";
import { formatValue, qualified } from "./schema.ts";

export type ViewDef = { name: "invoice_vs_approved" | "job_evidence_timeline"; view: string; columns: [string, ColType][]; orderBy: string[] };

export const VIEWS: ViewDef[] = [
  {
    name: "invoice_vs_approved",
    view: "v_invoice_vs_approved",
    columns: [["invoice_id", "string"], ["work_order_id", "string"], ["trade", "string"], ["billed_quote_id", "string"], ["approved_quote_id", "string"], ["invoice_total", "money"], ["approved_total", "money"]],
    orderBy: ["invoice_id", "approved_quote_id"],
  },
  {
    name: "job_evidence_timeline",
    view: "v_job_evidence_timeline",
    columns: [["work_order_id", "string"], ["source_recorded_at", "string"], ["system", "string"], ["source_type", "string"], ["record_id", "string"], ["text", "string"]],
    orderBy: ["work_order_id", "record_id"],
  },
];

export const selectView = (v: ViewDef) => `SELECT ${v.columns.map(([c]) => (c === "text" ? "`text`" : c)).join(", ")} FROM ${qualified(v.view)} ORDER BY ${v.orderBy.join(", ")}`;

const format = (v: ViewDef, r: Record<string, unknown>): Row => Object.fromEntries(v.columns.map(([c, t]) => [c, formatValue(r[c], t)]));
const sortRows = (v: ViewDef, rows: Row[]) => rows.sort((a, b) => v.orderBy.map((c) => a[c].localeCompare(b[c])).find((x) => x !== 0) ?? 0);

// The same rows the SQL views produce, computed from data/.
export function computeViews(data: Dataset): Record<ViewDef["name"], Row[]> {
  const [inv, tl] = VIEWS;
  const trade = new Map(data.tables.workOrders.map((w) => [w.work_order_id, w.trade]));
  const approvedEndOfWindow = data.tables.quotes.filter((q) => q["status"] === "approved");
  const invoiceRows = data.tables.invoices.flatMap((i) =>
    approvedEndOfWindow
      .filter((q) => q.work_order_id === i.work_order_id)
      .map((q) => format(inv, { invoice_id: i.invoice_id, work_order_id: i.work_order_id, trade: trade.get(i.work_order_id), billed_quote_id: i.quote_id, approved_quote_id: q.quote_id, invoice_total: i.total, approved_total: q.total })),
  );
  const system = (t: string) => (t === "client_message" ? "client portal" : "contractor ops");
  const timeline = data.records
    .filter((r) => ["client_message", "internal_note", "field_note"].includes(r.source_type))
    .map((r) => format(tl, { work_order_id: r.thread_id, source_recorded_at: r.source_recorded_at, system: system(r.source_type), source_type: r.source_type, record_id: r.record_id, text: r.text }));
  return { invoice_vs_approved: sortRows(inv, invoiceRows), job_evidence_timeline: sortRows(tl, timeline) };
}

export function formatViewRows(v: ViewDef, rows: Record<string, unknown>[]): Row[] {
  return sortRows(v, rows.map((r) => format(v, r)));
}
