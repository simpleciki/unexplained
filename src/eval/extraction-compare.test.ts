// The pre-registered adoption rule (docs/extraction-run-2.md) and the latency measure, on invented numbers.
import { describe, expect, it } from "vitest";
import { CUTOFF, decide, medianLatency } from "./extraction-compare.ts";

const run = (cards: number, matched: number, finished: string | null = null) => ({
  label: "x", cards, matched, gold_cards: 100, precision: Math.round((matched / cards) * 1000) / 1000, recall: matched / 100,
  records_prose: 0, records_failed_upstream: 0, complete: true, latency: null, finished,
});
// Finish times relative to the cut-off, in minutes.
const at = (minutes: number) => new Date(Date.parse(CUTOFF) + minutes * 60_000).toISOString();

describe("extraction run 2 decision", () => {
  it("adopts B only when neither precision nor recall is lower (exact fractions)", () => {
    expect(decide(run(73, 32), run(73, 32)).adopt).toBe(true); // equal on both: not lower
    expect(decide(run(73, 32), run(60, 33)).adopt).toBe(true);
    expect(decide(run(73, 32), run(90, 33)).adopt).toBe(false); // recall up, precision down
    expect(decide(run(73, 32), run(50, 31)).adopt).toBe(false); // precision up, recall down
    // 0.4375 vs 0.4384: equal when rounded to 3 places, lower as a fraction.
    expect(decide(run(73, 32), run(80, 35)).adopt).toBe(false);
  });

  it("does not use a run that finished after the scheduled cut-off", () => {
    expect(decide(run(73, 32), run(60, 40, at(20))).adopt).toBe(false);
    expect(decide(run(73, 32), run(60, 40, at(-20))).adopt).toBe(true);
  });

  it("takes the median latency over calls that reached the model only", () => {
    const line = (o: string, ms: number) => JSON.stringify({ action: "model_call", outcome: o, latency_ms: ms });
    expect(medianLatency([line("ok;cache=miss;model=m", 10), line("ok;cache=hit;model=m", 0), line("invalid;cache=miss;route=r", 30), line("ok;cache=miss;route=r", 20)])).toEqual({ median_ms: 20, calls: 3 });
    expect(medianLatency(null)).toBeNull();
  });
});
