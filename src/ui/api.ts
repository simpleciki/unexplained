// The gatekeeper screen's API, as plain functions (server.ts only routes HTTP to them, so they are tested
// without a network). Nothing here calls a model: warnings come from the deterministic engine, built from
// the ingested model cards with human judgments applied.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildEngine } from "../engine/engine.ts";
import type { Engine } from "../engine/engine.ts";
import type { Dataset, Flag } from "../engine/types.ts";
import { ms } from "../engine/docs.ts";
import { runDetectors } from "../engine/detectors/index.ts";
import { agentContext } from "../agents/shared.ts";
import { loadIngested } from "../pipeline/ingest.ts";
import { appendDocJudgment, appendJudgment, confirmation, judgmentWarnings, openQuestions } from "../review/judgments.ts";
import { suggestEffective } from "../review/effective.ts";
import { findingSegments, plainText } from "./findings.ts";
import { clientSigner, fixSegments } from "./fixes.ts";
import { loadHeroCase, loadStoryFile, storyResponse, validateStory } from "./story.ts";
import type { EvidenceItem } from "./findings.ts";
import type { JudgmentInput } from "../review/judgments.ts";
import { jobQueue, loadReviewView } from "../review/queue.ts";
import { designedInvoice, designedQuote } from "../eval/value-metrics.ts";
import { sampleDay } from "./sample.ts";
import { recallClient } from "./client-memory.ts";
import type { ReviewView } from "../review/queue.ts";

export const WARNINGS: Record<string, string> = {
  P1: "A promise never closed",
  P2: "Unexplained change between versions",
  P3: "Going in circles",
  P4: "A client rule still in force is broken",
  P5: "Rejection blamed on price by default",
  P6: "Off the client's normal structure",
  P7: "Invoice does not match what was approved",
};

export type View = "all" | "curated" | "sample";
export const VIEWS: View[] = ["sample", "all", "curated"];
export type Ctx = { root: string; data: Dataset; view: ReviewView; engine: Engine; summaries?: Partial<Record<View, Summary>> };

// Rebuilt after every judgment, so the ledger and the engine always reflect review/judgments.jsonl.
export function loadCtx(root: string, data: Dataset): Ctx {
  const view = loadReviewView(root, data);
  const { cards, edges } = loadIngested(root, data);
  return { root, data, view, engine: buildEngine(root, cards, edges, undefined, data) };
}

export function ledger(ctx: Ctx) {
  const { line, counts, complete, unaccounted, total } = ctx.view.ledger;
  return { line, counts, complete, unaccounted, total };
}

export function meta(ctx: Ctx) {
  const people = agentContext(ctx.root, ctx.data, ctx.engine.vocab).people;
  // deciders: who may decide each topic; the form warns before a Decision by anyone else (it is used as Mentions).
  return { people, topics: [...ctx.engine.vocab.topics], modes: ["decides", "gives_reason", "proposes", "mentions"], deciders: ctx.engine.vocab.deciders };
}

// Jobs, each with its quote versions and invoices. Status columns are end-of-period state, so they are not
// shown as if they were true on the document's date.
export function jobs(ctx: Ctx) {
  const t = ctx.data.tables;
  const clients = new Map(t.clients.map((c) => [c.client_id, c.name]));
  const { states, to_confirm } = summary(ctx);
  const left = (id: string) => to_confirm.per_doc[id] ?? 0;
  return t.workOrders.map((w) => {
    const q = jobQueue(ctx.view, w.work_order_id);
    return {
      job: w.work_order_id,
      title: w.job_title,
      trade: w.trade,
      client: clients.get(w.client_id) ?? w.client_id,
      needs_human: q.needs_human.length,
      spot_check: q.spot_check.length,
      confirmed: q.confirmed.length,
      docs: [
        ...t.quotes.filter((x) => x.work_order_id === w.work_order_id).map((x) => ({ kind: "quote" as const, id: x.quote_id, label: `v${x.version}`, at: x.submitted_at, total: Number(x.total), state: states[x.quote_id], left: left(x.quote_id) })),
        ...t.invoices.filter((x) => x.work_order_id === w.work_order_id).map((x) => ({ kind: "invoice" as const, id: x.invoice_id, label: x.invoice_id, at: x.issued_at, total: Number(x.total), state: states[x.invoice_id], left: left(x.invoice_id) })),
      ].sort((a, b) => ms(a.at) - ms(b.at)),
    };
  });
}

