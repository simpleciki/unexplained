// npm run eval:mode-disputes
// "Right quote, different mode" cards in the current state/cards.json: an unmatched model card and an
// unmatched gold card from the same record, quote overlap >= the match threshold, different mode. Printed
// with the record text so a person can judge which mode is right. Read-only: gold is never edited here;
// an entry goes into SUSPECTED_GOLD_ERRORS (src/eval/suspected-gold.ts) only after Ciki rules on it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadDataset } from "../src/engine/data.ts";
import { modeDisputes } from "../src/eval/extraction-score.ts";
import { loadCurrentCards, loadGoldCards } from "../src/eval/sample-score.ts";

const root = join(import.meta.dirname, "..");
const cards = loadCurrentCards(root);
if (!cards) {
  console.log("no state/cards.json: run an ingest first");
  process.exit(0);
}
const records = new Map(loadDataset(root).records.map((r) => [r.record_id, r]));
const disputes = modeDisputes(cards, loadGoldCards(root)).sort((a, b) => a.model.record_id.localeCompare(b.model.record_id));
console.log(`${disputes.length} cards with the right quote and a different mode (state/cards.json: ${cards.length} cards)\n`);
disputes.forEach((d, i) => {
  const rec = records.get(d.model.record_id);
  console.log(`${i + 1}. ${d.model.record_id} (${rec?.source_type}, ${rec?.author}) overlap ${d.overlap.toFixed(2)}`);
  console.log(`   model ${d.model.card_id}: ${d.model.mode}  "${d.model.quote}"`);
  console.log(`   gold  ${d.gold.card_id}: ${d.gold.mode}  "${d.gold.quote}"`);
  console.log(`   record: ${rec?.text.replace(/\s+/g, " ")}\n`);
});
