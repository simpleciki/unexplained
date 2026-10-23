// npm run record:samples -- --max-calls N [--dry-run]
// Live run of ingest + the three judge sample questions. Every reply it uses (cached or new) is copied
// into cache/samples/, so SAMPLE_MODE can replay them with no runtime and no token.
import { buildEngine } from "../engine/engine.ts";
import { agentContext } from "../agents/shared.ts";
import { estimateIngest, estimateQuestions, printEstimate } from "../eval/estimate.ts";
import { loadSamples } from "../eval/samples.ts";
import { runAsk } from "../pipeline/ask.ts";
import { loadIngested, runIngest } from "../pipeline/ingest.ts";
import { makeRuntime, routeLines, writeTrace } from "../pipeline/runtime.ts";
import { main, parseArgs, requireMaxCalls, root } from "./args.ts";

main(async () => {
  const args = parseArgs(process.argv.slice(2));
  const maxCalls = requireMaxCalls(args);
  const samples = loadSamples(root);
  const ing = estimateIngest(root);
  const ask = estimateQuestions(root, samples, "3 sample questions");
  printEstimate(
    { ...ask, name: "record:samples", stages: [...ing.stages, ...ask.stages], base: ing.base + ask.base, worst: ing.worst + ask.worst, notes: ["After a full ingest, the ingest part is all cache hits (0 new calls).", ...ing.notes] },
    maxCalls,
  );
  if (args.dryRun) return;
  const rt = await makeRuntime(root, { maxCalls, sampleMode: false, teeSamples: true });
  console.log(`routes:\n  ${routeLines(rt).join("\n  ")}`);
  const report = await runIngest(root, rt);
  if (!report.complete) throw new Error(`ingest stopped early (${report.stopped_reason}); samples not recorded`);
  const { cards, edges } = loadIngested(root);
  const engine = buildEngine(root, cards, edges);
  const ctx = agentContext(root, engine.data, engine.vocab);
  for (const s of samples) {
    const r = await runAsk(engine, ctx, rt, { question_id: s.question_id, question: s.question, as_of: s.as_of });
    console.log(`${s.question_id}: ${r.prose}`);
  }
  if (rt.client.sticky.size) console.log(`routes after fallback:\n  ${routeLines(rt).join("\n  ")}`);
  const trace = await writeTrace(root, "record-samples", rt.events);
  console.log(`calls used ${rt.client.budget.used}/${maxCalls}; replies copied to cache/samples/; trace ${trace}`);
});