// One piece of evidence with the record it comes from, so the gatekeeper always sees the source text.
function evidence(ctx: Ctx, id: string) {
  const recs = new Map(ctx.data.records.map((r) => [r.record_id, r]));
  const card = ctx.engine.cards.find((c) => c.card_id === id);
  const rec = recs.get(card ? card.record_id : id);
  const source = rec ? { record_id: rec.record_id, type: rec.source_type, author: rec.author, at: rec.source_recorded_at, text: rec.text } : null;
  if (card) {
    // A human card keeps the mode the person chose; the engine copy carries the mode it applies.
    const chosen = card.source === "human" ? ctx.view.judgments.find((j) => j.judgment_id === card.judgment_id)?.cards[Number(card.card_id.split(".").at(-1))]?.mode : undefined;
    const names = new Map(meta(ctx).people.map((p) => [p.id, p.name]));
    return {
      id,
      kind: "card" as const,
      quote: card.quote,
      mode: card.mode,
      mode_chosen: chosen ?? card.mode,
      mode_note: chosen && chosen !== card.mode ? `${names.get(card.decided_by) ?? card.decided_by} is not a client decider for ${card.topic}` : null,
      decided_by: card.decided_by,
      decided_at: card.decided_at,
      by: card.source === "human" ? "person" : "model",
      confirmed: confirmation(card, ctx.view.judgments) ?? null,
      source,
    };
  }
  return { id, kind: "record" as const, source };
}

// A time in the same wall clock and offset as `iso` (the document's own), e.g. "2026-03-16 16:29". The screen
// shows one clock only: the document's local time, never UTC.
export function inOffsetOf(iso: string, t: number): string {
  const m = iso.match(/([+-])(\d\d):(\d\d)$/);
  const off = m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
  return new Date(t + off * 60_000).toISOString().slice(0, 16).replace("T", " ");
}

// Check one document as it is about to go out: the engine sees the records up to just before it was
// submitted or issued, with the document itself as the one in hand.
// The verdict never says "clear" while anything the check depends on is open: a job record written before
// the document that no one has judged yet (needs_human), or a P2 change only the Judge model step could
// judge, or an open question a person left on a card they kept, or a record the model read as empty (the
// model's "nothing here" was wrong on 26 of 59 records we measured, so a person spot-checks it first). With no
// records at all before the cut-off there is nothing to check against, so that is not "clear" either; the one
// exception is a job's first quote, checked against the client's rules and usual quotes when the client has
// rules on file and enough approved quotes to judge its usual structure, and nothing fired.
// data/README.md holds the client table (who signs for each client); read once per root.
const readmes = new Map<string, string>();
const dataReadme = (root: string) => readmes.get(root) ?? readmes.set(root, readFileSync(join(root, "data/README.md"), "utf8")).get(root)!;

