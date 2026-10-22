// P7: does the invoice match the version the client approved as of the invoice date?
import type { Flag } from "../types.ts";
import { categoryTotals, ms } from "../docs.ts";
import type { DetectCtx } from "./context.ts";
import { uniq } from "./context.ts";

export function detectP7(ctx: DetectCtx): Flag {
  if (!ctx.job || !ctx.invoiceQuestion) return { pattern: "P7", fired: false, evidence: [], details: {} };
  const inv = ctx.focusInvoice;
  const at = inv ? ms(inv.issued_at) : ctx.asOf;
  const approved = ctx.docs.approvedVersions(ctx.job, at);
  const basis = approved.at(-1);
  const approvalCards = approved.map((a) => a.approval.card.card_id);
  if (!inv) {
    // Nothing invoiced yet: billable only against an approved version.
    return {
      pattern: "P7",
      fired: !basis,
      evidence: uniq([...approvalCards, ...ctx.docs.rejections(ctx.job, at).map((r) => r.card.card_id)]),
      details: { approved_version: basis?.version.quote_id ?? null, reason: basis ? "an approved version exists" : "no approved version to bill against" },
    };
  }
  const invRec = ctx.docs.recordFor("invoice", inv.invoice_id).record_id;
  const lines = ctx.docs.lines(ctx.data.tables.invoiceLines, "invoice_id", inv.invoice_id);
  const problems: string[] = [];
  if (!basis) problems.push("no approved version as of the invoice date");
  else {
    if (inv.quote_id !== basis.version.quote_id) {
      const voided = ctx.docs.voidedBy(inv.quote_id, at);
      problems.push(`billed against ${inv.quote_id}${voided ? " (voided)" : ""}, approved version is ${basis.version.quote_id}`);
    }
    // The client portal totals lines per cost category: extra line detail is fine as long as every line
    // maps to a category of the approved version and each category total matches.
    const approvedTotals = categoryTotals(basis.version.lines);
    const invoiceTotals = categoryTotals(lines);
    for (const l of lines) {
      if (!(l.category in approvedTotals)) problems.push(`${l.category} line "${l.description}" (${l.amount}) is not in the approved version`);
    }
    for (const cat of new Set([...Object.keys(approvedTotals), ...Object.keys(invoiceTotals)])) {
      const want = approvedTotals[cat] ?? 0;
      const got = invoiceTotals[cat] ?? 0;
      if (want !== got) problems.push(`${cat} total ${got}, approved ${want}`);
    }
  }
  return {
    pattern: "P7",
    fired: problems.length > 0,
    evidence: uniq([...approvalCards, invRec, ...(basis ? [basis.version.record.record_id] : [])]),
    details: { invoice: inv.invoice_id, approved_version: basis?.version.quote_id ?? null, mismatches: problems },
  };
}
