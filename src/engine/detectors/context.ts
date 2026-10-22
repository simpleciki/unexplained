// What a detector sees: the data, the seat graph, derived document state, and the question's focus.
import type { CheckedCard, Dataset, Row } from "../types.ts";
import type { Docs, Version } from "../docs.ts";
import { ms } from "../docs.ts";
import type { SeatGraph } from "../seats.ts";
import type { Vocab } from "../vocab.ts";

export type DetectCtx = {
  data: Dataset;
  docs: Docs;
  graph: SeatGraph;
  cards: CheckedCard[];
  vocab: Vocab;
  asOf: number;
  job: string | null;
  client: string | null;
  focusQuote: Version | null; // may be a draft in hand that is sent shortly after asOf
  focusInvoice: Row | null;
  invoiceQuestion: boolean;
  // Whether the client-facing text explains a price change is a model judgment; oracle mode passes it in.
  clientExplanation?: "present" | "absent";
};

export const visibleCards = (ctx: DetectCtx) =>
  ctx.cards.filter((c) => c.result === "PASS" && ms(c.decided_at) <= ctx.asOf);

// Versions the gatekeeper can see: everything sent by asOf, plus the draft in hand.
export function versionsInView(ctx: DetectCtx): Version[] {
  if (!ctx.job) return [];
  const sent = ctx.docs.versionsOf(ctx.job, ctx.asOf);
  if (ctx.focusQuote && !sent.includes(ctx.focusQuote)) sent.push(ctx.focusQuote);
  return sent.sort((a, b) => a.version - b.version || a.at - b.at);
}

export function previousVersion(ctx: DetectCtx, v: Version): Version | null {
  return versionsInView(ctx).filter((x) => x.version < v.version).at(-1) ?? null;
}

export const uniq = <T>(xs: T[]) => [...new Set(xs)];
