// Extraction precision / recall against gold cards, and relation accuracy against gold edges.
// A model card matches a gold card when it comes from the same record, has the same mode, and its quote
// shares at least 80% of tokens with the gold quote (overlap / the longer quote). Matching is one-to-one.
import type { DecisionCard, RelationEdge } from "../engine/types.ts";

const tokens = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9$.' ]/g, " ").split(/\s+/).filter(Boolean));

export function quoteOverlap(a: string, b: string): number {
  const x = tokens(a);
  const y = tokens(b);
  const shared = [...x].filter((t) => y.has(t)).length;
  return shared / Math.max(x.size, y.size, 1);
}

export function matchCards(model: DecisionCard[], gold: DecisionCard[], threshold = 0.8): Map<string, string> {
  const goldToModel = new Map<string, string>();
  const used = new Set<string>();
  for (const g of gold) {
    let best: { id: string; score: number } | null = null;
    for (const m of model) {
      if (used.has(m.card_id) || m.record_id !== g.record_id || m.mode !== g.mode) continue;
      const score = quoteOverlap(m.quote, g.quote);
      if (score >= threshold && (!best || score > best.score)) best = { id: m.card_id, score };
    }
    if (best) {
      goldToModel.set(g.card_id, best.id);
      used.add(best.id);
    }
  }
  return goldToModel;
}

// Live scoring speaks gold ids: each model card id that matched a gold card (same record, same mode,
// quote overlap >= the match threshold, one-to-one) becomes that gold id; an unmatched id stays itself
// and so counts as wrong. Oracle answers already use gold ids and are never translated.
export function toGoldIds<A extends { current_card: string | null; in_effect_card: string | null; reasons: string[] }>(answer: A, goldToModel: Map<string, string>): A {
  const modelToGold = new Map([...goldToModel].map(([g, m]) => [m, g]));
  const t = (id: string | null) => (id === null ? null : (modelToGold.get(id) ?? id));
  return { ...answer, current_card: t(answer.current_card), in_effect_card: t(answer.in_effect_card), reasons: answer.reasons.map((r) => t(r)!) };
}

export function extractionScore(model: DecisionCard[], gold: DecisionCard[]) {
  const m = matchCards(model, gold);
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  return {
    model_cards: model.length,
    gold_cards: gold.length,
    matched: m.size,
    precision: model.length ? r3(m.size / model.length) : null,
    recall: gold.length ? r3(m.size / gold.length) : null,
    unmatched_gold: gold.filter((g) => !m.has(g.card_id)).map((g) => g.card_id),
    match: m,
  };
}

// For each gold edge whose two cards were both matched, compare the model's relation for that pair
// (no model edge = UNRELATED).
export function relationScore(modelEdges: RelationEdge[], goldEdges: RelationEdge[], match: Map<string, string>) {
  const rel = new Map(modelEdges.map((e) => [`${e.old_card}>${e.new_card}`, e.relation]));
  const rows = goldEdges
    .filter((g) => match.has(g.old_card) && match.has(g.new_card))
    .map((g) => {
      const a = match.get(g.old_card)!;
      const b = match.get(g.new_card)!;
      const got = rel.get(`${a}>${b}`) ?? rel.get(`${b}>${a}`) ?? "UNRELATED";
      return { gold: `${g.old_card}>${g.new_card}`, expected: g.relation, got, ok: got === g.relation };
    });
  return {
    gold_edges: goldEdges.length,
    comparable: rows.length,
    accuracy: rows.length ? Math.round((rows.filter((r) => r.ok).length / rows.length) * 1000) / 1000 : null,
    rows,
  };
}
