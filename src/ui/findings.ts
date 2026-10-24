// Plain-English findings for the check page, written by code from each pattern's details (no model).
// Names come from the people list, dates read like "30 Apr" (the record's own clock), money like "$982",
// and any quote is the exact words of a record that is part of the warning's evidence. Inferences say so in
// words. Card ids, booleans and timestamps never appear; the raw details stay behind "Engine details".
// Each sentence is a list of segments (person, date, money, quote, doc, text) so the page can set names, dates
// and money in bold and put what a person said on its own line; plainText() gives the sentence as text.

export type EvidenceItem = {
  id: string;
  kind: "card" | "record";
  quote?: string;
  decided_by?: string;
  decided_at?: string;
  source: { record_id: string; type: string; author: string; at: string; text: string } | null;
};
export type FindingInput = { pattern: string; details: Record<string, unknown>; evidence: EvidenceItem[] };
export type FindingContext = {
  nameOf: (personId: string) => string;
  docKind: "quote" | "invoice";
  invoiceBilledQuote?: string | null; // the quote version an invoice names
  lines?: { description: string }[]; // the document's lines, to name the one a promise is priced in
};

// said: the quote is what the person named just before it said (the page puts it on its own line).
export type Seg = { k: "person" | "date" | "money" | "doc" | "text"; v: string } | { k: "quote"; v: string; said?: boolean };
type Part = Seg | Seg[] | string;

const P = (v: string): Seg => ({ k: "person", v });
const D = (v: string): Seg => ({ k: "date", v });
const M = (v: string): Seg => ({ k: "money", v });
const Doc = (v: string): Seg => ({ k: "doc", v });
const Q = (v: string, said = false): Seg => (said ? { k: "quote", v, said } : { k: "quote", v });

// s`...${P(name)}...` -> segments; plain interpolated strings are text.
function s(strings: TemplateStringsArray, ...parts: Part[]): Seg[] {
  const out: Seg[] = [];
  const text = (v: string) => { if (v) out.push({ k: "text", v }); };
  strings.forEach((str, i) => {
    text(str);
    if (i < parts.length) {
      const p = parts[i];
      if (typeof p === "string") text(p);
      else if (Array.isArray(p)) out.push(...p);
      else out.push(p);
    }
  });
  // merge neighbouring text
  return out.reduce<Seg[]>((acc, x) => {
    const last = acc.at(-1);
    if (last && last.k === "text" && x.k === "text") last.v += x.v;
    else acc.push({ ...x });
    return acc;
  }, []);
}

