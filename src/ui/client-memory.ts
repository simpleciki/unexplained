// "What this client told us before": the check page's recall from Meterless H-MEM (engine.memory.hmem). H-MEM is
// where every accepted card is written with its provenance (src/engine/memory.ts); this is the feature that reads
// it back. Retrieval is H-MEM's own query(), with no score threshold and no top-N cut, so nothing on file is dropped
// by a relevance score; the filters below are by scope, time and supersession, and every dropped item is counted.
// Display only: the verdict never reads this (the seat table and detectors stay the authority).
import type { HMEM, MemoryRecord } from "../../vendor/meterless-hmem/src/index.ts";

// rule: a client rule; decision: an approval or a rejection (one group: the engine's polarity guess is a word
// list and is not repeated here as a label); other: everything else in scope.
export type RecallKind = "rule" | "decision" | "other";
export type RecallItem = {
  memory_id: string;
  card_id: string | null;
  kind: RecallKind;
  who: string | null; // person id (from the card the memory was written from)
  learned_at: number; // H-MEM provenance.learnedAt (the card's decided_at)
  record_id: string; // provenance.label: the source record
  record_at: string | null; // when that record was written
  text: string; // the memory's content: the card's exact quote
  scope: string | null;
  relevance: number; // H-MEM's score for the query (shown, not used to order)
  disagree: boolean; // H-MEM and the seat table disagree about whether it was superseded
};
export type RecallInput = {
  hmem: HMEM;
  client: string;
  jobs: string[]; // the client's work orders
  asOf: number;
  query: string;
  cardOf: (cardId: string) => { decided_by: string; topic: string } | undefined;
  recordAt: (recordId: string) => string | undefined;
  // The seat table's successor for a card, as a memory id (undefined = not replaced).
  seatSuccessor: (cardId: string) => string | undefined;
};
export type Recall = { items: RecallItem[]; recalled: number; dropped: { other_scope: number; after_cutoff: number; superseded: number } };

const ORDER: RecallKind[] = ["rule", "decision", "other"];

export function recallClient(x: RecallInput): Recall {
  const all = x.hmem.store.all();
  // Every memory, ranked by H-MEM (threshold 0, top N = all of them).
  const res = x.hmem.query(x.query, { threshold: 0, topN: Math.max(all.length, 1) });
  const scopes = new Set([`client:${x.client}`, ...x.jobs.map((j) => `job:${j}`)]);
  const dropped = { other_scope: 0, after_cutoff: 0, superseded: 0 };
  const items: RecallItem[] = [];
  for (const { memory: m, relevance } of res.memories) {
    const scope = m.tags.find((t) => scopes.has(t)) ?? null;
    if (!scope) { dropped.other_scope++; continue; }
    const recordAt = x.recordAt(m.provenance.label ?? m.source);
    // Learned by the cut-off, and its record written by then (a decision logged later was not on file yet).
    if (m.provenance.learnedAt > x.asOf || !recordAt || Date.parse(recordAt) > x.asOf) { dropped.after_cutoff++; continue; }
    const cardId = m.provenance.refs?.[0] ?? null;
    const seatNext = cardId ? x.seatSuccessor(cardId) : undefined;
    const disagree = (m.supersededBy ?? undefined) !== seatNext;
    const successor: MemoryRecord | undefined = m.supersededBy ? x.hmem.store.get(m.supersededBy) : undefined;
    // Superseded by a memory learned by the cut-off: dropped, unless the seat table disagrees (then shown, marked).
    if (successor && successor.provenance.learnedAt <= x.asOf && !disagree) { dropped.superseded++; continue; }
    const card = cardId ? x.cardOf(cardId) : undefined;
    const topic = card?.topic ?? m.tags[0];
    const kind: RecallKind = topic === "client_rule" ? "rule" : topic === "approval" && m.tags.includes("approval.status") ? "decision" : "other";
    items.push({ memory_id: m.id, card_id: cardId, kind, who: card?.decided_by ?? null, learned_at: m.provenance.learnedAt, record_id: m.provenance.label ?? m.source, record_at: recordAt, text: m.content, scope, relevance: Number(relevance.toFixed(4)), disagree });
  }
  items.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || b.learned_at - a.learned_at || a.memory_id.localeCompare(b.memory_id));
  return { items, recalled: res.memories.length, dropped };
}
