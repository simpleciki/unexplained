// The gatekeeper screen's API, as plain functions (server.ts only routes HTTP to them, so they are tested
// without a network). Nothing here calls a model: warnings come from the deterministic engine, built from
// the ingested model cards with human judgments applied.
import { buildEngine } from "../engine/engine.ts";
import type { Engine } from "../engine/engine.ts";
import type { Dataset, Flag } from "../engine/types.ts";
import { ms } from "../engine/docs.ts";
import { runDetectors } from "../engine/detectors/index.ts";
import { agentContext } from "../agents/shared.ts";
import { loadIngested } from "../pipeline/ingest.ts";
import { appendJudgment, confirmation, judgmentWarnings, openQuestions } from "../review/judgments.ts";
import { suggestEffective } from "../review/effective.ts";
import type { JudgmentInput } from "../review/judgments.ts";
import { jobQueue, loadReviewView } from "../review/queue.ts";
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

export type Ctx = { root: string; data: Dataset; view: ReviewView; engine: Engine };

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
        ...t.quotes.filter((x) => x.work_order_id === w.work_order_id).map((x) => ({ kind: "quote" as const, id: x.quote_id, label: `v${x.version}`, at: x.submitted_at, total: Number(x.total) })),
        ...t.invoices.filter((x) => x.work_order_id === w.work_order_id).map((x) => ({ kind: "invoice" as const, id: x.invoice_id, label: x.invoice_id, at: x.issued_at, total: Number(x.total) })),
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
// judge, or an open question a person left on a card they kept. Records the model read as empty are
// reported as open for spot-check but do not block "clear".
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

  const warnings = flags
    .filter((f) => f.pattern in WARNINGS)
    .map((f) => {
      // P2 needs a judgment on whether the client-facing text explains a change: a model step, not run here.
      const needsJudge = f.pattern === "P2" && !f.fired && Array.isArray((f.details as { changes?: unknown[] }).changes) && ((f.details as { changes: unknown[] }).changes.length > 0);
      const status = f.fired
        ? "warning"
        : needsJudge
          ? "not judged here (needs the Judge model step)"
          : unjudged.length || questions.length
            ? `no evidence in the ${read} of ${seen.length} records read${questions.length ? `; ${questions.length} open question${questions.length > 1 ? "s" : ""}` : ""}`
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

  const fired = warnings.filter((w) => w.fired).length;
  const openPatterns = warnings.filter((w) => w.open).map((w) => w.pattern);
  const notes = [
    ...(unjudged.length ? [`${unjudged.length} record${unjudged.length > 1 ? "s" : ""} in this job written before this ${invoice ? "invoice" : "quote"} ${unjudged.length > 1 ? "are" : "is"} not judged yet; the result can change`] : []),
    ...questions.map((q) => `Open question (${q.reviewer}, ${Number(q.judged_at.slice(5, 7))}/${Number(q.judged_at.slice(8, 10))}) on ${q.record_id}: ${q.question}`),
    ...openPatterns.map((p) => `${p} (${WARNINGS[p]}) needs the Judge model step, not run here`),
  ];
  const info = spot.length ? `${spot.length} record${spot.length > 1 ? "s" : ""} the model read as empty ${spot.length > 1 ? "are" : "is"} open for spot-check` : null;
  const verdict = fired
    ? { state: "warnings" as const, text: `Warnings found (${fired})`, notes, info }
    : notes.length
      ? { state: "not_cleared" as const, text: "Not cleared", notes, info }
      : { state: "clear" as const, text: "Clear — every record in this job is accounted for and judged", notes, info };

  const lines = invoice ? t.invoiceLines.filter((l) => l.invoice_id === docId) : version!.lines;
  const kind = invoice ? "invoice" : "quote";
  return {
    doc: { id: docId, kind, job, client, at: inOffsetOf(at, ms(at)), total: invoice ? Number(invoice.total) : version!.total, lines },
    cutoff: `records up to ${inOffsetOf(at, asOf).slice(11)}, just before this ${kind} was ${invoice ? "issued" : "submitted"}`,
    records: { seen: seen.length, read, unjudged: unjudged.length, spot_check: spot.length },
    verdict,
    warnings,
    queue: q,
  };
}

// Prefill for "Effective from" on a quote the person selected: a time phrase in the words, else the message time.
export function effective(ctx: Ctx, recordId: string, quote: string) {
  const rec = ctx.data.records.find((r) => r.record_id === recordId);
  if (!rec) return null;
  const s = suggestEffective(quote, rec.source_recorded_at);
  return { ...s, local: inOffsetOf(s.iso, ms(s.iso)) };
}

export function queue(ctx: Ctx, job?: string) {
  return jobQueue(ctx.view, job);
}

// Validate and append a judgment; returns the stored judgment, or the problems. The caller reloads ctx.
export function postJudgment(ctx: Ctx, body: unknown): { status: 201; judgment: unknown; warnings: unknown[] } | { status: 400; errors: string[] } {
  if (!body || typeof body !== "object") return { status: 400, errors: ["body must be a JSON object"] };
  try {
    const j = appendJudgment(ctx.root, body as JudgmentInput, ctx.data.records, ctx.engine.vocab, ctx.view.modelCards);
    const names = new Map(meta(ctx).people.map((p) => [p.id, p.name]));
    const warnings = judgmentWarnings(body as JudgmentInput, ctx.engine.vocab, ctx.view.modelCards, (id) => names.get(id) ?? id);
    return { status: 201, judgment: j, warnings };
  } catch (e) {
    const msg = (e as Error).message.replace(/^judgment rejected: /, "");
    return { status: 400, errors: msg.split("; ") };
  }
}
