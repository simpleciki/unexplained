// npm run activity:log -- --question <id>[,<id>…] [--run <trace file>]
// npm run activity:log -- --record <rec-id> --run <ingest trace file>
// npm run activity:log -- --copy-trace <trace file>
// Writes evidence/agent-activity/<id>.md from a trace already in logs/ and the replies in cache/, with no model call
// (src/activity/replay.ts). Each step is joined to its trace line (input_ref) and its cache file; every number shown
// comes from the trace line, every reply from the cache file. See src/activity/walkthrough.ts.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { type Variant, bestReplay, replyFor } from "../src/activity/replay.ts";
import { type ReplayCall, type Step, joinSteps, parseTrace, redact, renderStep } from "../src/activity/walkthrough.ts";
import { runCompare } from "../src/eval/compare.ts";
import { subsetQuestions } from "../src/eval/live.ts";
import type { GoldQuestion } from "../src/eval/scoring.ts";
import { runIngest } from "../src/pipeline/ingest.ts";

const root = process.cwd();
const OUT = join(root, "evidence/agent-activity");
const DEFAULT_RUN = "logs/trace-eval-compare-full-2026-10-24T21-44-49-432Z.jsonl";

function header(title: string, traceFile: string, lines: number, steps: Step[], unmatched: ReplayCall[], v: Variant) {
  const calls = steps.flatMap((s) => s.lines).filter((l) => l.action === "model_call");
  const latency = calls.reduce((s, l) => s + l.latency_ms, 0);
  return [
    `# ${title}`,
    "",
    `Trace: \`evidence/agent-activity/traces/${basename(traceFile)}\` (${lines} lines; copied from \`logs/\` with the scan in README.md). Every row below is a trace line as the run wrote it; every reply is the file in \`cache/\` that step used. Built by \`npm run activity:log\` with no model call.`,
    "",
    `Steps: ${steps.length} · trace lines: ${calls.length} · replies: ${calls.filter((l) => l.status === "ok").length} (${calls.filter((l) => l.status === "ok" && l.fields.cache === "hit").length} from the cache) · marked unusable: ${calls.filter((l) => l.status === "invalid").length} · upstream errors: ${calls.filter((l) => l.status === "error").length} · model latency summed: ${(latency / 1000).toFixed(1)} s · Data read in ${v.order === "zetaris" ? "Zetaris order (the run used --source zetaris)" : "data/ file order"}; strong agents asked for ${v.deep ? "meterless/deep" : "meterless/auto (deep was not listed that day)"}.`,
    unmatched.length ? `Not found in this trace: ${unmatched.length} rebuilt prompt(s) (${[...new Set(unmatched.map((u) => u.agent))].join(", ")}): the code that rebuilt them is not the code that ran, or the run never reached them; they are left out, not guessed.` : "Every rebuilt prompt was found in the trace.",
    "",
    "The trace `timestamp` is when the run wrote its trace (all lines at the end of the run), not when each call happened; `latency ms` is the measured time of that call. `requested mode` is what the client asked the route for; `model that answered` is what the route reported back.",
    "",
  ];
}

const resultsFile = join(root, "eval/results/compare-full.json");

function outcomeLines(qid: string): string[] {
  if (!existsSync(resultsFile)) return [];
  const r = JSON.parse(readFileSync(resultsFile, "utf8")) as { groups: Record<string, { results: Array<Record<string, unknown>> }> };
  const out = ["## How the run scored it (`eval/results/compare-full.json`, written by the same run)", ""];
  for (const [g, grp] of Object.entries(r.groups)) {
    const x = grp.results.find((q) => q.question_id === qid);
    if (!x) continue;
    out.push(`- Group ${g.toUpperCase()}: **${x.outcome}** — ${x.why}${x.records_given !== undefined ? ` (${x.records_given} records given${x.human_cards_cited !== undefined ? `, ${x.human_cards_cited} human cards cited` : ""})` : ""}`);
  }
  return [...out, ""];
}

