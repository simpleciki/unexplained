// ingest: Researcher over every message and note -> gate (verify.ts) -> Skeptic stage 1 (unsupported
// cards are re-extracted, at most twice, then dropped) -> Keeper over every seat pair -> seat graph,
// H-MEM and state/. A budget stop writes what it has and says so.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadDataset } from "../engine/data.ts";
import { buildEngine, saveState } from "../engine/engine.ts";
import type { Dataset, DecisionCard, RelationEdge, SourceRecord } from "../engine/types.ts";
import { verifyCards } from "../engine/verify.ts";
import { loadVocab } from "../engine/vocab.ts";
import { AllRoutesDead, BudgetExhausted, RunStopped } from "../llm/client.ts";
import { redactAccount } from "../llm/http.ts";
import { isProseError } from "../llm/json.ts";
import { ProviderError } from "../llm/provider.ts";

// Upstream failures in a row (records or pairs) that stop an ingest.
export const MAX_CONSECUTIVE_UPSTREAM_FAILURES = 5;
import { EXTRACT_TYPES, extract } from "../agents/researcher.ts";
import { checkCards } from "../agents/skeptic.ts";
import { relate, seatPairs } from "../agents/keeper.ts";
import { agentContext } from "../agents/shared.ts";
import type { Runtime } from "./runtime.ts";
import { applyJudgments, loadJudgments } from "../review/judgments.ts";
import { ingestSource } from "./ingest-source.ts";
import { buildLedger } from "../review/ledger.ts";
import type { Ledger } from "../review/ledger.ts";

export type IngestReport = {
  complete: boolean;
  stopped_reason?: string;
  records_total: number;
  records_done: number;
  records_rejected: { record_id: string; why: string }[];
  // Records whose last extraction attempt was still prose (a plan, not JSON): nothing was learned from
  // them and nothing was cached. Same for Keeper pairs.
  records_prose_reply: string[];
  pairs_prose_reply: string[];
  records_failed_upstream: { record_id: string; error: string }[];
  records_failed_upstream_count: number;
  pairs_failed_upstream: { pair: string; error: string }[];
  cards_gate_rejected: { card_id: string; result: string; why?: string }[];
  cards_dropped_by_skeptic: { card_id: string; why: string }[];
  cards: number;
  pairs_total: number;
  pairs_judged: number;
  edges: number;
  // Where every record went (src/review/ledger.ts); the full list is in review-queue.json next to cards.json.
  ledger?: Pick<Ledger, "line" | "complete" | "counts" | "unaccounted">;
};

export const extractableRecords = (records: SourceRecord[]) =>
  records.filter((r) => EXTRACT_TYPES.has(r.source_type)).sort((a, b) => a.record_id.localeCompare(b.record_id));

// Sample mode: Researcher + Skeptic over these records only, no Keeper; cards and the report go to `out`,
// and nothing under state/ is written.
export type IngestSample = { records: string[]; out: string };

export function sampleRecords(records: SourceRecord[], ids: string[]): SourceRecord[] {
  const all = extractableRecords(records);
  const unknown = ids.filter((id) => !all.some((r) => r.record_id === id));
  if (unknown.length) throw new Error(`--records: not an extractable record id: ${unknown.join(", ")}`);
  return all.filter((r) => ids.includes(r.record_id));
}

export function sampleOutDir(root: string, out: string): string {
  const dir = resolve(root, out);
  if (dir === resolve(root, "state") || dir === resolve(root)) throw new Error("--out must be its own directory (for example state/sample-007), not state/ or the repo root");
  return dir;
}

