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
const engine = buildEngine(root, gold<DecisionCard>("gold_cards.jsonl"), gold<RelationEdge>("gold_edges.jsonl"));
const q = (id: string) => gold<GoldQuestion>("gold_questions.jsonl").find((x) => x.question_id === id)!;

describe("oracle run on the hero case", () => {
  it("lists competing causes for three unexplained rejections and never picks one", () => {
    const a = answerQuestion(engine, q("q-p5-heron-why"), { clientExplanation: "absent" });
    const p5 = a.flags.find((f) => f.pattern === "P5")!;
    const d = p5.details as { rejections: { reason_stated: boolean }[]; candidate_causes: unknown[] };
    expect(d.rejections).toHaveLength(3);
    expect(d.rejections.every((r) => !r.reason_stated)).toBe(true);
    expect(d.candidate_causes.length).toBeGreaterThanOrEqual(4);
    expect(a.flags.map((f) => f.pattern)).toEqual(expect.arrayContaining(["P5", "P1", "P4"]));
  });

  it("says nothing can be invoiced while no version is approved", () => {
    const a = answerQuestion(engine, q("q-p7-heron-invoice"));
    expect(a.flags.map((f) => f.pattern)).toEqual(["P7"]);
  });

  it("writes every accepted card to H-MEM with no drift from the seat table", () => {
    expect(engine.memory.drift).toBe(0);
    expect(engine.memory.memOf.size).toBe(engine.graph.cards.size);
  });
});