async function questionPages(ids: string[], traceFile: string) {
  const trace = parseTrace(readFileSync(join(root, traceFile), "utf8"));
  const refs = new Set(trace.map((t) => t.input_ref));
  const all = subsetQuestions(root, "full");
  const report: string[] = [];
  for (const id of ids) {
    const q = all.find((x) => x.question_id === id);
    if (!q) throw new Error(`question ${id} is not in the full subset`);
    const best = await bestReplay(root, (rt, tmp, data) => runCompare(tmp, rt, [q as GoldQuestion], ["a", "c"], data), refs);
    const { steps, unmatched } = joinSteps(trace, best.calls);
    const body: string[] = [
      ...header(`Agent activity: ${id}`, traceFile, trace.length, steps, unmatched, best.variant),
      `**Question:** ${q.question}  `,
      `**As of:** ${q.as_of ?? "now"} · **Seats:** ${q.seats.join(", ")}`,
      "",
      ...outcomeLines(id),
    ];
    for (const [g, label] of [["compare", "Group A: one model call reading the records"], ["answer", "Group C: the engine (Router → Skeptic → Judge → Explainer)"]] as const) {
      const part = steps.filter((s) => s.call.stage === g);
      if (!part.length) continue;
      body.push(`## ${label}`, "");
      part.forEach((s) => body.push(renderStep(steps.indexOf(s) + 1, s, replyFor(root, s.call))));
    }
    report.push(write(`${id}.md`, body.join("\n")));
  }
  return report;
}

async function recordPage(recordId: string, traceFile: string) {
  const trace = parseTrace(readFileSync(join(root, traceFile), "utf8"));
  const refs = new Set(trace.map((t) => t.input_ref));
  const best = await bestReplay(root, (rt, tmp, data) => runIngest(tmp, rt, data, undefined, "activity-replay"), refs);
  // This record's calls: its extraction, the check of its cards, and every Keeper comparison that names it.
  const mine = best.calls.filter((c) => c.user.includes(recordId));
  const { steps, unmatched } = joinSteps(trace, mine);
  const rec = readFileSync(join(root, "data/records/records.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>).find((r) => r.record_id === recordId);
  const cards = (JSON.parse(readFileSync(join(root, "state/cards.json"), "utf8")) as Array<Record<string, unknown>>).filter((c) => c.record_id === recordId);
  const body = [
    ...header(`Agent activity: ingest of ${recordId}`, traceFile, trace.length, steps, unmatched, best.variant),
    "## The record",
    "",
    "```json",
    JSON.stringify(rec, null, 2),
    "```",
    "",
    ...steps.map((s, i) => renderStep(i + 1, s, replyFor(root, s.call))),
    `## What the ingest kept (\`state/cards.json\`, written by this ingest)`,
    "",
    cards.length ? "```json\n" + JSON.stringify(cards, null, 2) + "\n```" : "No card kept for this record.",
    "",
  ];
  return [write(`ingest-${recordId}.md`, body.join("\n"))];
}

function write(name: string, text: string): string {
  mkdirSync(OUT, { recursive: true });
  const f = join(OUT, name);
  writeFileSync(f, text.endsWith("\n") ? text : text + "\n");
  return `${relative(root, f)} (${Buffer.byteLength(readFileSync(f))} bytes)`;
}

function copyTrace(traceFile: string) {
  const { text, findings } = redact(readFileSync(join(root, traceFile), "utf8"));
  mkdirSync(join(OUT, "traces"), { recursive: true });
  writeFileSync(join(OUT, "traces", basename(traceFile)), text);
  const byKind = Object.entries(findings.reduce<Record<string, number>>((m, f) => ((m[f.kind] = (m[f.kind] ?? 0) + 1), m), {}));
  return [`${traceFile}: ${findings.length ? `redacted ${byKind.map(([k, n]) => `${n} × ${k}`).join(", ")} (lines ${[...new Set(findings.map((f) => f.line))].join(", ")})` : "scan found no account id, key, token, local path or NVIDIA error text"}`];
}

const argv = process.argv.slice(2);
const opt = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const question = opt("--question");
const record = opt("--record");
const copy = opt("--copy-trace");
const run = opt("--run");
let lines: string[];
if (copy) lines = copyTrace(copy);
else if (question) lines = await questionPages(question.split(","), run ?? DEFAULT_RUN);
else if (record) {
  if (!run) throw new Error("--record needs --run <ingest trace file>");
  lines = await recordPage(record, run);
} else throw new Error("usage: --question <id>[,<id>] [--run <trace>] | --record <rec-id> --run <trace> | --copy-trace <trace>");
console.log(lines.join("\n"));
