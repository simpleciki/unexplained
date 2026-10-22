import { describe, expect, it } from "vitest";
import type { EngineEvent } from "./types.ts";
import { SeatGraph } from "./seats.ts";
import { writeMemory } from "./memory.ts";
import { card, rec, replaces, vocab } from "./fixtures.test-helpers.ts";

function graph() {
  const r1 = rec("Anything over $2500 needs a note from me.", "2026-03-10T08:00:00-05:00");
  const r2 = rec("Actually the cap is lifted. Anything over $2500 no longer needs a note from me.", "2026-06-02T08:11:00-05:00");
  const r3 = rec("Labor $90/h.", "2026-03-02T09:00:00-06:00");
  const cards = [
    card("cap.in", r1, { topic: "client_rule", facets: ["client_rule.cap"] }),
    card("cap.out", r2, { topic: "client_rule", facets: ["client_rule.cap"] }),
    card("labor", r3),
  ];
  return new SeatGraph(cards, [replaces("cap.in", "cap.out")], [r1, r2, r3], vocab);
}

describe("H-MEM write-through", () => {
  it("reads a superseded card back with supersededBy pointing at its successor", () => {
    const { hmem, memOf, drift } = writeMemory(graph());
    const oldMem = hmem.store.get(memOf.get("cap.in")!)!;
    const newMem = hmem.store.get(memOf.get("cap.out")!)!;
    expect(oldMem.supersededBy).toBe(newMem.id);
    expect(newMem.supersedes).toBe(oldMem.id);
    expect(newMem.provenance.refs).toEqual(["cap.out"]);
    expect(newMem.source).toMatch(/^r\d+$/);
    expect(drift).toBe(0);
  });

  it("is idempotent by card_id", () => {
    const g = graph();
    const first = writeMemory(g);
    const again = writeMemory(g, undefined, first.hmem);
    expect(again.hmem.store.all()).toHaveLength(3);
  });

  it("overrides a supersession H-MEM guessed from wording and logs it to the trust ledger", () => {
    // "labor" was written after a near-identical correction-worded text would auto-link; force the case:
    const r1 = rec("Labor rate is ninety dollars per hour for the panel job.", "2026-03-02T09:00:00-06:00");
    const r2 = rec("Actually labor rate is ninety dollars per hour for the panel job.", "2026-03-03T09:00:00-06:00");
    const g = new SeatGraph([card("a", r1), card("b", r2, { facets: ["price.material"] })], [], [r1, r2], vocab);
    const events: EngineEvent[] = [];
    const { hmem, memOf } = writeMemory(g, (e) => events.push(e));
    const b = hmem.store.get(memOf.get("b")!)!;
    expect(b.supersedes).toBeUndefined();
    expect(hmem.ledger.all().some((e) => e.action === "conflict_resolved" && e.memoryId === b.id)).toBe(true);
    expect(events.some((e) => e.action === "hmem_override")).toBe(true);
  });
});