export const plainText = (segs: Seg[]) => segs.map((x) => (x.k === "quote" ? `“${x.v}”` : x.v)).join("");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const shortDate = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
export const money = (n: number) => `$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
const signed = (n: number) => `${n < 0 ? "−" : "+"}${money(n)}`;
const words = (x: string) => x.replace(/_/g, " ");
const joinSegs = (items: Seg[][], sep: string): Seg[] => items.flatMap((x, i) => (i ? [{ k: "text" as const, v: sep }, ...x] : x));
const list = (items: Seg[][]): Seg[] =>
  items.length <= 1 ? items.flat() : [...joinSegs(items.slice(0, -1), ", "), { k: "text", v: " and " }, ...items.at(-1)!];
const docs = (ids: string[]) => list(ids.map((id) => [Doc(id)]));
const times = (n: number) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const capital = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
// A quote that ends a sentence gets a full stop after the closing mark unless its own words end one.
const stop = (q: string) => (/[.!?]$/.test(q.trim()) ? "" : ".");
const an = (w: string) => `${/^[aeiou]/i.test(w) ? "an" : "a"} ${w}`;

function cardOf(input: FindingInput, id: string) {
  return input.evidence.find((e) => e.kind === "card" && e.id === id);
}

// Words too generic to link a promise to a priced line ("first cleanout" says nothing about the promise).
const GENERIC = new Set(["first", "last", "new", "old", "work", "line", "lines", "quote", "item", "items", "rest", "part", "parts", "next", "same", "also", "labor", "material", "hour", "hours", "job", "check", "need", "needs", "later", "soon", "know", "before", "after"]);
const wordsOf = (x: string) => new Set(x.toLowerCase().replace(/[^a-z0-9' -]/g, " ").split(/[\s-]+/).filter(Boolean));

// The document line a promise is priced in, by a word they share that is not generic; null when there is none.
function pricedLine(o: { quote: string; priced_item_words?: string[] }, c: FindingContext): { line: string; word: string } | null {
  // The longest shared word is the most specific ("refinish" says more than "north").
  for (const w of (o.priced_item_words ?? []).filter((x) => !GENERIC.has(x.toLowerCase())).sort((a, b) => b.length - a.length)) {
    const line = (c.lines ?? []).find((l) => wordsOf(l.description).has(w.toLowerCase()));
    // Quote the word exactly as the promise wrote it ("Snake", not "snake").
    const asWritten = o.quote.match(new RegExp(`\\b${w.replace(/[^a-z0-9']/gi, "")}\\b`, "i"))?.[0];
    if (line && asWritten) return { line: line.description, word: asWritten };
  }
  return null;
}

// P1: a promise or a requested finding with no result on record, priced by the document.
function p1(input: FindingInput, c: FindingContext): Seg[][] {
  const items = arr<{ card: string; kind: string; quote: string; decided_at: string; unconfirmed_follow_ups: string[]; priced_item_words: string[] }>(input.details.open_items);
  return items.map((o) => {
    const card = cardOf(input, o.card);
    const who = card?.decided_by ? P(c.nameOf(card.decided_by)) : "Someone";
    const verb = o.kind === "client_request" ? "asked" : "promised";
    const follow = o.unconfirmed_follow_ups?.length ? ` ${capital(times(o.unconfirmed_follow_ups.length))} it was mentioned later without a result.` : "";
    // Only a meaningful shared word links the promise to a line; otherwise say what to check, not a claim.
    const link = pricedLine(o, c);
    const priced = link ? s` The line ${Q(link.line)} uses ${Q(link.word)} from the promise.` : s` Check whether any line in this ${c.docKind} depends on it.`;
    return s`${who} ${verb} on ${D(shortDate(o.decided_at))}: ${Q(o.quote, true)}${stop(o.quote)} No result is on record before this ${c.docKind}.${follow}${priced}`;
  });
}

// P2: line changes between versions that the client-facing text may not explain.
function p2(input: FindingInput): Seg[][] {
  const d = input.details as { from?: string; to?: string; total_delta?: number; changes?: { change: string; description: string; delta: number }[]; client_explanation?: string };
  if (!d.from || !d.to) return [];
  const changes = d.changes ?? [];
  const shown = changes.slice(0, 4).map((x) => s`${x.change} ${x.description} (${M(signed(x.delta))})`);
  const more = changes.length > 4 ? ` and ${changes.length - 4} more` : "";
  const explained = d.client_explanation === "absent" ? " The text the client sees does not explain the change." : "";
  return [s`Between ${Doc(d.from)} and ${Doc(d.to)} the total moved ${M(signed(d.total_delta ?? 0))}: ${list(shown)}${more}.${explained}`];
}

// P3: versions that keep saying the cause is being looked for, with no finding.
function p3(input: FindingInput, c: FindingContext): Seg[][] {
  const versions = arr<string>(input.details.versions_without_finding);
  const STILL_OPEN = /\b(need(s)? to determine|working to determine|determine the cause|not yet named|still tracing)\b[^.;]*/i;
  const phrase = input.evidence.map((e) => e.source?.text.match(STILL_OPEN)?.[0]).find(Boolean);
  const said = phrase ? s` still say ${Q(phrase)}` : " still say the cause is being looked for";
  return [s`${docs(versions)}${said}, and no finding is on record before this ${c.docKind}. The question has not moved across ${String(versions.length)} versions.`];
}

const RULE_TEXT: Record<string, (r: Record<string, number>) => Seg[]> = {
  cap: (r) => s`its total is above the ${M(money(r.amount))} limit that needs a note first`,
  recipients: (r) => s`a notice went to more than ${String(r.max)} ${r.max === 1 ? "person" : "people"}`,
  portal: () => s`it was sent by email, not through the portal`,
  quiet: (r) => s`it was re-sent within ${String(r.businessDays)} business days`,
  no_trip: () => s`it carries a trip or travel charge`,
};

// P4: a client rule still in force that this document breaks.
function p4(input: FindingInput, c: FindingContext): Seg[][] {
  const broken = arr<{ card: string; rule: { kind: string } & Record<string, number> }>(input.details.broken);
  return broken.map((b) => {
    const card = cardOf(input, b.card);
    const who = card?.decided_by ? P(c.nameOf(card.decided_by)) : "The client";
    const when = card?.decided_at ? s` on ${D(shortDate(card.decided_at))}` : "";
    const rule = card?.quote ? s`: ${Q(card.quote, true)}${stop(card.quote)}` : ".";
    return s`${who} set a rule${when}${rule} It is still in force, and this ${c.docKind} breaks it: ${(RULE_TEXT[b.rule.kind] ?? (() => s`it does not follow the rule`))(b.rule)}.`;
  });
}

// P5: an outstanding rejection; the client's own reason if given, otherwise what the records show, as inference.
function causeText(cause: string, evidenceCount: number): Seg[] {
  let m = cause.match(/^(\d+) voided submission\(s\), (\d+) recreated within (\d+) minutes$/);
  if (m) return s`${m[1] === "1" ? "a version was" : `${m[1]} versions were`} voided${Number(m[2]) ? ` and ${m[2] === "1" ? "resent" : `${m[2]} resent`} within ${m[3]} minutes` : ""}`;
  if (cause === "cover note names a different quote id") return s`the cover note names a different quote id`;
  if (cause === "repeated notices for the same quote") return s`the same quote was announced ${String(evidenceCount)} times`;
  m = cause.match(/^(Q-[A-Z]{2}-\d{2}-v\d+) total changed by (-?[\d.]+) from (Q-[A-Z]{2}-\d{2}-v\d+)$/);
  if (m) return s`${Doc(m[1])}'s total moved ${M(signed(Number(m[2])))} from ${Doc(m[3])}`;
  m = cause.match(/^(Q-[A-Z]{2}-\d{2}-v\d+) added (.+)$/);
  if (m) {
    const added = m[2].split("; ");
    return s`${Doc(m[1])} added ${added.length === 1 ? "a line" : `${added.length} lines`}: ${list(added.map((a) => s`${a}`))}`;
  }
  if (cause.startsWith("an open item")) return s`a promised check or requested finding had no recorded result`;
  return s`${words(cause)}`;
}

function p5(input: FindingInput, c: FindingContext): Seg[][] {
  const rejections = arr<{ card: string; quote_id: string; reason_stated: boolean }>(input.details.rejections);
  const stated = rejections.filter((r) => r.reason_stated);
  const silent = rejections.filter((r) => !r.reason_stated);
  const out: Seg[][] = [];
  const byPerson = new Map<string, string[]>();
  for (const r of silent) {
    const card = cardOf(input, r.card);
    const who = card?.decided_by ?? "the client";
    byPerson.set(who, [...(byPerson.get(who) ?? []), card?.decided_at ? shortDate(card.decided_at) : ""]);
  }
  for (const [who, dates] of byPerson) {
    const name = who === "the client" ? "The client" : P(c.nameOf(who));
    out.push(s`${name} rejected ${times(dates.length)} without giving a reason (${joinSegs(dates.filter(Boolean).map((d) => [D(d)]), ", ")}).`);
  }
  for (const r of stated) {
    const card = cardOf(input, r.card);
    if (card?.quote) out.push(s`${card.decided_by ? P(c.nameOf(card.decided_by)) : "The client"} gave a reason on ${card.decided_at ? D(shortDate(card.decided_at)) : "record"}: ${Q(card.quote, true)}${stop(card.quote)}`);
  }
  const causes = arr<{ cause: string; evidence: string[]; inference: boolean }>(input.details.candidate_causes);
  if (causes.length) {
    const inferred = causes.every((x) => x.inference);
    out.push(s`What the records show instead: ${joinSegs(causes.map((x) => causeText(x.cause, x.evidence.length)), "; ")}. ${inferred ? "These are inferred from the records, not stated reasons." : "Some of these are inferred from the records, not stated reasons."}`);
  }
  return out;
}

// P6: off the client's normal structure or amount range.
function offText(off: string): Seg[] {
  let m = off.match(/^(\w+): the client portal does not accept this category$/);
  if (m) return s`${an(words(m[1]))} line, which the client portal does not accept`;
  m = off.match(/^(\w+): never in an approved quote of this client$/);
  if (m) return s`${an(words(m[1]))} line, which no quote this client approved has had`;
  if (off === "labor and material not shown apart") return s`labor and material are not shown apart`;
  m = off.match(/^(\d+) line\(s\); approved quotes have at least (\d+)$/);
  if (m) return s`only ${m[1]} line${m[1] === "1" ? "" : "s"}, where approved quotes have at least ${m[2]}`;
  m = off.match(/^(\w+) line never seen in an approved quote$/);
  if (m) return s`${an(words(m[1]))} line, never seen in an approved quote`;
  m = off.match(/^(\w+) total (-?[\d.]+) outside the approved (\w+) range (-?[\d.]+)-(-?[\d.]+)$/);
  if (m) return s`${words(m[1])} totals ${M(money(Number(m[2])))}, outside the ${M(money(Number(m[4])))}–${M(money(Number(m[5])))} range of approved ${words(m[3])} quotes`;
  return s`${words(off)}`;
}

function p6(input: FindingInput, c: FindingContext): Seg[][] {
  const st = (input.details.structure ?? {}) as { approved_categories?: string[]; norm_from?: string[] };
  const off = arr<string>(input.details.off_norm);
  const approvers = [...new Set(input.evidence.filter((e) => e.kind === "card" && e.decided_by).map((e) => c.nameOf(e.decided_by!)))];
  const cats = (st.approved_categories ?? []).map(words);
  const from = st.norm_from ?? [];
  const norm = from.length
    ? s`${approvers.length ? list(approvers.map((a) => [P(a)])) : "The client"} approved quotes with ${cats.length ? s`${list(cats.map((x) => s`${x}`))} lines` : "a fixed set of lines"} (${docs(from)}).`
    : s`There is no approved quote for this client yet to compare against.`;
  return [s`${norm} This ${c.docKind} has ${joinSegs(off.map(offText), "; ")}.`];
}

// P7: an invoice that does not match the version the client approved.
function mismatchText(m: string): Seg[] {
  let x = m.match(/^billed against (\S+)( \(voided\))?, approved version is (\S+)$/);
  if (x) return s`it bills ${Doc(x[1])}${x[2] ? " (a voided version)" : ""}, but the approved version is ${Doc(x[3])}`;
  x = m.match(/^(\w+) line "(.+)" \((-?[\d.]+)\) is not in the approved version$/);
  if (x) return s`the ${words(x[1])} line ${x[2]} (${M(money(Number(x[3])))}) is not in the approved version`;
  x = m.match(/^(\w+) total (-?[\d.]+), approved (-?[\d.]+)$/);
  if (x) return s`${words(x[1])} totals ${M(money(Number(x[2])))} where the approved version has ${M(money(Number(x[3])))}`;
  if (m === "no approved version as of the invoice date") return [];
  return s`${words(m)}`;
}

function p7(input: FindingInput, c: FindingContext): Seg[][] {
  const d = input.details as { approved_version?: string | null; mismatches?: string[]; reason?: string };
  const mismatches = d.mismatches ?? [];
  if (!d.approved_version && (mismatches.includes("no approved version as of the invoice date") || d.reason)) {
    return [s`No version of this job was approved by the invoice date${c.invoiceBilledQuote ? s`; the invoice bills ${Doc(c.invoiceBilledQuote)}` : ""}. The client is likely to dispute it.`];
  }
  const parts = mismatches.map(mismatchText).filter((p) => p.length);
  return [s`Measured against ${Doc(d.approved_version ?? "")}, the version the client approved: ${joinSegs(parts, "; ")}. The client is likely to dispute it.`];
}

const TEMPLATES: Record<string, (input: FindingInput, c: FindingContext) => Seg[][]> = { P1: p1, P2: p2, P3: p3, P4: p4, P5: p5, P6: p6, P7: p7 };

export function findingSegments(input: FindingInput, c: FindingContext): Seg[][] {
  return (TEMPLATES[input.pattern]?.(input, c) ?? []).filter((x) => plainText(x).trim().length > 0);
}

export function findingSentences(input: FindingInput, c: FindingContext): string[] {
  return findingSegments(input, c).map(plainText);
}
