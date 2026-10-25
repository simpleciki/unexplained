// The value metrics pre-registered in docs/value-metrics.md, as pure functions (scripts/value-metrics.ts does
// the reading and printing). No model calls: the verdict is the check page's own (src/ui/api.ts check()).
// Ground truth is the generator's designed outcome, i.e. the end-of-window status columns; it is used here to
// score verdicts, never to make one.
import type { Row, SourceRecord } from "../engine/types.ts";

export type Designed = { outcome: "problem" | "clean"; why: string };
export type State = "warnings" | "not_cleared" | "clear";
export type Outcome = "caught" | "held" | "missed" | "false_alarm" | "needs_person" | "cleared";

// problem: a quote version rejected, voided, or submitted and never approved; an invoice disputed, or a draft
// raised on a version that was never approved. clean: a quote approved as sent; an invoice paid. Any other
// status is not in the definition, so it throws rather than being guessed into a bucket.
export function designedQuote(q: Row): Designed {
  if (q.status === "approved") return { outcome: "clean", why: "approved" };
  if (q.status === "rejected" || q.status === "voided") return { outcome: "problem", why: q.status };
  if (q.status === "submitted") return { outcome: "problem", why: "submitted, never approved" };
  throw new Error(`quote ${q.quote_id}: status ${q.status} is not in docs/value-metrics.md`);
}

export function designedInvoice(i: Row, quoteStatus: Map<string, string>): Designed {
  if (i.status === "paid") return { outcome: "clean", why: "paid" };
  if (i.status === "disputed") return { outcome: "problem", why: "disputed" };
  if (i.status === "draft") {
    const billed = quoteStatus.get(i.quote_id);
    if (billed !== "approved") return { outcome: "problem", why: `draft on ${i.quote_id} (${billed ?? "unknown"}, never approved)` };
  }
  throw new Error(`invoice ${i.invoice_id}: status ${i.status} on ${i.quote_id} is not in docs/value-metrics.md`);
}

const TABLE: Record<Designed["outcome"], Record<State, Outcome>> = {
  problem: { warnings: "caught", not_cleared: "held", clear: "missed" },
  clean: { warnings: "false_alarm", not_cleared: "needs_person", clear: "cleared" },
};
export const classify = (designed: Designed["outcome"], state: State): Outcome => TABLE[designed][state];

export const OUTCOMES: Outcome[] = ["caught", "held", "missed", "false_alarm", "needs_person", "cleared"];
const r2 = (n: number) => Math.round(n * 100) / 100;

export type DocResult = { id: string; outcome: Outcome; designed: Designed["outcome"]; total: number };
export function tally(docs: DocResult[]) {
  const by = Object.fromEntries(OUTCOMES.map((o) => [o, { n: 0, total: 0 }])) as Record<Outcome, { n: number; total: number }>;
  for (const d of docs) {
    by[d.outcome].n++;
    by[d.outcome].total = r2(by[d.outcome].total + d.total);
  }
  const sum = (os: Outcome[]) => ({ n: os.reduce((a, o) => a + by[o].n, 0), total: r2(os.reduce((a, o) => a + by[o].total, 0)) });
  const problem = sum(["caught", "held", "missed"]);
  const clean = sum(["false_alarm", "needs_person", "cleared"]);
  const stopped = sum(["caught", "held"]);
  const rate = (a: number, b: number) => (b ? r2((a / b) * 100) : null);
  return {
    by_outcome: by,
    problem,
    clean,
    stopped_before_sending: { ...stopped, pct_by_count: rate(stopped.n, problem.n), pct_by_money: rate(stopped.total, problem.total) },
    missed: { ...by.missed, pct_by_count: rate(by.missed.n, problem.n), pct_by_money: rate(by.missed.total, problem.total) },
    false_alarms: { ...by.false_alarm, pct_by_count: rate(by.false_alarm.n, clean.n), pct_by_money: rate(by.false_alarm.total, clean.total) },
  };
}

// Every record on file for the work order and for its client (all of the client's work orders, which includes
// this one), written by the cut-off, from both source systems (client portal and contractor ops records alike).
export function recordsToRead(records: SourceRecord[], workOrders: Row[], job: string, asOf: number) {
  const client = workOrders.find((w) => w.work_order_id === job)?.client_id;
  const clientJobs = new Set(workOrders.filter((w) => w.client_id === client).map((w) => w.work_order_id));
  const upTo = records.filter((r) => Date.parse(r.source_recorded_at) <= asOf);
  return {
    client_and_job: upTo.filter((r) => r.thread_id && clientJobs.has(r.thread_id)).length,
    job_only: upTo.filter((r) => r.thread_id === job).length,
  };
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
