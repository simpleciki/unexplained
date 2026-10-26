// One step to fix each warning that fired (task 027), written by code from the same flag details and evidence the
// findings use (src/ui/findings.ts). No model. The wording per pattern is the one Ciki approved on 2026-10-26
// (docs/cursor-tasks/027-one-step-fix.md); brackets are filled from the flag, a name, date, amount or quote always
// comes from the records. When a fix needs a detail the flag does not carry, there is no fix line (the warning
// and its evidence still show): never generic advice that looks specific.
import type { FindingContext, FindingInput, Seg } from "./findings.ts";
import { D, Doc, M, P, Q, arr, cardOf, causeText, list, money, plainText, s, shortDate, stillOpenPhrase } from "./findings.ts";

export type FixContext = FindingContext & {
  clientPerson?: string | null; // the client's signer (data/README.md client table), for P1 and P7
  invoiceTotal?: number | null; // P7: this invoice's total
  approvedTotal?: number | null; // P7: the approved version's total
};

// The client's signer from the client table in data/README.md ("| cl.x | Name | ... | p.a Name (signer), p.b ... |"):
// the person marked "(signer)", else the only person listed; null when it is not one person.
export function clientSigner(readme: string, clientId: string | null): string | null {
  const row = readme.split("\n").find((l) => clientId && l.startsWith(`| ${clientId} |`));
  if (!row) return null;
  const people = [...row.matchAll(/(p\.[a-z]{2}\.[a-z_]+)\s+[A-Z][a-z]+ [A-Z][a-z]+(?:\s*\(([^)]*)\))?/g)];
  const signer = people.find((m) => /^signer$/i.test((m[2] ?? "").trim()));
  return signer ? signer[1] : people.length === 1 ? people[0][1] : null;
}

const signedMoney = (n: number) => (n < 0 ? `−${money(n)}` : money(n));

// P1: per open item. A promise: send the client's signer its result. A request the client made: answer it.
function p1(input: FindingInput, c: FixContext): Seg[][] {
  const items = arr<{ card: string; kind: string; quote: string; decided_at: string }>(input.details.open_items);
  return items.flatMap((o) => {
    const card = cardOf(input, o.card);
    if (!card?.decided_by || !o.quote || !o.decided_at) return [];
    const when = D(shortDate(o.decided_at));
    if (o.kind === "client_request") return [s`Before sending: answer what ${P(c.nameOf(card.decided_by))} asked for on ${when} (${Q(o.quote)}), or say in the cover note when the answer will come.`];
    if (!c.clientPerson) return [];
    return [s`Before sending: send ${P(c.nameOf(c.clientPerson))} the result of ${Q(o.quote)} that ${P(c.nameOf(card.decided_by))} promised on ${when}, or add one line to the cover note saying it is still pending and when it will be done.`];
  });
}

// P2: only once the Judge step has run and P2 fired (the caller passes fired flags only).
function p2(input: FindingInput): Seg[][] {
  const d = input.details as { from?: string; total_delta?: number; changes?: { change: string }[] };
  if (!d.from || typeof d.total_delta !== "number" || !d.changes?.length) return [];
  const n = (k: string) => d.changes!.filter((x) => x.change === k).length;
  const counts = [n("added") ? `${n("added")} line${n("added") > 1 ? "s" : ""} added` : "", n("removed") ? `${n("removed")} removed` : ""].filter(Boolean).join(", ");
  return [s`Add a change note: what changed since ${Doc(d.from)} and why (${M(`${d.total_delta < 0 ? "−" : "+"}${money(d.total_delta)}`)}${counts ? `, ${counts}` : ""}).`];
}

// P3: the open item is the version's own words that keep the question open, cut before the first "quantity x
// price" fragment the line carries ("…of the odor, 2 x 86" -> "…of the odor"). The finding keeps its own quote.
export const openItemOnly = (phrase: string) => phrase.replace(/[\s,;:–-]*\d+(?:\.\d+)?\s*x\s*\$?\d[\s\S]*$/i, "").trim();

function p3(input: FindingInput): Seg[][] {
  const found = stillOpenPhrase(input);
  const phrase = found ? openItemOnly(found) : "";
  return phrase ? [s`Don't send another version yet. Close the open item first: ${Q(phrase)}.`] : [];
}

