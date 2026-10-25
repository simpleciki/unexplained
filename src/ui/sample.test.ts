// The sample day's draw (docs/value-metrics-amendment-1.md section 5) is pinned: the same seed and lists give
// the same 10 documents, and the picks are not swapped afterwards. Plus the PRNG and draw on their own.
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadDataset } from "../engine/data.ts";
import { designedInvoice, designedQuote } from "../eval/value-metrics.ts";
import { drawWithoutReplacement, mulberry32, sampleDay } from "./sample.ts";

const repo = join(import.meta.dirname, "../..");

describe("sample day", () => {
  it("draws the pinned 10 from the 33 designed-problem and 25 designed-clean documents", () => {
    const t = loadDataset(repo).tables;
    const qs = new Map(t.quotes.map((q) => [q.quote_id, q.status]));
    const all = [...t.quotes.map((q) => ({ id: q.quote_id, o: designedQuote(q).outcome })), ...t.invoices.map((i) => ({ id: i.invoice_id, o: designedInvoice(i, qs).outcome }))];
    const problem = all.filter((x) => x.o === "problem").map((x) => x.id);
    const clean = all.filter((x) => x.o === "clean").map((x) => x.id);
    expect([problem.length, clean.length]).toEqual([33, 25]);
    expect(sampleDay(problem, clean)).toEqual({
      problems: ["Q-NL-04-v3", "Q-PW-05-v2"],
      clean: ["Q-OC-02-v1", "Q-RM-02-v1", "Q-NL-03-v1", "Q-PW-04-v1", "Q-NL-02-v1", "INV-PW-01", "Q-PW-01-v1", "Q-NL-01-v2"],
    });
    // The input order does not matter: each list is sorted by id before the draw.
    expect(sampleDay([...problem].reverse(), [...clean].reverse())).toEqual(sampleDay(problem, clean));
  });

  it("is a seeded, repeatable draw without replacement", () => {
    const a = mulberry32(1), b = mulberry32(1);
    const xs = Array.from({ length: 5 }, () => a());
    expect(Array.from({ length: 5 }, () => b())).toEqual(xs);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    const ids = ["e", "d", "c", "b", "a"];
    const pick = drawWithoutReplacement(ids, 5, mulberry32(7));
    expect([...pick].sort()).toEqual(["a", "b", "c", "d", "e"]);
    expect(() => drawWithoutReplacement(ids, 6, mulberry32(7))).toThrow();
  });
});
