// The ledger: every extractable record lands in exactly one bucket (routing.ts), and the buckets must add up
// to the total. If they do not, complete=false and the line says LEDGER MISMATCH. "unaccounted" counts
// records in no bucket. It is not a "silent loss" number: auto_empty records were looked at only by the
// model, so they stay open for a person to spot-check (npm run queue, the UI) instead of being called safe.
import type { DecisionCard, SourceRecord } from "../engine/types.ts";
import type { IngestReport } from "../pipeline/ingest.ts";
import type { Judgment } from "./judgments.ts";
import { latestPerRecord } from "./judgments.ts";
import { BUCKETS, routeRecord } from "./routing.ts";
import type { Bucket, RecordOutcome } from "./routing.ts";

export type LedgerItem = { record_id: string; bucket: Bucket; why: string };
export type Ledger = {
  total: number;
  counts: Record<Bucket, number>;
  unaccounted: number;
  complete: boolean;
  items: LedgerItem[];
  line: string;
};

type ReportPart = Pick<IngestReport, "records_done" | "records_rejected" | "records_prose_reply" | "records_failed_upstream" | "cards_gate_rejected" | "cards_dropped_by_skeptic">;

const recordOf = (cardId: string) => cardId.match(/^m\.(rec-\d+)\./)?.[1];

// What happened to each record in one ingest. Records are processed in id order (extractableRecords), and
// records_done + failed upstream counts the records the run got to; any after that were not reached.
export function outcomesOf(records: SourceRecord[], cards: DecisionCard[], report: ReportPart, judgments: Judgment[]): RecordOutcome[] {
  const sorted = [...records].sort((a, b) => a.record_id.localeCompare(b.record_id));
  const reached = report.records_done + report.records_failed_upstream.length;
  const latest = latestPerRecord(judgments);
  const count = (ids: string[], rec: string) => ids.filter((id) => recordOf(id) === rec).length;
  return sorted.map((r, i) => {
    const j = latest.get(r.record_id);
    return {
      record_id: r.record_id,
      source_type: r.source_type,
      reached: i < reached,
      cards: cards.filter((c) => c.record_id === r.record_id && c.source !== "human").length,
      failed_upstream: report.records_failed_upstream.find((f) => f.record_id === r.record_id)?.error,
      prose: report.records_prose_reply.includes(r.record_id),
      rejected: report.records_rejected.find((x) => x.record_id === r.record_id)?.why,
      gate_rejected: count(report.cards_gate_rejected.map((c) => c.card_id), r.record_id),
      skeptic_dropped: count(report.cards_dropped_by_skeptic.map((c) => c.card_id), r.record_id),
      judged: j ? { reviewer: j.reviewer, judged_at: j.judged_at, reason: j.reason, verdict: j.verdict, open_questions: j.cards.flatMap((c) => (c.open_question ? [c.open_question] : [])) } : undefined,
    };
  });
}

// total: how many records should be in the ledger; items: where each one went. Pure, so a mismatch can be tested.
export function tally(total: number, items: LedgerItem[]): Ledger {
  const counts = Object.fromEntries(BUCKETS.map((b) => [b, items.filter((x) => x.bucket === b).length])) as Record<Bucket, number>;
  const placed = new Set(items.map((x) => x.record_id)).size;
  const sum = BUCKETS.reduce((s, b) => s + counts[b], 0);
  const complete = sum === total && placed === total;
  const unaccounted = Math.max(0, total - placed);
  const body = `${total} records = ${counts.auto_cards} auto + ${counts.auto_empty} empty (open for spot-check) + ${counts.needs_human} need you + ${counts.human_confirmed} confirmed; unaccounted: ${unaccounted}`;
  const line = complete ? body : `LEDGER MISMATCH: ${body} (buckets add up to ${sum}, ${placed} distinct records placed)`;
  return { total, counts, unaccounted, complete, items, line };
}

export function buildLedger(records: SourceRecord[], cards: DecisionCard[], report: ReportPart, judgments: Judgment[]): Ledger {
  const items = outcomesOf(records, cards, report, judgments).map((o) => ({ record_id: o.record_id, ...routeRecord(o) }));
  return tally(records.length, items);
}
