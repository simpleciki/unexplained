// Category rules on the real dataset, with in-memory edits to make the cases the gold does not cover.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseJsonl } from "../engine/data.ts";
import { buildEngine } from "../engine/engine.ts";
import { answerQuestion } from "../engine/answer.ts";
import type { DecisionCard, RelationEdge } from "../engine/types.ts";
import type { GoldQuestion } from "./oracle.ts";

const root = join(import.meta.dirname, "../..");
const gold = <T>(f: string) => parseJsonl<T>(readFileSync(join(root, "eval/gold", f), "utf8"));
const fresh = () => buildEngine(root, gold<DecisionCard>("gold_cards.jsonl"), gold<RelationEdge>("gold_edges.jsonl"));
const q = (id: string) => gold<GoldQuestion>("gold_questions.jsonl").find((x) => x.question_id === id)!;
const flags = (a: ReturnType<typeof answerQuestion>) => a.flags.map((f) => f.pattern);

describe("client portal categories", () => {
  it("a travel line on a client portal that does not accept travel is off the structure norm", () => {
    const a = answerQuestion(fresh(), q("q-p6-pw03-trip"));
    const p6 = a.flags.find((f) => f.pattern === "P6")!;
    expect((p6.details.structure as { off: string[] }).off.join(" ")).toMatch(/travel: the client portal does not accept/);
    expect((p6.details.amount as { status?: string }).status).toBe("no amount norm yet");
  });

  it("an invoice may split a line into more detail as long as category totals match", () => {
    const engine = fresh();
    const lines = engine.data.tables.invoiceLines;
    const i = lines.findIndex((l) => l.invoice_id === "INV-NL-01" && l.category === "material");
    const half = (Number(lines[i].amount) / 2).toFixed(2);
    lines.splice(i, 1, { ...lines[i], qty: "1", unit_price: half, amount: half, description: "part A" }, { ...lines[i], qty: "1", unit_price: half, amount: half, description: "part B" });
    expect(flags(answerQuestion(engine, q("q-ctrl-nl01-inv")))).not.toContain("P7");
    lines[i].amount = (Number(half) + 10).toFixed(2);
    const a = answerQuestion(engine, q("q-ctrl-nl01-inv"));
    expect(flags(a)).toContain("P7");
    expect((a.flags.find((f) => f.pattern === "P7")!.details.mismatches as string[]).join(" ")).toMatch(/material total/);
  });

  it("a category total far outside the approved range for that client and trade breaks the amount norm", () => {
    const engine = fresh();
    const v3 = engine.docs.versions.find((v) => v.quote_id === "Q-NL-01-v3")!;
    v3.lines = v3.lines.map((l) => (l.category === "labor" ? { ...l, qty: l.qty * 5, amount: l.amount * 5 } : l));
    const a = answerQuestion(engine, q("q-ctrl-nl01-send"));
    const p6 = a.flags.find((f) => f.pattern === "P6");
    expect(p6).toBeDefined();
    expect((p6!.details.amount as { off: string[] }).off.join(" ")).toMatch(/labor total .* outside the approved electrical range/);
  });
});
