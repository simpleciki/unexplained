// P6: is the document off the client's normal structure? Two parts.
// - Structure: per client, across all trades. Which cost categories the client portal accepts, which
//   categories the client's approved quotes use, how they are split, plus any later explicit structure
//   instruction from the client (the instruction wins).
// - Amount: per client AND trade, category totals of approved quotes only, once there are enough of them.
// Norms are built only from versions approved by the as-of date.
import type { Flag } from "../types.ts";
import type { Line } from "../docs.ts";
import { categoryTotals } from "../docs.ts";
import type { DetectCtx } from "./context.ts";
import { uniq } from "./context.ts";

// Approved quotes needed in a (client, trade) before an amount norm exists.
export const MIN_AMOUNT_NORM_VERSIONS = 2;
// A category total this far outside the approved range is off the amount norm.
export const AMOUNT_FACTOR = 2;

// Line shapes that a category alone does not show.
const SHAPES: Record<string, RegExp> = { lump_sum: /lump/i, allowance: /allowance/i };
const shapes = (lines: Line[]) => Object.keys(SHAPES).filter((k) => lines.some((l) => SHAPES[k].test(l.description)));

function approvedFor(ctx: DetectCtx, jobs: string[], excludeQuote?: string) {
  return jobs.flatMap((j) => ctx.docs.approvedVersions(j, ctx.asOf)).filter((a) => a.version.quote_id !== excludeQuote);
}

export function structureNorm(ctx: DetectCtx, excludeQuote?: string) {
  const jobs = ctx.data.tables.workOrders.filter((w) => w.client_id === ctx.client).map((w) => w.work_order_id);
  const approved = approvedFor(ctx, jobs, excludeQuote);
  const cats = (a: (typeof approved)[number]) => new Set(a.version.lines.map((l) => l.category));
  return {
    approved,
    portal: ctx.docs.portalCategories(ctx.client),
    categories: new Set(approved.flatMap((a) => [...cats(a)])),
    split: approved.length > 0 && approved.every((a) => cats(a).has("labor") && cats(a).has("material")),
    minLines: approved.length ? Math.min(...approved.map((a) => a.version.lines.length)) : 0,
    shapes: new Set(approved.flatMap((a) => shapes(a.version.lines))),
  };
}

export function amountNorm(ctx: DetectCtx, excludeQuote?: string) {
  const trade = ctx.data.tables.workOrders.find((w) => w.work_order_id === ctx.job)?.trade ?? null;
  const jobs = ctx.data.tables.workOrders.filter((w) => w.client_id === ctx.client && w.trade === trade).map((w) => w.work_order_id);
  const approved = approvedFor(ctx, jobs, excludeQuote);
  if (approved.length < MIN_AMOUNT_NORM_VERSIONS) return { trade, approved, ranges: null };
  const ranges: Record<string, [number, number]> = {};
  for (const a of approved) {
    for (const [cat, total] of Object.entries(categoryTotals(a.version.lines))) {
      const r = ranges[cat];
      ranges[cat] = r ? [Math.min(r[0], total), Math.max(r[1], total)] : [total, total];
    }
  }
  return { trade, approved, ranges };
}

// A later explicit instruction from the client overrides history (e.g. lump sums allowed from a date).
function lumpSumAllowed(ctx: DetectCtx): string | null {
  if (!ctx.client) return null;
  const r = ctx.graph.resolve({ topic: "scope", facet: "scope.structure", scope: `client:${ctx.client}` }, ctx.asOf);
  const card = r.in_effect_card ? ctx.graph.cards.get(r.in_effect_card) : undefined;
  return card && /lump/i.test(card.quote) && /\b(may|can|allowed)\b/i.test(card.quote) ? card.card_id : null;
}

export function detectP6(ctx: DetectCtx): Flag {
  const lines = ctx.focusInvoice
    ? ctx.docs.lines(ctx.data.tables.invoiceLines, "invoice_id", ctx.focusInvoice.invoice_id)
    : ctx.focusQuote?.lines;
  if (!lines || !ctx.client) return { pattern: "P6", fired: false, evidence: [], details: {} };
  const docRecord = ctx.focusInvoice ? ctx.docs.recordFor("invoice", ctx.focusInvoice.invoice_id).record_id : ctx.focusQuote!.record.record_id;
  const exclude = ctx.focusQuote?.quote_id;
  const s = structureNorm(ctx, exclude);
  const allowLump = lumpSumAllowed(ctx);

  const structureOff: string[] = [];
  const docCats = [...new Set(lines.map((l) => l.category))];
  for (const cat of docCats) {
    if (s.portal && !s.portal.has(cat)) structureOff.push(`${cat}: the client portal does not accept this category`);
    else if (s.approved.length && !s.categories.has(cat)) structureOff.push(`${cat}: never in an approved quote of this client`);
  }
  const hasLabor = docCats.includes("labor");
  const hasMaterial = docCats.includes("material");
  if (s.split && (!hasLabor || !hasMaterial) && !allowLump) structureOff.push("labor and material not shown apart");
  if (s.approved.length && lines.length < s.minLines && !allowLump) structureOff.push(`${lines.length} line(s); approved quotes have at least ${s.minLines}`);
  for (const sh of shapes(lines)) {
    if (!s.shapes.has(sh) && !(sh === "lump_sum" && allowLump)) structureOff.push(`${sh} line never seen in an approved quote`);
  }

  const a = amountNorm(ctx, exclude);
  const amountOff: string[] = [];
  const totals = categoryTotals(lines);
  if (a.ranges) {
    for (const [cat, total] of Object.entries(totals)) {
      const r = a.ranges[cat];
      if (r && (total > r[1] * AMOUNT_FACTOR || total < r[0] / AMOUNT_FACTOR)) {
        amountOff.push(`${cat} total ${total} outside the approved ${a.trade} range ${r[0]}-${r[1]}`);
      }
    }
  }

  const off = [...structureOff, ...amountOff];
  return {
    pattern: "P6",
    fired: off.length > 0,
    evidence: uniq([docRecord, ...s.approved.flatMap((x) => [x.approval.card.card_id, x.version.record.record_id])]),
    details: {
      off_norm: off,
      structure: {
        portal_categories: s.portal ? [...s.portal] : null,
        approved_categories: [...s.categories],
        norm_from: s.approved.map((x) => x.version.quote_id),
        structure_instruction: allowLump,
        off: structureOff,
      },
      amount: a.ranges
        ? { trade: a.trade, norm_from: a.approved.map((x) => x.version.quote_id), ranges: a.ranges, document_totals: totals, off: amountOff }
        : { trade: a.trade, status: "no amount norm yet", approved_in_trade: a.approved.map((x) => x.version.quote_id) },
    },
  };
}
