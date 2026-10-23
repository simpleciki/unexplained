// Dry-run call estimates, printed before any model call. "base" assumes every reply is valid and every
// card is supported; "worst" assumes every retry and re-extraction is used. Card and seat-pair counts are
// not known before extraction, so they are estimated from the gold card layout (said so in the output).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadDataset, parseJsonl } from "../engine/data.ts";
import { Docs, diffLines } from "../engine/docs.ts";
import { focusOf } from "../engine/focus.ts";
import { asOfMs } from "../engine/time.ts";
import type { DecisionCard } from "../engine/types.ts";
import { verifyCards } from "../engine/verify.ts";
import { loadVocab } from "../engine/vocab.ts";
import { seatPairs } from "../agents/keeper.ts";
import { extractableRecords, sampleRecords } from "../pipeline/ingest.ts";
import type { GoldQuestion } from "./scoring.ts";

export type StageEstimate = { stage: string; agent: string; base: number; worst: number; basis: string };
export type Estimate = { name: string; stages: StageEstimate[]; base: number; worst: number; notes: string[] };

const total = (name: string, stages: StageEstimate[], notes: string[] = []): Estimate => ({
  name,
  stages,
  base: stages.reduce((s, x) => s + x.base, 0),
  worst: stages.reduce((s, x) => s + x.worst, 0),
  notes,
});

// sample: only these records, and no Keeper (ingest --records).
export function estimateIngest(root: string, sample?: string[]): Estimate {
  const data = loadDataset(root);
  const records = sample ? sampleRecords(data.records, sample) : extractableRecords(data.records);
  const ids = new Set(records.map((r) => r.record_id));
  const gold = parseJsonl<DecisionCard>(readFileSync(join(root, "eval/gold/gold_cards.jsonl"), "utf8")).filter((c) => ids.has(c.record_id));
  const withCards = new Set(gold.map((c) => c.record_id)).size;
  const pairs = sample ? 0 : seatPairs(verifyCards(gold, data.records, loadVocab(root)).filter((c) => c.result === "PASS")).length;
  const n = records.length;
  return total(
    sample ? `ingest sample (${n} records, no Keeper)` : "ingest",
    [
      // Per record: 1 extraction (+2 retries); worst adds 2 re-extractions of 3 attempts each.
      { stage: "ingest", agent: "Researcher.extract", base: n, worst: n * 3 + n * 2 * 3, basis: `${n} messages and notes` },
      // One check per record with cards (+2 retries), up to 3 rounds.
      { stage: "ingest", agent: "Skeptic.cards", base: withCards, worst: n * 3 * 3, basis: `${withCards} records carry cards in the gold layout` },
      { stage: "ingest", agent: "Keeper.relate", base: pairs, worst: pairs * 2, basis: sample ? "not run in sample mode" : `${pairs} same-seat decision pairs in the gold layout` },
    ],
    ["Card and pair counts are estimated from the gold card layout; the real counts depend on what the Researcher extracts.", "Plus one GET /v1/models to choose model ids (not a model call)."],
  );
}

// Per question: Router (+1 retry), Judge only when the focus quote changed (+1), Explainer (+1), Skeptic (+2).
export function estimateQuestions(root: string, questions: GoldQuestion[], name: string): Estimate {
  const data = loadDataset(root);
  const docs = new Docs(data, [], loadVocab(root));
  let judged = 0;
  for (const q of questions) {
    const at = q.as_of ? asOfMs(q.as_of) : Number.POSITIVE_INFINITY;
    const f = focusOf(q, at, docs, data);
    const prev = f.quote ? docs.versionsOf(f.quote.work_order_id).filter((v) => v.version < f.quote!.version).at(-1) : undefined;
    if (f.quote && prev && diffLines(prev.lines, f.quote.lines).length) judged++;
  }
  const n = questions.length;
  return total(name, [
    { stage: "answer", agent: "Router", base: n, worst: n * 2, basis: `${n} questions` },
    { stage: "answer", agent: "Judge.explained", base: judged, worst: judged * 2, basis: `${judged} questions whose focus quote changed from the previous version` },
    { stage: "answer", agent: "Explainer", base: n, worst: n * 2, basis: `${n} questions` },
    { stage: "answer", agent: "Skeptic.answer", base: n, worst: n * 3, basis: `${n} questions` },
  ], ["Needs a finished ingest (state/cards.json). Without one, add the ingest estimate."]);
}

export function printEstimate(e: Estimate, maxCalls: number | null) {
  console.log(`Dry-run estimate: ${e.name}`);
  console.log("agent                 base  worst  basis");
  for (const s of e.stages) console.log(`${s.agent.padEnd(20)} ${String(s.base).padStart(5)} ${String(s.worst).padStart(6)}  ${s.basis}`);
  console.log(`${"total".padEnd(20)} ${String(e.base).padStart(5)} ${String(e.worst).padStart(6)}`);
  for (const n of e.notes) console.log(`note: ${n}`);
  if (maxCalls !== null) {
    const verdict = maxCalls >= e.worst ? "covers the worst case" : maxCalls >= e.base ? "covers the base case, may stop early" : "below the base case: the run will stop early and keep what it has";
    console.log(`--max-calls ${maxCalls}: ${verdict}. Cached replies cost no calls.`);
  }
}
