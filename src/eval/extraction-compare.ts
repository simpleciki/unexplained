// Extraction run 2's comparison (docs/extraction-run-2.md), as pure functions: both runs scored against the gold
// cards with src/eval/extraction-score.ts in one call, plus prose / failed-upstream / card counts from each run's
// report and the median latency of calls that reached the model (cache misses) from its trace.
import type { DecisionCard } from "../engine/types.ts";
import { extractionScore } from "./extraction-score.ts";

export type RunInput = { label: string; cards: DecisionCard[]; report: { records_prose_reply?: string[]; records_failed_upstream?: unknown[]; complete?: boolean }; traceLines: string[] | null; finished?: string | null };

export function medianLatency(traceLines: string[] | null): { median_ms: number | null; calls: number } | null {
  if (!traceLines) return null;
  const ms = traceLines
    .map((l) => JSON.parse(l) as { action?: string; outcome?: string; latency_ms?: number })
    .filter((e) => e.action === "model_call" && /(^|;)cache=miss(;|$)/.test(e.outcome ?? "") && typeof e.latency_ms === "number")
    .map((e) => e.latency_ms!)
    .sort((a, b) => a - b);
  if (!ms.length) return { median_ms: null, calls: 0 };
  const m = Math.floor(ms.length / 2);
  return { median_ms: ms.length % 2 ? ms[m] : (ms[m - 1] + ms[m]) / 2, calls: ms.length };
}

export function scoreRun(r: RunInput, gold: DecisionCard[]) {
  const s = extractionScore(r.cards, gold);
  return {
    label: r.label,
    cards: r.cards.length,
    matched: s.matched,
    gold_cards: s.gold_cards,
    precision: s.precision,
    recall: s.recall,
    records_prose: r.report.records_prose_reply?.length ?? 0,
    records_failed_upstream: r.report.records_failed_upstream?.length ?? 0,
    complete: r.report.complete ?? null,
    latency: medianLatency(r.traceLines),
    finished: r.finished ?? null,
  };
}

// The pre-registered rule: B replaces A only if its precision is not lower and its recall is not lower. Compared on
// the exact fractions (matched / cards, matched / gold), not the rounded numbers. A run finished after the cut-off
// is not used, whatever its score.
export const CUTOFF = "2026-10-26T11:00:00-05:00"; // scheduled cut-off (planned, docs/extraction-run-2.md)
export function decide(a: ReturnType<typeof scoreRun>, b: ReturnType<typeof scoreRun>) {
  if (b.finished && Date.parse(b.finished) > Date.parse(CUTOFF)) return { adopt: false, why: `B finished ${b.finished}, after the cut-off ${CUTOFF}: not used` };
  if (!b.cards) return { adopt: false, why: "B has no cards" };
  const pNotLower = b.matched * a.cards >= a.matched * b.cards;
  const rNotLower = b.matched >= a.matched; // same gold set on both sides
  const why = `precision ${b.precision} vs ${a.precision} (${pNotLower ? "not lower" : "lower"}), recall ${b.recall} vs ${a.recall} (${rNotLower ? "not lower" : "lower"})`;
  return { adopt: pNotLower && rNotLower, why };
}
