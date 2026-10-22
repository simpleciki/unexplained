// Quote and invoice state derived from dated records. The status columns in the tables are
// end-of-window state and are never read here.
import type { CheckedCard, Dataset, Row, SourceRecord } from "./types.ts";
import { parseTime } from "./time.ts";
import type { Vocab } from "./vocab.ts";

export const ms = (iso: string) => parseTime(iso)?.start ?? Number.NaN;

export type Line = { kind: string; category: string; description: string; qty: number; unit_price: number; amount: number };

// The five cost categories a client portal totals lines into.
export const CATEGORIES = ["labor", "travel", "material", "freight", "management"] as const;

export function categoryTotals(lines: Line[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of lines) out[l.category] = round2((out[l.category] ?? 0) + l.amount);
  return out;
}
export type Version = {
  quote_id: string;
  work_order_id: string;
  version: number;
  at: number;
  total: number;
  labor: number;
  material: number;
  scope_summary: string;
  lines: Line[];
  record: SourceRecord;
};
export type Approval = { card: CheckedCard; quote_id: string | null; positive: boolean };

// Client wording that refuses or holds a version. Polarity of an approval card is a judgment; this
// deterministic reading covers the phrasings in the data and is reported, not hidden, when it misses.
const NEGATIVE = /\b(not approving|can't approve|cannot approve|rejected|not this version|not what i approved|hold off|never signed)\b/i;

export class Docs {
  private recordByRow = new Map<string, SourceRecord>();
  readonly versions: Version[];
  readonly clientOf = new Map<string, string>();

  constructor(
    private data: Dataset,
    private cards: CheckedCard[],
    private vocab: Vocab,
  ) {
    for (const r of data.records) if (r.row_key) this.recordByRow.set(`${r.source_type}:${r.row_key}`, r);
    for (const w of data.tables.workOrders) this.clientOf.set(w.work_order_id, w.client_id);
    this.versions = data.tables.quotes
      .map((q) => ({
        quote_id: q.quote_id,
        work_order_id: q.work_order_id,
        version: Number(q.version),
        at: ms(q.submitted_at),
        total: Number(q.total),
        labor: Number(q.total_labor),
        material: Number(q.total_material),
        scope_summary: q.scope_summary,
        lines: this.lines(data.tables.quoteLines, "quote_id", q.quote_id),
        record: this.recordFor("quote_version", q.quote_id),
      }))
      .sort((a, b) => a.at - b.at);
  }

  recordFor(type: string, key: string): SourceRecord {
    const r = this.recordByRow.get(`${type}:${key}`);
    if (!r) throw new Error(`no ${type} record for ${key}`);
    return r;
  }

  lines(rows: Row[], keyCol: string, key: string): Line[] {
    return rows
      .filter((l) => l[keyCol] === key)
      .sort((a, b) => Number(a.line_no) - Number(b.line_no))
      .map((l) => ({
        kind: l.kind,
        category: l.category || l.kind,
        description: l.description,
        qty: Number(l.qty),
        unit_price: Number(l.unit_price),
        amount: Number(l.amount),
      }));
  }

  versionsOf(job: string, asOf?: number): Version[] {
    return this.versions.filter((v) => v.work_order_id === job && (asOf === undefined || v.at <= asOf));
  }

  events(job: string, asOf: number) {
    return this.data.tables.events
      .filter((e) => e.work_order_id === job && ms(e.at) <= asOf)
      .sort((a, b) => ms(a.at) - ms(b.at));
  }

  voidedBy(quoteId: string, asOf: number): boolean {
    return this.data.tables.events.some((e) => e.quote_id === quoteId && e.event === "voided" && ms(e.at) <= asOf);
  }

  // Client approval/rejection decisions on a job, mapped to the version they answer.
  approvals(job: string, asOf: number): Approval[] {
    const deciders = new Set(this.vocab.deciders.approval ?? []);
    return this.cards
      .filter(
        (c) =>
          c.result === "PASS" &&
          c.topic === "approval" &&
          c.scope === `job:${job}` &&
          c.facets.includes("approval.status") &&
          (c.mode === "decides" || c.mode === "gives_reason") &&
          deciders.has(c.decided_by) &&
          ms(c.decided_at) <= asOf,
      )
      .sort((a, b) => ms(a.decided_at) - ms(b.decided_at))
      .map((card) => ({ card, quote_id: this.versionAnswered(job, card), positive: !NEGATIVE.test(this.text(card)) }));
  }

  private text(card: CheckedCard): string {
    return this.data.records.find((r) => r.record_id === card.record_id)?.text ?? card.quote;
  }

  // Which version a decision answers: an explicit quote id, an explicit "vN", else the latest live version sent before it.
  private versionAnswered(job: string, card: CheckedCard): string | null {
    const text = this.text(card);
    const id = text.match(/\bQ-[A-Z]{2}-\d{2}-v\d+\b/)?.[0];
    if (id && this.versions.some((v) => v.quote_id === id)) return id;
    const n = text.match(/\bv(\d+)\b/)?.[1];
    const decided = ms(card.decided_at);
    const sent = this.versionsOf(job).filter((v) => v.at <= decided);
    if (n) return sent.find((v) => v.version === Number(n))?.quote_id ?? this.versionsOf(job).find((v) => v.version === Number(n))?.quote_id ?? null;
    const live = sent.filter((v) => !this.voidedBy(v.quote_id, decided));
    return live.at(-1)?.quote_id ?? null;
  }

  approvedVersions(job: string, asOf: number): { version: Version; approval: Approval }[] {
    const out = new Map<string, { version: Version; approval: Approval }>();
    for (const a of this.approvals(job, asOf)) {
      if (!a.quote_id) continue;
      if (a.positive) out.set(a.quote_id, { version: this.versions.find((v) => v.quote_id === a.quote_id)!, approval: a });
      else out.delete(a.quote_id);
    }
    return [...out.values()];
  }

  portalCategories(client: string | null): Set<string> | null {
    const row = this.data.tables.clients.find((c) => c.client_id === client);
    return row ? new Set(row.portal_categories.split(";").filter(Boolean)) : null;
  }

  rejections(job: string, asOf: number): Approval[] {
    return this.approvals(job, asOf).filter((a) => !a.positive);
  }
}

export type LineChange = { change: "added" | "removed" | "changed"; kind: string; description: string; delta: number; from?: Line; to?: Line };

// Line-level diff keyed by kind + description.
export function diffLines(before: Line[], after: Line[]): LineChange[] {
  const key = (l: Line) => `${l.kind}|${l.description.toLowerCase()}`;
  const a = new Map(before.map((l) => [key(l), l]));
  const b = new Map(after.map((l) => [key(l), l]));
  const out: LineChange[] = [];
  for (const [k, l] of b) {
    const old = a.get(k);
    if (!old) out.push({ change: "added", kind: l.kind, description: l.description, delta: l.amount, to: l });
    else if (old.qty !== l.qty || old.unit_price !== l.unit_price) {
      out.push({ change: "changed", kind: l.kind, description: l.description, delta: round2(l.amount - old.amount), from: old, to: l });
    }
  }
  for (const [k, l] of a) if (!b.has(k)) out.push({ change: "removed", kind: l.kind, description: l.description, delta: -l.amount, from: l });
  return out;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
