// P1 open promise and P3 no progress.
import type { CheckedCard, Flag } from "../types.ts";
import type { Version } from "../docs.ts";
import { ms } from "../docs.ts";
import type { DetectCtx } from "./context.ts";
import { uniq, versionsInView, visibleCards } from "./context.ts";

// A promise is open while no accepted REPLACES link from it reaches a card decided by asOf.
export function openPromises(ctx: DetectCtx, at = ctx.asOf) {
  if (!ctx.job) return [];
  const closedBy = new Map<string, string>();
  for (const l of ctx.graph.links) {
    const to = ctx.graph.cards.get(l.to);
    if (l.status === "ok" && l.relation === "REPLACES" && to && ms(to.decided_at) <= at) closedBy.set(l.from, l.to);
  }
  return ctx.cards.filter(
    (c) =>
      c.result === "PASS" &&
      c.mode === "proposes" &&
      c.topic === "open_item" &&
      c.scope === `job:${ctx.job}` &&
      ms(c.decided_at) <= at &&
      !closedBy.has(c.card_id),
  );
}

export type OpenItem = { card: CheckedCard; kind: "contractor_promise" | "client_request"; followUps: CheckedCard[] };

// Every unresolved open item on the job: a contractor promise to check something, or a finding the client
// asked for (a client decision on the open_item.inspection facet) that no result card has answered yet.
// Later "mentions" of the open item (an unconfirmed guess) do not close it, but they name the item.
export function openItems(ctx: DetectCtx, at = ctx.asOf): OpenItem[] {
  if (!ctx.job) return [];
  const onJob = ctx.cards.filter((c) => c.result === "PASS" && c.scope === `job:${ctx.job}` && ms(c.decided_at) <= at);
  const results = onJob.filter((c) => c.topic === "open_item" && c.mode === "gives_reason");
  const mentions = onJob.filter((c) => c.mode === "mentions" && (c.topic === "open_item" || c.facets.includes("open_item.inspection")));
  const followUps = (c: CheckedCard) => mentions.filter((m) => ms(m.decided_at) > ms(c.decided_at));
  const deciders = new Set(Object.values(ctx.vocab.deciders).flat());
  const requests = onJob.filter(
    (c) =>
      c.mode === "decides" &&
      deciders.has(c.decided_by) &&
      c.facets.includes("open_item.inspection") &&
      !results.some((r) => ms(r.decided_at) > ms(c.decided_at)),
  );
  return [
    ...openPromises(ctx, at).map((card) => ({ card, kind: "contractor_promise" as const, followUps: followUps(card) })),
    ...requests.map((card) => ({ card, kind: "client_request" as const, followUps: followUps(card) })),
  ];
}

const STOP = new Set("about after again also back before come could does each from have here into just know look more much need needs next once only other over same some than that then there they this those tell them until want were what when will with would your we'll we'd".split(" "));
const words = (t: string) => new Set(t.toLowerCase().replace(/[^a-z' ]/g, " ").split(/\s+/).filter((w) => w.length >= 4 && !STOP.has(w)));

// The item a promise is about: its distinctive words, minus words that only name the job itself.
function dependsOn(promise: string, jobTitle: string, lines: Version["lines"]): string[] {
  const title = words(jobTitle);
  const item = [...words(promise)].filter((w) => !title.has(w));
  const text = words(lines.map((l) => l.description).join(" "));
  return item.filter((w) => text.has(w));
}

// Closed promises: a REPLACES link to a result decided by the as-of date.
function closedPromises(ctx: DetectCtx) {
  return ctx.graph.links.filter((l) => {
    const from = ctx.graph.cards.get(l.from);
    const to = ctx.graph.cards.get(l.to);
    return l.status === "ok" && l.relation === "REPLACES" && from?.mode === "proposes" && from.scope === `job:${ctx.job}` && to && ms(to.decided_at) <= ctx.asOf;
  });
}

export function detectP1(ctx: DetectCtx): Flag {
  if (!ctx.job || ctx.invoiceQuestion) return { pattern: "P1", fired: false, evidence: [], details: {} };
  const title = ctx.data.tables.workOrders.find((w) => w.work_order_id === ctx.job)?.job_title ?? "";
  const target = ctx.focusQuote ?? ctx.docs.versionsOf(ctx.job, ctx.asOf).at(-1) ?? null;
  // An open item matters when the quote in view prices the item it is about.
  const dependent = openItems(ctx)
    .map((o) => ({
      o,
      shared: target && target.at >= ms(o.card.decided_at) ? dependsOn([o.card.quote, ...o.followUps.map((f) => f.quote)].join(" "), title, target.lines) : [],
    }))
    .filter((x) => x.shared.length > 0);
  const closed = closedPromises(ctx);
  return {
    pattern: "P1",
    fired: dependent.length > 0,
    evidence: uniq([
      ...dependent.flatMap(({ o }) => [o.card.card_id, o.card.record_id, ...o.followUps.map((f) => f.card_id)]),
      ...(dependent.length && target ? [target.record.record_id] : []),
    ]),
    support: uniq(closed.flatMap((l) => [l.from, l.to])),
    details: {
      quote_checked: target?.quote_id ?? null,
      open_items: dependent.map(({ o, shared }) => ({
        card: o.card.card_id,
        kind: o.kind,
        quote: o.card.quote,
        decided_at: o.card.decided_at,
        unconfirmed_follow_ups: o.followUps.map((f) => f.card_id),
        priced_item_words: shared,
      })),
      closed_promises: closed.map((l) => ({ promise: l.from, result: l.to })),
    },
  };
}

// Wording that says the question is still being worked on. Deciding this from free text is a
// judgment; this deterministic reading is kept narrow on purpose.
const STILL_OPEN = /\b(need(s)? to determine|working to determine|determine the cause|not yet named|still tracing)\b/i;

export function detectP3(ctx: DetectCtx): Flag {
  if (ctx.invoiceQuestion) return { pattern: "P3", fired: false, evidence: [], details: {} };
  // A voided version was never live, so it does not count as a round that went nowhere.
  const carrying = versionsInView(ctx).filter((v) => !ctx.docs.voidedBy(v.quote_id, ctx.asOf)).filter(
    (v) => STILL_OPEN.test(v.record.text) || v.lines.some((l) => STILL_OPEN.test(l.description)),
  );
  const results = visibleCards(ctx).filter(
    (c) => c.scope === `job:${ctx.job}` && c.topic === "open_item" && c.mode === "gives_reason",
  );
  return {
    pattern: "P3",
    fired: carrying.length >= 2 && results.length === 0,
    evidence: carrying.map((v) => v.record.record_id),
    details: { versions_without_finding: carrying.map((v) => v.quote_id), result_cards: results.map((c) => c.card_id) },
  };
}