export function check(ctx: Ctx, docId: string) {
  const t = ctx.data.tables;
  const invoice = t.invoices.find((x) => x.invoice_id === docId) ?? null;
  const version = invoice ? null : ctx.engine.docs.versions.find((v) => v.quote_id === docId) ?? null;
  if (!invoice && !version) return null;
  const job = invoice ? invoice.work_order_id : version!.work_order_id;
  const client = ctx.engine.docs.clientOf.get(job) ?? null;
  const at = invoice ? invoice.issued_at : version!.record.source_recorded_at;
  const asOf = ms(at) - 1;
  const flags: Flag[] = runDetectors(
    { data: ctx.data, docs: ctx.engine.docs, graph: ctx.engine.graph, cards: ctx.engine.cards, vocab: ctx.engine.vocab, asOf, job, client, focusQuote: version, focusInvoice: invoice, invoiceQuestion: !!invoice },
    [],
    [`job:${job}`, ...(client ? [`client:${client}`] : []), "global"],
  );

  // The job's records the check can see (written by the cut-off), and which of them are still open.
  const q = jobQueue(ctx.view, job);
  const seen = ctx.view.items.filter((x) => x.job === job && ms(x.recorded_at) <= asOf);
  const unjudged = seen.filter((x) => x.bucket === "needs_human");
  const spot = seen.filter((x) => x.bucket === "auto_empty");
  const read = seen.length - unjudged.length;
  const seenIds = new Set(seen.map((x) => x.record_id));
  const questions = openQuestions(ctx.view.judgments).filter((q) => seenIds.has(q.record_id));
  // First quote on a job with no records yet: only client-level history can vouch for it.
  const p4 = flags.find((f) => f.pattern === "P4");
  const p6 = flags.find((f) => f.pattern === "P6");
  const clientRules = ((p4?.details as { rules_checked?: string[] } | undefined)?.rules_checked ?? []).length;
  const structureStatus = (p6?.details as { structure?: { status?: string } } | undefined)?.structure?.status ?? null;
  const firstQuote = !invoice && seen.length === 0 && clientRules > 0 && !!p6 && !structureStatus;

  const warnings = flags
    .filter((f) => f.pattern in WARNINGS)
    .map((f) => {
      // P2 needs a judgment on whether the client-facing text explains a change: a model step, not run here.
      const needsJudge = f.pattern === "P2" && !f.fired && Array.isArray((f.details as { changes?: unknown[] }).changes) && ((f.details as { changes: unknown[] }).changes.length > 0);
      const status = f.fired
        ? "warning"
        : needsJudge
          ? "not judged here (needs the Judge model step)"
          : f.pattern === "P6" && structureStatus
            ? structureStatus
            : seen.length === 0
            ? firstQuote && (f.pattern === "P4" || f.pattern === "P6") ? "clear" : "no records on file to check against"
            : unjudged.length || questions.length || spot.length
              ? `no evidence in the ${read} of ${seen.length} records read${questions.length ? `; ${questions.length} open question${questions.length > 1 ? "s" : ""}` : ""}${spot.length ? `; ${spot.length} read as empty, not spot-checked` : ""}`
              : "clear";
      return {
        pattern: f.pattern,
        title: WARNINGS[f.pattern],
        fired: f.fired,
        open: needsJudge,
        status,
        details: f.details,
        evidence: [...new Set([...f.evidence, ...(f.fired ? f.support ?? [] : [])])].map((id) => evidence(ctx, id)),
      };
    });

  // One or two plain sentences per fired warning (src/ui/findings.ts); the raw details stay alongside.
  const names = new Map(meta(ctx).people.map((p) => [p.id, p.name]));
  const docLines = invoice ? t.invoiceLines.filter((l) => l.invoice_id === docId).map((l) => ({ description: l.description })) : version!.lines;
  const fctx = { nameOf: (id: string) => names.get(id) ?? id, docKind: (invoice ? "invoice" : "quote") as "quote" | "invoice", invoiceBilledQuote: invoice?.quote_id ?? null, lines: docLines };
  // finding_segments: the same sentences as typed segments, so the page can set names, dates and money in bold.
  // fix_segments: the one step to fix each fired warning (src/ui/fixes.ts), from the same details and evidence.
  const approvedTotal = (id: unknown) => { const q = typeof id === "string" ? t.quotes.find((x) => x.quote_id === id) : undefined; return q ? Number(q.total) : null; };
  for (const w of warnings) {
    const input = { pattern: w.pattern, details: w.details as Record<string, unknown>, evidence: w.evidence as EvidenceItem[] };
    const segs = w.fired ? findingSegments(input, fctx) : [];
    const fix = w.fired
      ? fixSegments(input, { ...fctx, clientPerson: clientSigner(dataReadme(ctx.root), client), invoiceTotal: invoice ? Number(invoice.total) : null, approvedTotal: approvedTotal((w.details as { approved_version?: unknown }).approved_version) })
      : [];
    Object.assign(w, { finding: segs.map(plainText), finding_segments: segs, fix: fix.map(plainText), fix_segments: fix });
  }
  const fired = warnings.filter((w) => w.fired).length;
  const openPatterns = warnings.filter((w) => w.open).map((w) => w.pattern);
  const doc = invoice ? "invoice" : "quote";
  // Nothing on file to check a document against (no job records, not enough client history). For a first quote a
  // person can confirm it against what the client told us before (a document-level judgment); the latest wins.
  const unchecked = seen.length === 0 && !firstQuote;
  const personOk = unchecked && !invoice ? ctx.view.docJudgments.filter((j) => j.doc_id === docId).at(-1) ?? null : null;
  const notes = [
    ...(unchecked && !personOk ? [`No messages, internal notes or field notes in this job were written before this ${doc}, so nothing a client approved or asked for can be checked against it; a person has to check it by hand`] : []),
    ...(unjudged.length ? [`${unjudged.length} record${unjudged.length > 1 ? "s" : ""} in this job written before this ${invoice ? "invoice" : "quote"} ${unjudged.length > 1 ? "are" : "is"} not judged yet; the result can change`] : []),
    ...(spot.length ? [`${spot.length} record${spot.length > 1 ? "s" : ""} the model read as empty need${spot.length > 1 ? "" : "s"} a person to spot-check before this can clear`] : []),
    ...questions.map((q) => `Open question (${q.reviewer}, ${Number(q.judged_at.slice(5, 7))}/${Number(q.judged_at.slice(8, 10))}) on ${q.record_id}: ${q.question}`),
    ...openPatterns.map((p) => `${p} (${WARNINGS[p]}) needs the Judge model step, not run here`),
  ];
  const verdict = fired
    ? { state: "warnings" as const, text: `Warnings found (${fired})`, notes }
    : unchecked && !personOk
      // Nothing was read, so nothing was checked: never green.
      ? { state: "not_cleared" as const, text: `Not cleared — no records on file before this ${doc}, so there is nothing to check it against.`, notes }
      : seen.length === 0 && !notes.length
        ? { state: "clear" as const, text: personOk ? personOk.memory_items === 0 ? `Clear — first quote, confirmed by ${personOk.reviewer} by hand (no earlier word from this client on file).` : `Clear — first quote, confirmed by ${personOk.reviewer} against the client's history.` : "Clear — first quote on this job; checked against the client's rules and usual quotes only.", notes }
      : notes.length
        ? { state: "not_cleared" as const, text: "Not cleared", notes }
        : { state: "clear" as const, text: "Clear — every record in this job is accounted for and judged", notes };

  const lines = invoice ? t.invoiceLines.filter((l) => l.invoice_id === docId) : version!.lines;
  const kind = invoice ? "invoice" : "quote";

  // What a person has to confirm before a not-cleared document can clear (docs/value-metrics-amendment-1.md
  // section 4): the same open things the verdict notes count, one item each. P2 is not a person's item (it
  // stays in judge_open), and a document with warnings needs a fix, not a confirmation, so it has none.
  const recItem = (x: (typeof seen)[number], k: "needs_human" | "spot_check") => ({ kind: k, record_id: x.record_id, author: x.author, at: x.recorded_at, source_type: x.source_type, text: x.text, why: k === "spot_check" ? "The model read this record as empty; a person spot-checks it before the document can clear." : x.why });
  const toConfirm = verdict.state !== "not_cleared" ? [] : [
    ...(unchecked && !personOk ? [{ kind: "first_quote" as const, why: `No records in this job before this ${kind}, and not enough client history to check it against: confirm this first ${kind} by hand.` }] : []),
    ...unjudged.map((x) => recItem(x, "needs_human")),
    ...spot.map((x) => recItem(x, "spot_check")),
    ...questions.map((q) => {
      const x = seen.find((s) => s.record_id === q.record_id)!;
      return { kind: "open_question" as const, record_id: q.record_id, author: x.author, at: x.recorded_at, source_type: x.source_type, text: x.text, why: `Open question (${q.reviewer}): ${q.question}` };
    }),
  ];
  return {
    doc: { id: docId, kind, job, client, at: inOffsetOf(at, ms(at)), total: invoice ? Number(invoice.total) : version!.total, lines },
    cutoff: `records up to ${inOffsetOf(at, asOf).slice(11)}, just before this ${kind} was ${invoice ? "issued" : "submitted"}`,
    records: { seen: seen.length, read, unjudged: unjudged.length, spot_check: spot.length },
    verdict,
    warnings,
    to_confirm: toConfirm,
    judge_open: openPatterns,
    // The person's confirmation of a first quote, when there is one (the latest).
    confirmed_by_person: personOk,
    // "What this client told us before", recalled from H-MEM (display only; the verdict above never reads it).
    client_memory: clientMemory(ctx, client, asOf, at),
    // Only records written by the cut-off are part of this check: they are the "Needs your judgment (N)" the
    // verdict counts. Records written later are listed apart, never hidden and never counted.
    queue: {
      needs_human: q.needs_human.filter((x) => ms(x.recorded_at) <= asOf),
      spot_check: q.spot_check.filter((x) => ms(x.recorded_at) <= asOf),
      confirmed: q.confirmed,
      after: [...q.needs_human, ...q.spot_check].filter((x) => ms(x.recorded_at) > asOf).sort((a, b) => ms(a.recorded_at) - ms(b.recorded_at)),
    },
  };
}