// P4: what the rule requires, from the rule's own words. The cap rule has Ciki's approved example sentence.
function p4(input: FindingInput, c: FixContext): Seg[][] {
  const broken = arr<{ card: string; rule: { kind: string } & Record<string, number> }>(input.details.broken);
  return broken.flatMap((b) => {
    const card = cardOf(input, b.card);
    if (!card?.decided_by || !card.decided_at) return [];
    const who = P(c.nameOf(card.decided_by));
    const when = D(shortDate(card.decided_at));
    if (b.rule.kind === "cap" && typeof b.rule.amount === "number") return [s`This ${c.docKind} is over ${M(money(b.rule.amount))}: attach the one-line note ${who} asked for on ${when} before you submit.`];
    return card.quote ? [s`Follow the rule ${who} set on ${when} before you submit: ${Q(card.quote)}`] : [];
  });
}

// P5: ask the one client who rejected without a reason which of the inferred causes it was ("A, B, C or D").
function p5(input: FindingInput, c: FixContext): Seg[][] {
  const silent = arr<{ card: string; reason_stated: boolean }>(input.details.rejections).filter((r) => !r.reason_stated);
  const people = [...new Set(silent.map((r) => cardOf(input, r.card)?.decided_by).filter((x): x is string => !!x))];
  const causes = arr<{ cause: string; evidence: string[] }>(input.details.candidate_causes);
  if (people.length !== 1 || !causes.length) return [];
  return [s`Don't cut the price yet. Ask ${P(c.nameOf(people[0]))} which it was: ${list(causes.map((x) => causeText(x.cause, x.evidence.length)), "or")}.`];
}

// P6: the usual shape the detector found (approved line categories, the minimum line count when that is what is
// off, and the approved quotes it comes from). The price-list sentence is a reminder with no citation: there is no
// price list in data/.
function p6(input: FindingInput): Seg[][] {
  const st = (input.details.structure ?? {}) as { approved_categories?: string[]; norm_from?: string[] };
  const cats = (st.approved_categories ?? []).map((x) => x.replace(/_/g, " "));
  const from = st.norm_from ?? [];
  if (!cats.length || !from.length) return [];
  const min = arr<string>(input.details.off_norm).map((o) => o.match(/approved quotes have at least (\d+)$/)?.[1]).find(Boolean);
  return [s`Restructure to this client's usual shape: ${list(cats.map((x) => s`${x}`))} lines${min ? `, at least ${min} of them` : ""}, as in ${list(from.map((id) => [Doc(id)]))}. Check unit prices against the company's standard price list.`];
}

// P7: written approval from the client first (Ciki: never suggest invoicing the approved version instead). With an
// approved version, for the difference; with none approved before the invoice, for the whole invoice total, from the
// client's signer (hub, 2026-10-26).
function p7(input: FindingInput, c: FixContext): Seg[][] {
  const d = input.details as { approved_version?: string | null; mismatches?: string[]; reason?: string };
  if (!d.approved_version) {
    const none = (d.mismatches ?? []).includes("no approved version as of the invoice date") || d.reason === "no approved version to bill against";
    if (!none || !c.clientPerson || typeof c.invoiceTotal !== "number") return [];
    return [s`No version was approved before this invoice. Get written approval from ${P(c.nameOf(c.clientPerson))} for ${M(money(c.invoiceTotal))} before invoicing.`];
  }
  if (typeof c.invoiceTotal !== "number" || typeof c.approvedTotal !== "number") return [];
  const diff = Math.round((c.invoiceTotal - c.approvedTotal) * 100) / 100;
  const approvers = [...new Set(input.evidence.filter((e) => e.kind === "card" && e.decided_by).map((e) => e.decided_by!))];
  if (!diff || approvers.length !== 1) return [];
  return [s`Get written approval from ${P(c.nameOf(approvers[0]))} for the difference (${M(signedMoney(diff))}) before invoicing.`];
}

const FIXES: Record<string, (input: FindingInput, c: FixContext) => Seg[][]> = { P1: p1, P2: p2, P3: p3, P4: p4, P5: p5, P6: p6, P7: p7 };

export function fixSegments(input: FindingInput, c: FixContext): Seg[][] {
  return (FIXES[input.pattern]?.(input, c) ?? []).filter((x) => plainText(x).trim().length > 0);
}

export function fixSentences(input: FindingInput, c: FixContext): string[] {
  return fixSegments(input, c).map(plainText);
}
