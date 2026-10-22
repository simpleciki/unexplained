// P5: an outstanding rejection. If the client gave no reason, list every candidate cause with
// its evidence and never pick one.
import type { Flag, Row } from "../types.ts";
import { diffLines, ms, round2 } from "../docs.ts";
import type { DetectCtx } from "./context.ts";
import { uniq } from "./context.ts";
import { openItems } from "./promises.ts";

type Candidate = { cause: string; evidence: string[]; inference: true };

export function detectP5(ctx: DetectCtx): Flag {
  if (!ctx.job || ctx.invoiceQuestion) return { pattern: "P5", fired: false, evidence: [], details: {} };
  const decisions = ctx.docs.approvals(ctx.job, ctx.asOf);
  const last = decisions.at(-1);
  const resentAfter = last && ctx.docs.versionsOf(ctx.job, ctx.asOf).some((v) => v.at > ms(last.card.decided_at));
  if (!last || last.positive || resentAfter) return { pattern: "P5", fired: false, evidence: [], details: {} };

  const rejections = decisions.filter((d) => !d.positive);
  const stated = rejections.filter((r) => r.card.mode === "gives_reason");
  const cutoff = ms(last.card.decided_at);
  const sent = ctx.docs.versionsOf(ctx.job, cutoff);
  const events = ctx.docs.events(ctx.job, cutoff);
  const rec = (e: Row) => ctx.docs.recordFor("submission_event", e.event_id).record_id;
  const candidates: Candidate[] = [];

  const voids = events.filter((e) => e.event === "voided");
  if (voids.length) {
    const remade = events.filter((e) => (e.event === "created" || e.event === "resubmitted") && voids.some((v) => ms(e.at) > ms(v.at) && ms(e.at) - ms(v.at) <= 30 * 60_000));
    candidates.push({ cause: `${voids.length} voided submission(s), ${remade.length} recreated within 30 minutes`, evidence: [...voids, ...remade].map(rec), inference: true });
  }
  const mismatched = sent.filter((v) => [...v.record.text.matchAll(/\bQ-[A-Z]{2}-\d{2}-v\d+\b/g)].some((m) => m[0] !== v.quote_id));
  if (mismatched.length) candidates.push({ cause: "cover note names a different quote id", evidence: mismatched.map((v) => v.record.record_id), inference: true });
  const byQuote = new Map<string, typeof events>();
  for (const e of events.filter((x) => x.event === "notified")) byQuote.set(e.quote_id, [...(byQuote.get(e.quote_id) ?? []), e]);
  const repeated = [...byQuote.values()].filter((list) => list.length >= 2);
  if (repeated.length) candidates.push({ cause: "repeated notices for the same quote", evidence: repeated.flat().map(rec), inference: true });
  for (let i = 1; i < sent.length; i++) {
    const delta = round2(sent[i].total - sent[i - 1].total);
    const added = diffLines(sent[i - 1].lines, sent[i].lines).filter((c) => c.change === "added");
    if (delta !== 0) candidates.push({ cause: `${sent[i].quote_id} total changed by ${delta} from ${sent[i - 1].quote_id}`, evidence: [sent[i - 1].record.record_id, sent[i].record.record_id], inference: true });
    if (added.length) candidates.push({ cause: `${sent[i].quote_id} added ${added.map((a) => a.description).join("; ")}`, evidence: [sent[i].record.record_id], inference: true });
  }
  const open = openItems(ctx, cutoff);
  if (open.length) candidates.push({ cause: "an open item (promised check or requested finding) had no recorded result", evidence: open.flatMap((o) => [o.card.card_id, o.card.record_id]), inference: true });

  return {
    pattern: "P5",
    fired: true,
    evidence: uniq([...rejections.map((r) => r.card.card_id), ...stated.map((r) => r.card.record_id)]),
    details: {
      rejections: rejections.map((r) => ({ card: r.card.card_id, quote_id: r.quote_id, reason_stated: r.card.mode === "gives_reason" })),
      stated_reasons: stated.map((r) => r.card.quote),
      candidate_causes: candidates,
    },
  };
}