// H-MEM recall for the check page (src/ui/client-memory.ts), with each item's record and time in the document's
// own clock.
export function clientMemory(ctx: Ctx, client: string | null, asOf: number, docAt: string) {
  if (!client) return { items: [], recalled: 0, dropped: { other_scope: 0, after_cutoff: 0, superseded: 0 } };
  const t = ctx.data.tables;
  const jobsOf = t.workOrders.filter((w) => w.client_id === client).map((w) => w.work_order_id);
  const clientName = t.clients.find((c) => c.client_id === client)?.name ?? client;
  const recs = new Map(ctx.data.records.map((r) => [r.record_id, r]));
  const cards = new Map(ctx.engine.cards.map((c) => [c.card_id, c]));
  const status = ctx.engine.graph.cardStatus();
  const memOf = ctx.engine.memory.memOf;
  const r = recallClient({
    hmem: ctx.engine.memory.hmem,
    client,
    jobs: jobsOf,
    asOf,
    query: `${clientName} rules approvals rejections`,
    cardOf: (id) => cards.get(id),
    recordAt: (id) => recs.get(id)?.source_recorded_at,
    seatSuccessor: (id) => { const next = status[id]?.replaced_by; return next ? memOf.get(next) : undefined; },
  });
  const names = new Map(meta(ctx).people.map((p) => [p.id, p.name]));
  return {
    ...r,
    items: r.items.map((x) => ({ ...x, who_name: x.who ? names.get(x.who) ?? x.who : null, learned: inOffsetOf(docAt, x.learned_at), source_type: recs.get(x.record_id)?.source_type ?? null, record_text: recs.get(x.record_id)?.text ?? null })),
  };
}

