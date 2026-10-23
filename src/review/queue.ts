// The review view shared by `npm run queue` and the UI: the ledger plus, per job, the records a person should
// see. "needs_human" items are the ones the system cannot vouch for. "auto_empty" items (the model found
// nothing) are listed too, separately and collapsed, so they stay open for a spot-check instead of being
// treated as safe. Reads state/ and review/judgments.jsonl; never calls a model.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadDataset } from "../engine/data.ts";
import type { Dataset, DecisionCard, SourceRecord } from "../engine/types.ts";
import { extractableRecords } from "../pipeline/ingest.ts";
import type { IngestReport } from "../pipeline/ingest.ts";
import { historyOf, latestPerRecord, loadJudgments } from "./judgments.ts";
import type { Judgment } from "./judgments.ts";
import { buildLedger } from "./ledger.ts";
import type { Ledger } from "./ledger.ts";
import type { Bucket } from "./routing.ts";

export type QueueItem = {
  record_id: string;
  bucket: Bucket;
  why: string;
  source_type: string;
  author: string;
  recorded_at: string;
  job: string | null;
  text: string;
  candidates: Pick<DecisionCard, "card_id" | "mode" | "decided_by" | "topic" | "quote">[];
  judgment?: Judgment;
  // Earlier judgments the latest one replaced, oldest first: "replaces the judgment of <date>: ...".
  history: { judgment_id: string; judged_at: string; reviewer: string; verdict: Judgment["verdict"]; types: string[]; reason: string }[];
};

export type ReviewView = { data: Dataset; modelCards: DecisionCard[]; judgments: Judgment[]; ledger: Ledger; items: QueueItem[] };

export function loadReviewView(root: string, data: Dataset = loadDataset(root)): ReviewView {
  const state = (n: string) => join(root, "state", n);
  if (!existsSync(state("cards.json")) || !existsSync(state("ingest-report.json"))) throw new Error("no ingest yet: run `npm run ingest -- --max-calls N` first");
  const modelCards = JSON.parse(readFileSync(state("cards.json"), "utf8")) as DecisionCard[];
  const report = JSON.parse(readFileSync(state("ingest-report.json"), "utf8")) as IngestReport;
  const records = extractableRecords(data.records);
  if (report.records_total !== records.length) throw new Error(`state/ingest-report.json covers ${report.records_total} records but data/ has ${records.length}: it is from a sample or another dataset`);
  const judgments = loadJudgments(root);
  const ledger = buildLedger(records, modelCards, report, judgments);
  const byId = new Map<string, SourceRecord>(data.records.map((r) => [r.record_id, r]));
  const latest = latestPerRecord(judgments);
  const items = ledger.items.map((x): QueueItem => {
    const r = byId.get(x.record_id)!;
    return {
      ...x,
      source_type: r.source_type,
      author: r.author,
      recorded_at: r.source_recorded_at,
      job: r.thread_id ?? null,
      text: r.text,
      candidates: modelCards.filter((c) => c.record_id === x.record_id).map(({ card_id, mode, decided_by, topic, quote }) => ({ card_id, mode, decided_by, topic, quote })),
      judgment: latest.get(x.record_id),
      history: historyOf(judgments, x.record_id).map((h) => ({ judgment_id: h.judgment_id, judged_at: h.judged_at, reviewer: h.reviewer, verdict: h.verdict, types: h.cards.map((c) => c.mode), reason: h.reason })),
    };
  });
  return { data, modelCards, judgments, ledger, items };
}

export function jobQueue(view: ReviewView, job?: string) {
  const of = (b: Bucket) => view.items.filter((x) => x.bucket === b && (!job || x.job === job));
  return { needs_human: of("needs_human"), spot_check: of("auto_empty"), confirmed: of("human_confirmed") };
}
