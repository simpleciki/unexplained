// Task 006 step 6: live answers name model cards (m.rec-0200.0.0); the scorer compares gold ids.
import { describe, expect, it } from "vitest";
import type { Answer } from "../engine/answer.ts";
import type { DecisionCard } from "../engine/types.ts";
import { extractionScore, toGoldIds } from "./extraction-score.ts";
import { scoreQuestion } from "./scoring.ts";
import type { GoldQuestion } from "./scoring.ts";

const card = (id: string, quote: string): DecisionCard => ({
  card_id: id, record_id: "rec-0200", quote, mode: "decides", topic: "price", facets: ["price.labor"],
  scope: "client:cl.red_mill", decided_at: "2026-05-12T10:15:00-05:00", effective: "2026-06-01T00:00:00-05:00", decided_by: "p.rm.yvette_sarn",
});
const gold = [card("card.rm.labor.new", "From 1 June 2026 Red Mill mechanical labor is $96 per hour")];
const q: GoldQuestion = {
  question_id: "q", pattern: "T10", question: "?", as_of: null, seats: [],
  expected_current_card: "card.rm.labor.new", expected_in_effect_card: null, expected_reasons: ["card.rm.labor.new"], expected_flags: [],
};
const answer = (id: string) => ({ current_card: id, in_effect_card: null, reasons: [id], flags: [] }) as unknown as Answer;

describe("live scoring maps model card ids to gold ids", () => {
  it("a model card with the matching quote scores current_ok", () => {
    const model = [card("m.rec-0200.0.0", "From 1 June 2026 Red Mill mechanical labor is $96 per hour")];
    const { match } = extractionScore(model, gold);
    const s = scoreQuestion(q, toGoldIds(answer("m.rec-0200.0.0"), match));
    expect(s.current_ok).toBe(true);
    expect(s.reasons_ok).toBe(true);
  });

  it("one with a different quote stays unmatched and scores wrong", () => {
    const model = [card("m.rec-0200.0.1", "Material prices already approved stay as they are")];
    const { match } = extractionScore(model, gold);
    const s = scoreQuestion(q, toGoldIds(answer("m.rec-0200.0.1"), match));
    expect(s.current_ok).toBe(false);
    expect(s.why.join(" ")).toMatch(/current m\.rec-0200\.0\.1 != card\.rm\.labor\.new/);
  });

  it("without translation (the old behaviour) even the right card fails", () => {
    expect(scoreQuestion(q, answer("m.rec-0200.0.0")).current_ok).toBe(false);
  });
});
