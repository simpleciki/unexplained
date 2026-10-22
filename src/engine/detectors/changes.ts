// P2: line-level change between the focus version and the one before it.
import type { Flag } from "../types.ts";
import { diffLines, ms, round2 } from "../docs.ts";
import type { DetectCtx } from "./context.ts";
import { previousVersion } from "./context.ts";

export function detectP2(ctx: DetectCtx): Flag {
  const cur = ctx.focusQuote;
  const prev = cur ? previousVersion(ctx, cur) : null;
  if (!cur || !prev) return { pattern: "P2", fired: false, evidence: [], details: { reason: "no earlier version to compare" } };
  const changes = diffLines(prev.lines, cur.lines);
  // Where an explanation would come from: cards on this job about scope, price or an open item,
  // decided after the earlier version went out and by the time of this one.
  const between = ctx.cards.filter(
    (c) =>
      c.result === "PASS" &&
      c.scope === `job:${ctx.job}` &&
      ["scope", "price", "open_item"].includes(c.topic) &&
      ms(c.decided_at) > prev.at &&
      ms(c.decided_at) <= cur.at,
  );
  // Report the diff always; firing needs the judgment that the client-facing text does not explain it.
  return {
    pattern: "P2",
    fired: changes.length > 0 && ctx.clientExplanation === "absent",
    evidence: [prev.record.record_id, cur.record.record_id],
    support: changes.length ? between.map((c) => c.card_id) : [],
    details: {
      from: prev.quote_id,
      to: cur.quote_id,
      total_delta: round2(cur.total - prev.total),
      changes,
      records_between_versions: between.map((c) => ({ card: c.card_id, quote: c.quote })),
      client_explanation: ctx.clientExplanation ?? "not judged",
    },
  };
}
