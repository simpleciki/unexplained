// npm run extraction:compare -- --a <run dir> --b <run dir> [--a-trace <file>] [--b-trace <file>]
// No model call. Scores both runs against eval/gold/gold_cards.jsonl in one command and prints the adoption decision
// by the rule pre-registered in docs/extraction-run-2.md. A run folder needs cards.json and ingest-report.json; its
// trace comes from --x-trace, else from run.json (written by `npm run ingest -- --out ...`).
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { decide, scoreRun } from "../src/eval/extraction-compare.ts";
import { loadGoldCards } from "../src/eval/sample-score.ts";

const root = join(import.meta.dirname, "..");
const argv = process.argv.slice(2);
const opt = (n: string) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
const json = (f: string) => JSON.parse(readFileSync(f, "utf8"));

function load(side: "a" | "b") {
  const dir = opt(`--${side}`);
  if (!dir) throw new Error(`--${side} <run dir> is required`);
  const abs = resolve(root, dir);
  for (const f of ["cards.json", "ingest-report.json"]) if (!existsSync(join(abs, f))) throw new Error(`${dir}/${f} not found`);
  const run = existsSync(join(abs, "run.json")) ? json(join(abs, "run.json")) : null;
  const tracePath: string | undefined = opt(`--${side}-trace`) ?? run?.trace;
  const traceFile = tracePath ? resolve(root, tracePath) : null;
  const traceLines = traceFile && existsSync(traceFile) ? readFileSync(traceFile, "utf8").split("\n").filter(Boolean) : null;
  return { label: dir, cards: json(join(abs, "cards.json")), report: json(join(abs, "ingest-report.json")), traceLines, finished: run?.finished ?? null, traceName: traceLines ? tracePath! : null };
}

const A = load("a");
const B = load("b");
const gold = loadGoldCards(root);
const [a, b] = [scoreRun(A, gold), scoreRun(B, gold)];
const latency = (s: typeof a) =>
  !s.latency ? "n/a (no trace given)" : s.latency.median_ms === null ? "n/a (no cache-miss calls in the trace)" : `${(s.latency.median_ms / 1000).toFixed(1)} s over ${s.latency.calls} calls`;
const row = (s: typeof a, trace: string | null) =>
  [
    `  ${s.label}`,
    `    cards ${s.cards} · matched ${s.matched}/${s.gold_cards} gold · precision ${s.precision} · recall ${s.recall}`,
    `    records answered in prose ${s.records_prose} · records failed upstream ${s.records_failed_upstream} · complete ${s.complete}`,
    `    median latency per model call ${latency(s)}${trace ? ` (${trace})` : ""}`,
    ...(s.finished ? [`    finished ${s.finished}`] : []),
  ].join("\n");
console.log(`extraction against eval/gold/gold_cards.jsonl (${gold.length} cards), scored by src/eval/extraction-score.ts, no model call\n`);
console.log(`A\n${row(a, A.traceName)}\nB\n${row(b, B.traceName)}\n`);
// Extraction run 3 (docs/extraction-run-3.md): the second pass's own counts, and how many of its new cards sit on
// records that hold no decision (eval/gold/no_decision_records.json).
const sp = (B.report as { second_pass?: { records_read: number; cards_proposed: number; cards_kept: number; cards_gate_rejected: number; cards_dropped_by_skeptic: number; records_prose_reply: string[]; records_failed_upstream: unknown[] } }).second_pass;
if (sp) {
  const aIds = new Set((A.cards as { card_id: string }[]).map((c) => c.card_id));
  const fresh = (B.cards as { card_id: string; record_id: string }[]).filter((c) => !aIds.has(c.card_id));
  const noDecision = new Set<string>(json(join(root, "eval/gold/no_decision_records.json")).record_ids);
  const onNoDecision = fresh.filter((c) => noDecision.has(c.record_id));
  console.log(`second pass (B): records read ${sp.records_read} · cards proposed ${sp.cards_proposed} · rejected by the quote gate ${sp.cards_gate_rejected} · dropped by the Skeptic ${sp.cards_dropped_by_skeptic} · kept ${sp.cards_kept}`);
  console.log(`  answered in prose ${sp.records_prose_reply.length} · failed upstream ${sp.records_failed_upstream.length} · new cards on records that hold no decision (eval/gold/no_decision_records.json) ${onNoDecision.length}${onNoDecision.length ? ` (${onNoDecision.map((c) => c.card_id).join(", ")})` : ""}\n`);
}
const d = decide(a, b);
// Runs 2 and 3 pre-registered the same rule; the line names the run's own document.
console.log(`decision (${sp ? "docs/extraction-run-3.md" : "docs/extraction-run-2.md"}): ${d.adopt ? "ADOPT B" : "KEEP A"} — ${d.why}`);
