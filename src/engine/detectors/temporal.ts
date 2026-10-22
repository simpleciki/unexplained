// T2 / T6 / T10: time effects on the seats a question routes to.
import type { Flag } from "../types.ts";
import { ms } from "../docs.ts";
import type { SeatResolution } from "../seats.ts";
import type { DetectCtx } from "./context.ts";
import { uniq } from "./context.ts";

// T2: the answer rests on a decision that was made by the as-of date but written down after it.
export function detectT2(ctx: DetectCtx, seats: SeatResolution[]): Flag {
  const late = uniq(seats.flatMap((s) => [s.current_card, s.in_effect_card]).filter((x): x is string => !!x)).filter((id) => {
    const c = ctx.graph.cards.get(id)!;
    const rec = ctx.data.records.find((r) => r.record_id === c.record_id)!;
    return ms(c.decided_at) <= ctx.asOf && ms(rec.source_recorded_at) > ctx.asOf;
  });
  return { pattern: "T2", fired: late.length > 0, evidence: late, details: { decided_before_written: late } };
}

// T10: a change is decided but not yet in effect on the as-of date.
export function detectT10(_ctx: DetectCtx, seats: SeatResolution[]): Flag {
  const scheduled = seats.filter((s) => s.scheduled);
  return {
    pattern: "T10",
    fired: scheduled.length > 0,
    evidence: uniq(scheduled.flatMap((s) => [s.scheduled!, s.in_effect_card].filter((x): x is string => !!x))),
    details: { scheduled: scheduled.map((s) => ({ seat: s.seat, scheduled: s.scheduled, in_effect: s.in_effect_card })) },
  };
}

// T6: one message replaced the labor price but kept material as it was; both apply, from different cards.
export function detectT6(ctx: DetectCtx, seats: SeatResolution[], scopes: string[]): Flag {
  if (!seats.some((s) => s.seat.topic === "price")) return { pattern: "T6", fired: false, evidence: [], details: {} };
  const labor = scopes.map((scope) => ctx.graph.resolve({ topic: "price", facet: "price.labor", scope }, ctx.asOf)).find((r) => r.in_effect_card);
  if (!labor?.current_card) return { pattern: "T6", fired: false, evidence: [], details: {} };
  const head = ctx.graph.cards.get(labor.current_card)!;
  const keep = [...ctx.graph.cards.values()].find(
    (c) => c.record_id === head.record_id && c.topic === "price" && c.facets.includes("price.material") && !c.facets.includes("price.labor"),
  );
  const inEffect = labor.in_effect_card === head.card_id;
  return {
    pattern: "T6",
    fired: !!keep && inEffect,
    evidence: keep ? [head.card_id, keep.card_id] : [],
    details: { labor: head.card_id, material_kept: keep?.card_id ?? null, labor_in_effect: inEffect },
  };
}
