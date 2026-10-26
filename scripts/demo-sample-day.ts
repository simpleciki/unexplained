// npm run demo:sample-day
// Reproduces the sample day on the check page (src/ui/sample-day.ts): Today's outbox, every confirmation a person
// can make there, on a temp copy of review/judgments.jsonl. No model calls; the real review/ and .demo/ are not touched.
import { join } from "node:path";
import { loadData } from "../src/adapters/zetaris.ts";
import { ingestSource } from "../src/pipeline/ingest-source.ts";
import { NOT_CONFIRMED, REVIEWER, runSampleDay } from "../src/ui/sample-day.ts";
import { SAMPLE_SEED } from "../src/ui/sample.ts";

const root = join(import.meta.dirname, "..");
console.log(ingestSource(root).line);
const r = runSampleDay(root, await loadData(root, "files"));
const label = { warnings: "fix before sending", not_cleared: "left to confirm", clear: "ready to send" } as const;
const show = (x: { state: keyof typeof label; left: number }) => `${label[x.state]}${x.state === "not_cleared" ? ` (${x.left})` : ""}`;
console.log(`Today's outbox, seed ${SAMPLE_SEED}: ${r.ids.length} documents. Confirmations by "${REVIEWER}" on a temp copy; not confirmed: open questions, ${Object.keys(NOT_CONFIRMED).join(", ")}.\n`);
console.log(`${"document".padEnd(12)} ${"before".padEnd(22)} ${"after".padEnd(22)} clicks  confirmed`);
for (const [i, id] of r.ids.entries()) {
  const st = r.steps[i];
  console.log(`${id.padEnd(12)} ${show(r.before[i]).padEnd(22)} ${show(r.after[i]).padEnd(22)} ${String(st.clicks).padStart(6)}  ${st.confirmed.join(", ") || "—"}`);
  for (const l of st.left_open) console.log(`${"".padEnd(12)}   left: ${l.item} — ${l.why}`);
}
const t = r.totals;
console.log(`\nbefore: ${t.before.warnings} fix before sending · ${t.before.not_cleared} left to confirm · ${t.before.clear} ready to send`);
console.log(`after:  ${t.after.warnings} fix before sending · ${t.after.not_cleared} left to confirm (${t.after.items_left} items) · ${t.after.clear} ready to send`);
console.log(`${r.judgments_written} judgments written to the temp copy, which is now deleted; review/judgments.jsonl and .demo/ untouched.`);
