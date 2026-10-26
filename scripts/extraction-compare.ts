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
const d = decide(a, b);
console.log(`decision (docs/extraction-run-2.md): ${d.adopt ? "ADOPT B" : "KEEP A"} — ${d.why}`);