export async function runIngest(root: string, rt: Runtime, preloaded?: Dataset, sample?: IngestSample): Promise<IngestReport> {
  const data = preloaded ?? loadDataset(root);
  const vocab = loadVocab(root);
  const ctx = agentContext(root, data, vocab);
  const records = sample ? sampleRecords(data.records, sample.records) : extractableRecords(data.records);
  const outDir = sample ? sampleOutDir(root, sample.out) : join(root, "state");
  const byId = new Map(data.records.map((r) => [r.record_id, r]));
  const report: IngestReport = {
    complete: false, records_total: records.length, records_done: 0, records_rejected: [], records_prose_reply: [], pairs_prose_reply: [], records_failed_upstream: [], records_failed_upstream_count: 0, pairs_failed_upstream: [], cards_gate_rejected: [],
    cards_dropped_by_skeptic: [], cards: 0, pairs_total: 0, pairs_judged: 0, edges: 0,
  };
  const accepted: DecisionCard[] = [];
  const edges: (RelationEdge & { reason: string })[] = [];

  const gate = (cards: DecisionCard[]) => {
    const checked = verifyCards(cards, data.records, vocab);
    for (const c of checked) if (c.result !== "PASS") report.cards_gate_rejected.push({ card_id: c.card_id, result: c.result, why: c.reason });
    return checked.filter((c) => c.result === "PASS").map(({ result: _r, reason: _x, ...c }) => c as DecisionCard);
  };

  // One record whose upstream call fails is skipped (and retried by the next run: nothing was cached);
  // only MAX_CONSECUTIVE_UPSTREAM_FAILURES in a row stop the run. The budget still stops it at once.
  let consecutive = 0;
  const upstream = async (what: () => Promise<void>, onFail: (msg: string) => void) => {
    try {
      await what();
      consecutive = 0;
    } catch (e) {
      if (e instanceof BudgetExhausted || !(e instanceof AllRoutesDead || e instanceof ProviderError)) throw e;
      const msg = redactAccount(e.message).slice(0, 300);
      onFail(msg);
      if (++consecutive >= MAX_CONSECUTIVE_UPSTREAM_FAILURES) {
        throw new RunStopped(`stopped after ${consecutive} consecutive upstream failures; last: ${msg}`);
      }
    }
  };

  try {
    for (const rec of records) {
      await upstream(() => ingestRecord(rec), (error) => report.records_failed_upstream.push({ record_id: rec.record_id, error }));
    }
    const checked = verifyCards(accepted, data.records, vocab).filter((c) => c.result === "PASS");
    const pairs = sample ? [] : seatPairs(checked);
    report.pairs_total = pairs.length;
    for (const [older, newer] of pairs) {
      await upstream(
        async () => {
          const edge = await relate(rt.client, rt.models.keeper, older, newer, byId);
          edges.push(edge);
          if (isProseError(edge.reason)) report.pairs_prose_reply.push(`${older.card_id}>${newer.card_id}`);
          report.pairs_judged++;
        },
        (error) => report.pairs_failed_upstream.push({ pair: `${older.card_id}>${newer.card_id}`, error }),
      );
    }
    const failures = report.records_failed_upstream.length + report.pairs_failed_upstream.length + report.records_prose_reply.length + report.pairs_prose_reply.length;
    report.complete = failures === 0;
    if (!report.complete) report.stopped_reason = "finished, but some records or pairs failed upstream or answered in prose; rerun to retry them";
  } catch (e) {
    if (!(e instanceof RunStopped)) throw e; // budget reached, every route dead, or too many failures in a row
    report.stopped_reason = e.message;
  }
  report.records_failed_upstream_count = report.records_failed_upstream.length;

  async function ingestRecord(rec: SourceRecord) {
    const first = await extract(rt.client, rt.models.researcher, rec, ctx);
    if (first.rejected) {
      if (isProseError(first.error)) report.records_prose_reply.push(rec.record_id);
      report.records_rejected.push({ record_id: rec.record_id, why: first.error ?? "no valid reply" });
      report.records_done++;
      return;
    }
    let cards = gate(first.cards);
    // Skeptic stage 1, at most two re-extractions; whatever is still unsupported after that is dropped.
    for (let round = 1; cards.length && round <= 3; round++) {
      const verdicts = await checkCards(rt.client, rt.models.skeptic, rec, cards);
      if (!verdicts) break; // no usable check: the gate-passed cards stand
      const bad = cards.filter((c) => verdicts.find((v) => v.id === c.card_id)?.supported === false);
      if (!bad.length) break;
      if (round === 3) {
        for (const c of bad) report.cards_dropped_by_skeptic.push({ card_id: c.card_id, why: verdicts.find((v) => v.id === c.card_id)?.why ?? "" });
        cards = cards.filter((c) => !bad.includes(c));
        break;
      }
      const hint = bad.map((c) => `"${c.quote}" (${verdicts.find((v) => v.id === c.card_id)?.why})`).join("; ");
      const again = await extract(rt.client, rt.models.researcher, rec, ctx, round, hint);
      if (!again.rejected) cards = gate(again.cards);
      else if (isProseError(again.error) && !report.records_prose_reply.includes(rec.record_id)) report.records_prose_reply.push(rec.record_id);
    }
    accepted.push(...cards);
    report.records_done++;
  }

  report.cards = accepted.length;
  report.edges = edges.filter((e) => e.relation !== "UNRELATED").length;
  const ledger = buildLedger(records, accepted, report, loadJudgments(root));
  report.ledger = { line: ledger.line, complete: ledger.complete, counts: ledger.counts, unaccounted: ledger.unaccounted };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "review-queue.json"), JSON.stringify(ledger, null, 2) + "\n");
  writeFileSync(join(outDir, "cards.json"), JSON.stringify(accepted, null, 2) + "\n");
  writeFileSync(join(outDir, "ingest-report.json"), JSON.stringify(report, null, 2) + "\n");
  if (sample) return report;
  writeFileSync(join(outDir, "edges.json"), JSON.stringify(edges, null, 2) + "\n");
  saveState(buildEngine(root, accepted, edges, undefined, data), root);
  return report;
}

// Cards and relations from the last ingest, with human judgments applied (review/judgments.jsonl): a judged
// record uses the person's cards. `modelCards` is the model's output alone: extraction scores use only that.
// The engine is built from these, never from eval/gold/.
export function loadIngested(root: string, data?: Dataset) {
  const src = ingestSource(root); // state/, else the committed snapshot
  const f = (n: string) => join(src.dir, n);
  if (!existsSync(f("cards.json")) || !existsSync(f("edges.json"))) throw new Error("no ingested cards yet: run `npm run ingest -- --max-calls N` first");
  const modelCards = JSON.parse(readFileSync(f("cards.json"), "utf8")) as DecisionCard[];
  const modelEdges = JSON.parse(readFileSync(f("edges.json"), "utf8")) as RelationEdge[];
  const judgments = loadJudgments(root);
  if (!judgments.length) return { cards: modelCards, edges: modelEdges, modelCards, judgments };
  const applied = applyJudgments(modelCards, modelEdges, judgments, (data ?? loadDataset(root)).records, loadVocab(root));
  return { cards: applied.cards, edges: applied.edges, modelCards, judgments };
}
