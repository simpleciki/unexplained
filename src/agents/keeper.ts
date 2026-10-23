// Keeper.relate: how a newer decision relates to an older one on the same seat. The seat graph then
// checks the answer against decided_at; a replacement that contradicts the times becomes a conflict.
import type { DecisionCard, RelationEdge, SourceRecord } from "../engine/types.ts";
import { seatKey } from "../engine/types.ts";
import type { ModelClient } from "../llm/client.ts";
import { obj, oneOf } from "../llm/json.ts";
import { RULES } from "./shared.ts";

const RELATIONS = ["REPLACES", "SAME", "REFINES", "UNRELATED"] as const;

const SYSTEM = `You compare two decisions made on the same subject (same topic, facet and scope).
REPLACES: the newer one takes the older one's place. SAME: it says the same thing again.
REFINES: it adds detail and the older one still stands. UNRELATED: they are about different things.
Rules:
${RULES}
Return JSON only: {"relation":"REPLACES|SAME|REFINES|UNRELATED","reason":"one line"}`;

// Pairs to judge: every older/newer pair of client decisions that share a seat, plus every promise
// against a later result on its open-item seat (a promise is closed only by a judged REPLACES; without
// these pairs a kept promise would look open forever).
const judged = (c: DecisionCard) =>
  c.mode === "decides" || (c.topic === "open_item" && (c.mode === "proposes" || c.mode === "gives_reason"));
const promiseAndResult = (a: DecisionCard, b: DecisionCard) =>
  a.topic !== "open_item" || (a.mode === "proposes" && b.mode === "gives_reason");

export function seatPairs(cards: DecisionCard[]): [DecisionCard, DecisionCard][] {
  const bySeat = new Map<string, DecisionCard[]>();
  for (const c of cards.filter(judged)) {
    for (const facet of c.facets) {
      const k = seatKey({ topic: c.topic, facet, scope: c.scope });
      bySeat.set(k, [...(bySeat.get(k) ?? []), c]);
    }
  }
  const seen = new Set<string>();
  const pairs: [DecisionCard, DecisionCard][] = [];
  for (const list of bySeat.values()) {
    // Older first; two decisions made at the same moment are ordered by when they take effect.
    const sorted = [...list].sort((a, b) => Date.parse(a.decided_at) - Date.parse(b.decided_at) || Date.parse(a.effective) - Date.parse(b.effective));
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const k = `${sorted[i].card_id}>${sorted[j].card_id}`;
        const sameKind = sorted[i].topic !== "open_item" ? sorted[j].mode === "decides" && sorted[i].mode === "decides" : promiseAndResult(sorted[i], sorted[j]);
        if (!seen.has(k) && sameKind) pairs.push([sorted[i], sorted[j]]);
        seen.add(k);
      }
    }
  }
  return pairs;
}

export async function relate(
  client: ModelClient,
  model: string,
  older: DecisionCard,
  newer: DecisionCard,
  records: Map<string, SourceRecord>,
): Promise<RelationEdge & { reason: string }> {
  const show = (c: DecisionCard) =>
    `${c.card_id} decided ${c.decided_at} by ${c.decided_by}: "${c.quote}"\nfrom: """${records.get(c.record_id)?.text ?? ""}"""`;
  const user = `Older:\n${show(older)}\n\nNewer:\n${show(newer)}`;
  const r = await client.json(
    { stage: "ingest", agent: "Keeper.relate", model, system: SYSTEM, user },
    (v) => {
      const o = obj(v, "reply");
      return { relation: oneOf(o.relation, RELATIONS, "relation"), reason: typeof o.reason === "string" ? o.reason : "" };
    },
    1,
  );
  // No usable judgment: the pair stays unjudged, so the seat graph will not order it.
  const relation = r.value?.relation ?? "UNRELATED";
  return { old_card: older.card_id, new_card: newer.card_id, relation, reason: r.value?.reason ?? `no judgment: ${r.error}` };
}
