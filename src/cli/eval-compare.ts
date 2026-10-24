// npm run eval:compare -- --subset dev|full --max-calls N [--group a,c] [--dry-run] [--source files|zetaris]
// Group A (one model call reading the records) vs group C (the engine with human judgments), scored by the
// rules pre-registered in docs/eval-protocol-011.md. Writes eval/results/compare-<subset>.json.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadData, traceZetaris } from "../adapters/zetaris.ts";
import { probeCompare } from "../eval/compare-probe.ts";
import { GROUPS, OUTCOMES, runCompare } from "../eval/compare.ts";
import { estimateQuestions, printEstimate } from "../eval/estimate.ts";
import { subsetQuestions } from "../eval/live.ts";
import { makeRuntime, providerLine, routeFromEnv, routeLines, writeTrace } from "../pipeline/runtime.ts";
import type { QueryEvent } from "../zetaris/client.ts";
import { main, parseArgs, requireMaxCalls, root } from "./args.ts";

main(async () => {
  const args = parseArgs(process.argv.slice(2));
  const subset = args.subset ?? (() => { throw new Error("--subset dev|full is required"); })();
  const maxCalls = requireMaxCalls(args);
  const groups = args.groups ?? ["a", "c"];
  for (const g of groups) if (!GROUPS[g]) throw new Error(`group ${g} is not built yet (built: ${Object.keys(GROUPS).join(", ")})`);
  const questions = subsetQuestions(root, subset);
  console.log(providerLine(routeFromEnv()));

  // Estimates: A is one call per question (+2 retries); C is the answer path of eval:live.
  const n = questions.length;
  if (groups.includes("a")) printEstimate({ name: `group A, ${subset}`, stages: [{ stage: "compare", agent: "GroupA", base: n, worst: n * 3, basis: `${n} questions, one call each (+2 retries)` }], base: n, worst: n * 3, notes: [] }, null);
  if (groups.includes("c")) printEstimate(estimateQuestions(root, questions, `group C, ${subset}`), null);
  if (args.dryRun) {
    const p = await probeCompare(root, questions, groups);
    console.log(`\ncache probe (${p.cached} cached replies):`);
    for (const [agent, c] of Object.entries(p.byAgent)) console.log(`  ${agent.padEnd(20)} hit ${String(c.hit).padStart(4)}  miss ${String(c.miss).padStart(4)}`);
    console.log(`  would call the model ${p.misses} times if every reply were valid JSON (A's misses are exact; C's later steps are a lower bound)`);
    console.log(`--max-calls ${maxCalls}: the run stops there and keeps what it has.`);
    return;
  }

  const zEvents: QueryEvent[] = [];
  const data = await loadData(root, args.source, (e) => zEvents.push(e)); // Zetaris unreachable = loud error, no fallback
  await traceZetaris(root, `eval-compare-${subset}`, zEvents);
  const rt = await makeRuntime(root, { maxCalls, sampleMode: false });
  console.log(`routes:\n  ${routeLines(rt).join("\n  ")}`);
  const out = await runCompare(root, rt, questions, groups, data);
  const trace = await writeTrace(root, `eval-compare-${subset}`, rt.events);
  mkdirSync(join(root, "eval/results"), { recursive: true });
  writeFileSync(join(root, `eval/results/compare-${subset}.json`), JSON.stringify({ subset, protocol: ["docs/eval-protocol-011.md", "docs/eval-protocol-011-amendment-1.md"], ...out }, null, 2) + "\n");

  console.log(`\n${"group".padEnd(6)}${OUTCOMES.map((o) => o.padStart(19)).join("")}${"passed while abstaining".padStart(25)}${"calls".padStart(7)}`);
  for (const [g, r] of Object.entries(out.groups)) {
    console.log(`${g.toUpperCase().padEnd(6)}${OUTCOMES.map((o) => `${r.counts[o]}/${n}`.padStart(19)).join("")}${String(r.passed_while_abstaining).padStart(25)}${String(r.calls).padStart(7)}${r.stopped ? `  stopped: ${r.stopped}` : ""}`);
  }
  console.log(`\nquestion${" ".repeat(18)}${groups.map((g) => g.toUpperCase().padEnd(20)).join("")}why`);
  for (const q of questions) {
    const rows = groups.map((g) => out.groups[g]?.results.find((r) => r.question_id === q.question_id));
    const why = rows.map((r, i) => (r ? `${groups[i].toUpperCase()}: ${r.why}` : "")).filter(Boolean).join(" | ");
    const c = out.groups.c?.results.find((r) => r.question_id === q.question_id);
    const extra = rows.map((r) => (r ? `${r.records_given} rec` : "")).join("/") + (c ? `, ${c.human_cards_cited ?? 0} human cards` : "");
    console.log(`${q.question_id.padEnd(26)}${rows.map((r) => (r ? r.outcome + (r.abstained && r.outcome === "correct" ? "*" : "") : "not run").padEnd(20)).join("")}${why.slice(0, 220)} (${extra})`);
  }
  console.log("(* = passed while abstaining)");
  for (const [g, r] of Object.entries(out.groups)) {
    console.log(`\n${g.toUpperCase()} answering models: ${Object.entries(r.models).map(([m, k]) => `${m} ${k}`).join(", ") || "none"}; answered by a model we did not request: ${r.unrequested_model_calls ?? "n/a"}`);
  }
  if (rt.client.sticky.size) console.log(`routes after fallback:\n  ${routeLines(rt).join("\n  ")}`);
  console.log(`\ncalls used ${rt.client.budget.used}/${maxCalls}; wrote eval/results/compare-${subset}.json; trace ${trace}`);
});
