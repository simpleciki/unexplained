// Invoices whose billed quote was never approved on that job, one row each, and how far
// the invoice total differs from the approved total. The view has one row per approved
// quote, so an invoice stays only when none of its rows match the quote it bills.
// One read-only SELECT against the cross-source view.
import { clientFromEnv } from "../src/zetaris/client.ts";
import { formatValue, qualified } from "../src/zetaris/schema.ts";

const view = qualified("v_invoice_vs_approved");
const columns = ["invoice_id", "work_order_id", "trade", "billed_quote_id", "approved_quote_id", "invoice_total", "approved_total", "overage", "approved_n"] as const;

const sql = [
  "SELECT invoice_id,",
  "       MAX(work_order_id) AS work_order_id,",
  "       MAX(trade) AS trade,",
  "       MAX(billed_quote_id) AS billed_quote_id,",
  "       MIN(approved_quote_id) AS approved_quote_id,",
  "       MAX(invoice_total) AS invoice_total,",
  "       MIN(approved_total) AS approved_total,",
  "       MAX(invoice_total) - MIN(approved_total) AS overage,",
  "       COUNT(DISTINCT approved_quote_id) AS approved_n",
  `FROM ${view}`,
  "GROUP BY invoice_id",
  "HAVING SUM(CASE WHEN billed_quote_id = approved_quote_id THEN 1 ELSE 0 END) = 0",
].join("\n");

const money = (v: unknown) => formatValue(v, "money");
const cents = (v: unknown) => Math.round(Number(money(v)) * 100);

const textCols = ["invoice_id", "work_order_id", "trade", "billed_quote_id", "approved_quote_id"] as const;
const moneyCols = ["invoice_total", "approved_total", "overage"] as const;

try {
  const client = clientFromEnv();
  const rows = (await client.query(sql, [...columns], view))
    .map((r) => {
      const approvedN = Number(r.approved_n);
      if (approvedN !== 1) throw new Error(`${r.invoice_id} bills a quote that was never approved, but the job has ${approvedN} approved quotes`);
      const over = cents(r.invoice_total) - cents(r.approved_total);
      if (cents(r.overage) !== over) throw new Error(`${r.invoice_id} overage ${String(r.overage)} is not invoice total minus approved total`);
      return {
        invoice_id: String(r.invoice_id),
        work_order_id: String(r.work_order_id),
        trade: String(r.trade),
        billed_quote_id: String(r.billed_quote_id),
        approved_quote_id: String(r.approved_quote_id),
        invoice_total: money(r.invoice_total),
        approved_total: money(r.approved_total),
        overage: money(r.overage),
        overageCents: over,
      };
    })
    .sort((a, b) => b.overageCents - a.overageCents || a.invoice_id.localeCompare(b.invoice_id) || a.approved_quote_id.localeCompare(b.approved_quote_id));

  const widths = {
    invoice_id: Math.max("invoice_id".length, ...rows.map((r) => r.invoice_id.length), "total".length),
    work_order_id: Math.max("work_order_id".length, ...rows.map((r) => r.work_order_id.length)),
    trade: Math.max("trade".length, ...rows.map((r) => r.trade.length)),
    billed_quote_id: Math.max("billed_quote_id".length, ...rows.map((r) => r.billed_quote_id.length)),
    approved_quote_id: Math.max("approved_quote_id".length, ...rows.map((r) => r.approved_quote_id.length)),
    invoice_total: Math.max("invoice_total".length, ...rows.map((r) => r.invoice_total.length)),
    approved_total: Math.max("approved_total".length, ...rows.map((r) => r.approved_total.length)),
    overage: Math.max("overage".length, ...rows.map((r) => r.overage.length), money(rows.reduce((s, r) => s + r.overageCents, 0) / 100).length),
  };

  const line = (cells: Record<string, string>) =>
    [...textCols.map((c) => cells[c].padEnd(widths[c])), ...moneyCols.map((c) => cells[c].padStart(widths[c]))].join("  ");

  console.log(line({ invoice_id: "invoice_id", work_order_id: "work_order_id", trade: "trade", billed_quote_id: "billed_quote_id", approved_quote_id: "approved_quote_id", invoice_total: "invoice_total", approved_total: "approved_total", overage: "overage" }));
  for (const r of rows) console.log(line(r));
  const totalCents = rows.reduce((s, r) => s + r.overageCents, 0);
  console.log(line({ invoice_id: "total", work_order_id: "", trade: "", billed_quote_id: "", approved_quote_id: "", invoice_total: "", approved_total: "", overage: money(totalCents / 100) }));
} catch (e) {
  console.error(`error: ${(e as Error).message}`);
  process.exit(1);
}
