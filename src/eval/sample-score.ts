// Extraction score for an ingest sample (--records): the sample's cards and the current state/cards.json,
// each restricted to the sample's records, scored against gold restricted to the same records.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseJsonl } from "../engine/data.ts";
import type { DecisionCard } from "../engine/types.ts";
import { matchCards } from "./extraction-score.ts";

const MODES = ["decides", "gives_reason", "proposes", "mentions"] as const;

export const loadGoldCards = (root: string) => parseJsonl<DecisionCard>(readFileSync(join(root, "eval/gold/gold_cards.jsonl"), "utf8"));

export function loadCurrentCards(root: string): DecisionCard[] | null {
  const f = join(root, "state", "cards.json");
  return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as DecisionCard[]) : null;
}

const restrict = (cards: DecisionCard[], ids: string[]) => cards.filter((c) => ids.includes(c.record_id));
const r3 = (x: number) => Math.round(x * 1000) / 1000;

function row(model: DecisionCard[], gold: DecisionCard[]) {
  const m = matchCards(model, gold);
  const matchedGold = gold.filter((g) => m.has(g.card_id));
  return {
    cards: model.length,
    matched: m.size,
    precision: model.length ? r3(m.size / model.length) : null,
    recall: gold.length ? r3(m.size / gold.length) : null,
    by_mode: Object.fromEntries(MODES.map((mode) => [mode, { gold: gold.filter((g) => g.mode === mode).length, matched: matchedGold.filter((g) => g.mode === mode).length, cards: model.filter((c) => c.mode === mode).length }])),
    per_record: Object.fromEntries([...new Set([...gold, ...model].map((c) => c.record_id))].sort().map((id) => [id, { cards: model.filter((c) => c.record_id === id).length, gold: gold.filter((g) => g.record_id === id).length, matched: matchedGold.filter((g) => g.record_id === id).length }])),
  };
}

export type SampleScore = { records: string[]; gold_cards: number; sample: ReturnType<typeof row>; current: ReturnType<typeof row> | null };

export function sampleScore(ids: string[], sampleCards: DecisionCard[], currentCards: DecisionCard[] | null, gold: DecisionCard[]): SampleScore {
  const g = restrict(gold, ids);
  return { records: ids, gold_cards: g.length, sample: row(restrict(sampleCards, ids), g), current: currentCards ? row(restrict(currentCards, ids), g) : null };
}

export function printSampleScore(s: SampleScore) {
  const f = (x: number | null) => (x === null ? "-" : x.toFixed(3));
  const cur = s.current;
  console.log(`\nextraction on ${s.records.length} records (gold restricted to them: ${s.gold_cards} cards)`);
  console.log("                    this sample   current state/cards.json");
  console.log(`cards               ${String(s.sample.cards).padStart(11)}   ${cur ? cur.cards : "(none)"}`);
  console.log(`matched             ${String(s.sample.matched).padStart(11)}   ${cur ? cur.matched : "-"}`);
  console.log(`precision           ${f(s.sample.precision).padStart(11)}   ${cur ? f(cur.precision) : "-"}`);
  console.log(`recall              ${f(s.sample.recall).padStart(11)}   ${cur ? f(cur.recall) : "-"}`);
  console.log("matched by mode (matched/gold, cards made)");
  for (const mode of MODES) {
    const a = s.sample.by_mode[mode];
    const b = cur?.by_mode[mode];
    console.log(`  ${mode.padEnd(16)}  ${`${a.matched}/${a.gold}, ${a.cards}`.padStart(11)}   ${b ? `${b.matched}/${b.gold}, ${b.cards}` : "-"}`);
  }
  console.log("per record (matched/gold, cards made)");
  for (const [id, a] of Object.entries(s.sample.per_record)) {
    const b = cur?.per_record[id];
    console.log(`  ${id.padEnd(16)}  ${`${a.matched}/${a.gold}, ${a.cards}`.padStart(11)}   ${b ? `${b.matched}/${b.gold}, ${b.cards}` : "0/" + a.gold + ", 0"}`);
  }
}
