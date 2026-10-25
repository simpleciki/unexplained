// The value-metric classification (docs/value-metrics.md): designed outcome per document, the six-cell table,
// the tally, and the records a person would read. Small invented rows, no files and no model.
import { describe, expect, it } from "vitest";
import type { SourceRecord } from "../engine/types.ts";
import { classify, designedInvoice, designedQuote, median, recordsToRead, tally } from "./value-metrics.ts";

describe("designed outcome", () => {
  it("reads quote status as the definition says", () => {
    expect(designedQuote({ quote_id: "Q-1", status: "approved" }).outcome).toBe("clean");
    for (const status of ["rejected", "voided", "submitted"]) expect(designedQuote({ quote_id: "Q-1", status }).outcome).toBe("problem");
    expect(() => designedQuote({ quote_id: "Q-1", status: "draft" })).toThrow(/not in docs\/value-metrics.md/);
  });

  it("reads an invoice draft by the version it bills", () => {
    const status = new Map([["Q-A", "approved"], ["Q-S", "submitted"]]);
    expect(designedInvoice({ invoice_id: "I", status: "paid", quote_id: "Q-A" }, status).outcome).toBe("clean");
    expect(designedInvoice({ invoice_id: "I", status: "disputed", quote_id: "Q-A" }, status).outcome).toBe("problem");
    expect(designedInvoice({ invoice_id: "I", status: "draft", quote_id: "Q-S" }, status).outcome).toBe("problem");
    // A draft on an approved version, or a sent invoice, is not defined: it fails instead of being guessed.
    expect(() => designedInvoice({ invoice_id: "I", status: "draft", quote_id: "Q-A" }, status)).toThrow();
    expect(() => designedInvoice({ invoice_id: "I", status: "sent", quote_id: "Q-A" }, status)).toThrow();
  });
});

describe("six-cell table", () => {
  it("maps designed outcome and check state to the named outcome", () => {
    expect(classify("problem", "warnings")).toBe("caught");
    expect(classify("problem", "not_cleared")).toBe("held");
    expect(classify("problem", "clear")).toBe("missed");
    expect(classify("clean", "warnings")).toBe("false_alarm");
    expect(classify("clean", "not_cleared")).toBe("needs_person");
    expect(classify("clean", "clear")).toBe("cleared");
  });

  it("tallies count and money, and stopped = caught + held over problem documents", () => {
    const t = tally([
      { id: "a", outcome: "caught", designed: "problem", total: 100 },
      { id: "b", outcome: "held", designed: "problem", total: 50 },
      { id: "c", outcome: "missed", designed: "problem", total: 50 },
      { id: "d", outcome: "false_alarm", designed: "clean", total: 10 },
      { id: "e", outcome: "cleared", designed: "clean", total: 30 },
    ]);
    expect(t.problem).toEqual({ n: 3, total: 200 });
    expect(t.stopped_before_sending).toMatchObject({ n: 2, total: 150, pct_by_count: 66.67, pct_by_money: 75 });
    expect(t.missed).toMatchObject({ n: 1, total: 50, pct_by_count: 33.33, pct_by_money: 25 });
    expect(t.false_alarms).toMatchObject({ n: 1, total: 10, pct_by_count: 50, pct_by_money: 25 });
    expect(t.by_outcome.needs_person).toEqual({ n: 0, total: 0 });
  });
});

describe("records a person would read", () => {
  const rec = (id: string, job: string, at: string): SourceRecord => ({ record_id: id, source_type: "client_message", source_version: "v1", text: "", author: "x", source_recorded_at: at, thread_id: job });
  const workOrders = [
    { work_order_id: "WO-1", client_id: "c1" },
    { work_order_id: "WO-2", client_id: "c1" },
    { work_order_id: "WO-3", client_id: "c2" },
  ];
  const records = [rec("r1", "WO-1", "2026-05-01T09:00:00-05:00"), rec("r2", "WO-2", "2026-05-02T09:00:00-05:00"), rec("r3", "WO-3", "2026-05-02T09:00:00-05:00"), rec("r4", "WO-1", "2026-05-03T09:00:00-05:00")];

  it("counts the job and the client's other jobs up to the cut-off, not other clients or later records", () => {
    const cut = Date.parse("2026-05-03T09:00:00-05:00") - 1;
    expect(recordsToRead(records, workOrders, "WO-1", cut)).toEqual({ client_and_job: 2, job_only: 1 });
  });

  it("median of odd and even lists", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});