// The curated view: one representative problem document per pattern, picked from the gold questions, plus
// every document designed clean. Most quotes in real work are fine (about 2 in 10 have a problem), so this
// view shows that mix; "All documents" stays the default and is the whole record.
export const CURATED_PROBLEMS: { pattern: string; doc: string; question: string; why: string }[] = [
  { pattern: "P1", doc: "Q-OC-02-v2", question: "q-p1-oc02-camera", why: "a promised camera check never closed; only P1 fires" },
  { pattern: "P2", doc: "Q-RM-01-v2", question: "q-p2-rm01-homerun", why: "the price changed from v1 with no client-facing reason; P2 needs the Judge model step, so it shows as open" },
  { pattern: "P3", doc: "Q-NL-03-v3", question: "q-p3-nl03-progress", why: "versions repeat the same open question; only P3 fires" },
  { pattern: "P4", doc: "Q-NL-04-v3", question: "q-p4-nl04-cap", why: "over Ria's $2,500 pre-note rule; fires only once the rule is on a card (model or person)" },
  { pattern: "P5", doc: "Q-PW-05-v3", question: "q-p5-heron-why", why: "the hero case: three rejections, no reason ever stated" },
  { pattern: "P6", doc: "Q-PW-03-v2", question: "q-p6-pw03-trip", why: "a trip line on a client portal that does not accept travel; a fixed rule, not history" },
  { pattern: "P7", doc: "INV-RM-02", question: "q-p7-rm02-inv", why: "the invoice does not match what was approved; only P7 fires" },
];

