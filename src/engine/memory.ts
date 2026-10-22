// Writes accepted cards into Meterless H-MEM (storage, provenance, supersession audit).
// The seat table is the authority: H-MEM's own auto-links are overridden and every disagreement is logged.
import { HMEM } from "../../vendor/meterless-hmem/src/index.ts";
import type { MemoryRecord } from "../../vendor/meterless-hmem/src/index.ts";
import type { EventSink } from "./types.ts";
import { noEvents } from "./types.ts";
import { ms } from "./docs.ts";
import type { SeatGraph } from "./seats.ts";

const ACTOR = "unexplained-engine";

export type MemoryWrite = { hmem: HMEM; memOf: Map<string, string>; overrides: number; drift: number };

const findByCard = (hmem: HMEM, cardId: string): MemoryRecord | undefined =>
  hmem.store.all().find((m) => m.provenance.refs?.includes(cardId));

export function writeMemory(graph: SeatGraph, emit: EventSink = noEvents, hmem?: HMEM): MemoryWrite {
  let now = 0;
  const mem = hmem ?? new HMEM({ clock: () => now, actor: ACTOR });
  const memOf = new Map<string, string>();
  const replaces = graph.links.filter((l) => l.status === "ok" && l.relation === "REPLACES");
  const predecessorOf = new Map(replaces.map((l) => [l.to, l.from]));
  let overrides = 0;

  const ordered = [...graph.cards.values()].sort((a, b) => ms(a.decided_at) - ms(b.decided_at));
  for (const card of ordered) {
    const existing = findByCard(mem, card.card_id); // idempotent by card_id
    if (existing) {
      memOf.set(card.card_id, existing.id);
      continue;
    }
    now = ms(card.decided_at);
    const rec = mem.add({
      content: card.quote,
      type: "factual",
      source: card.record_id,
      provenance: { origin: "document", learnedAt: now, label: card.record_id, refs: [card.card_id] },
      tags: [card.topic, ...card.facets, card.scope],
    });
    memOf.set(card.card_id, rec.id);
    const pred = predecessorOf.get(card.card_id);
    const ours = pred ? memOf.get(pred) : undefined;
    if (rec.supersedes !== ours) {
      // H-MEM guessed a supersession from wording; the seat table decides.
      mem.ledger.log(rec.id, "conflict_resolved", ACTOR, {
        details: { field: "supersedes", hmem_value: rec.supersedes ?? null, seat_table_value: ours ?? null, card_id: card.card_id },
      });
      mem.store.update(rec.id, { supersedes: ours });
      overrides++;
      emit({ action: "hmem_override", ref: card.card_id, outcome: "supersedes overwritten", details: { hmem: rec.supersedes, ours } });
    }
  }

  for (const l of replaces) {
    const oldId = memOf.get(l.from)!;
    const newId = memOf.get(l.to)!;
    if (mem.store.get(newId)?.supersedes !== oldId) mem.store.update(newId, { supersedes: oldId });
    if (mem.store.get(oldId)?.supersededBy !== newId) mem.store.update(oldId, { supersededBy: newId });
  }

  // Drift check: what H-MEM now says against the seat table.
  let drift = 0;
  const status = graph.cardStatus();
  for (const [cardId, memId] of memOf) {
    const want = status[cardId]?.replaced_by ? memOf.get(status[cardId].replaced_by!) : undefined;
    const got = mem.store.get(memId)?.supersededBy;
    if (want !== got) {
      drift++;
      emit({ action: "hmem_drift", ref: cardId, outcome: "supersededBy differs from seat table", details: { want, got } });
    }
  }
  return { hmem: mem, memOf, overrides, drift };
}