// Designed clean = the generator's end-of-window outcome: a quote approved as sent, an invoice paid. Used only
// to choose what the curated view lists, never for a verdict (a verdict reads dated records).
export function designedClean(ctx: Ctx): string[] {
  const t = ctx.data.tables;
  return [...t.quotes.filter((x) => x.status === "approved").map((x) => x.quote_id), ...t.invoices.filter((x) => x.status === "paid").map((x) => x.invoice_id)];
}

// Designed problem / clean per docs/value-metrics.md (the generator's end-of-window outcome), for the sample
// day's draw only; never for a verdict.
export function designedLists(ctx: Ctx): { problem: string[]; clean: string[] } {
  const t = ctx.data.tables;
  const quoteStatus = new Map(t.quotes.map((q) => [q.quote_id, q.status]));
  const all = [...t.quotes.map((q) => ({ id: q.quote_id, d: designedQuote(q) })), ...t.invoices.map((i) => ({ id: i.invoice_id, d: designedInvoice(i, quoteStatus) }))];
  return { problem: all.filter((x) => x.d.outcome === "problem").map((x) => x.id), clean: all.filter((x) => x.d.outcome === "clean").map((x) => x.id) };
}

export function sampleIds(ctx: Ctx): string[] {
  const { problem, clean } = designedLists(ctx);
  const day = sampleDay(problem, clean);
  return [...day.problems, ...day.clean];
}

export function viewIds(ctx: Ctx, view: View): string[] {
  const t = ctx.data.tables;
  const all = [...t.quotes.map((x) => x.quote_id), ...t.invoices.map((x) => x.invoice_id)];
  if (view === "all") return all;
  if (view === "sample") {
    const keep = new Set(sampleIds(ctx));
    return all.filter((id) => keep.has(id));
  }
  const keep = new Set([...CURATED_PROBLEMS.map((p) => p.doc), ...designedClean(ctx)]);
  return all.filter((id) => keep.has(id));
}

// Every document in the view checked, and the money in each verdict state ("checked", never "saved"). Rebuilt
// with the context after each judgment.
// to_confirm: items a person has to confirm over the view's not-cleared documents (amendment 1 section 4), and
// per document, so the outbox reads as a to-do list.
export type Summary = { view: View; documents: number; total: number; all_documents: number; by_state: Record<"warnings" | "not_cleared" | "clear", { n: number; total: number }>; states: Record<string, "warnings" | "not_cleared" | "clear">; to_confirm: { items: number; per_doc: Record<string, number> } };
export function summary(ctx: Ctx, view: View = "all"): Summary {
  const cached = ctx.summaries?.[view];
  if (cached) return cached;
  const ids = viewIds(ctx, view);
  const by_state = { warnings: { n: 0, total: 0 }, not_cleared: { n: 0, total: 0 }, clear: { n: 0, total: 0 } };
  const states: Summary["states"] = {};
  const perDoc: Record<string, number> = {};
  let total = 0;
  for (const id of ids) {
    const c = check(ctx, id)!;
    states[id] = c.verdict.state;
    if (c.to_confirm.length) perDoc[id] = c.to_confirm.length;
    by_state[c.verdict.state].n++;
    by_state[c.verdict.state].total += c.doc.total;
    total += c.doc.total;
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  for (const s of Object.values(by_state)) s.total = r2(s.total);
  const allDocs = ctx.data.tables.quotes.length + ctx.data.tables.invoices.length;
  const out: Summary = { view, documents: ids.length, total: r2(total), all_documents: allDocs, by_state, states, to_confirm: { items: Object.values(perDoc).reduce((a, b) => a + b, 0), per_doc: perDoc } };
  ctx.summaries = { ...ctx.summaries, [view]: out };
  return out;
}

// Prefill for "Effective from" on a quote the person selected: a time phrase in the words, else the message time.
export function effective(ctx: Ctx, recordId: string, quote: string) {
  const rec = ctx.data.records.find((r) => r.record_id === recordId);
  if (!rec) return null;
  const s = suggestEffective(quote, rec.source_recorded_at);
  return { ...s, local: inOffsetOf(s.iso, ms(s.iso)) };
}

// The home page story for a job, served only when every check passes (src/ui/story.ts).
export function story(ctx: Ctx, job: string): { status: 200; body: unknown } | { status: 404 | 500; errors: string[] } {
  const s = loadStoryFile(ctx.root, job);
  if (!s) return { status: 404, errors: [`no story for ${job}`] };
  const people = meta(ctx).people;
  const problems = validateStory(s, job, ctx.data, ctx.engine.cards, people, loadHeroCase(ctx.root));
  if (problems.length) return { status: 500, errors: problems };
  return { status: 200, body: storyResponse(s, ctx.data, people) };
}

export function queue(ctx: Ctx, job?: string) {
  return jobQueue(ctx.view, job);
}

// Validate and append a judgment; returns the stored judgment, or the problems. The caller reloads ctx.
// A body with doc_id is a document-level judgment (a person confirms a first quote against the client's history);
// otherwise a record judgment, as before. Same endpoint, same file.
export function postJudgment(ctx: Ctx, body: unknown): { status: 201; judgment: unknown; warnings: unknown[] } | { status: 400; errors: string[] } {
  if (!body || typeof body !== "object") return { status: 400, errors: ["body must be a JSON object"] };
  try {
    if ("doc_id" in body) {
      const t = ctx.data.tables;
      const ids = new Set([...t.quotes.map((x) => x.quote_id), ...t.invoices.map((x) => x.invoice_id)]);
      const c = check(ctx, String((body as { doc_id: unknown }).doc_id));
      // Only a document whose open item is "confirm this first quote" can be confirmed this way.
      if (c && (c.doc.kind !== "quote" || !c.to_confirm.some((x) => x.kind === "first_quote"))) return { status: 400, errors: ["only a first quote with nothing on file to check it against can be confirmed this way"] };
      return { status: 201, judgment: appendDocJudgment(ctx.root, body as Parameters<typeof appendDocJudgment>[1], ids), warnings: [] };
    }
    const j = appendJudgment(ctx.root, body as JudgmentInput, ctx.data.records, ctx.engine.vocab, ctx.view.modelCards);
    const names = new Map(meta(ctx).people.map((p) => [p.id, p.name]));
    const warnings = judgmentWarnings(body as JudgmentInput, ctx.engine.vocab, ctx.view.modelCards, (id) => names.get(id) ?? id);
    return { status: 201, judgment: j, warnings };
  } catch (e) {
    const msg = (e as Error).message.replace(/^judgment rejected: /, "");
    return { status: 400, errors: msg.split("; ") };
  }
}
