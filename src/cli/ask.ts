// npm run ask -- --question "..." [--as-of ISO] --max-calls N [--dry-run]
// SAMPLE_MODE=true npm run ask -- --sample <question id>   (no runtime, no token: recorded replies only)
import { buildEngine } from "../engine/engine.ts";
import { agentContext } from "../agents/shared.ts";
import { estimateQuestions, printEstimate } from "../eval/estimate.ts";
import { loadSamples } from "../eval/samples.ts";
import { runAsk } from "../pipeline/ask.ts";
import { loadIngested, runIngest } from "../pipeline/ingest.ts";
import { makeRuntime, routeLines, writeTrace } from "../pipeline/runtime.ts";
import { loadData, traceZetaris } from "../adapters/zetaris.ts";
import type { QueryEvent } from "../zetaris/client.ts";
import { main, parseArgs, requireMaxCalls, root } from "./args.ts";

main(async () => {
  const args = parseArgs(process.argv.slice(2));
  const sampleMode = process.env.SAMPLE_MODE === "true";
  let input = { question_id: "adhoc", question: args.question ?? "", as_of: args.asOf ?? null };

  if (sampleMode) {
    const s = loadSamples(root).find((q) => q.question_id === args.sample);
    if (!s) throw new Error("needs model credentials: SAMPLE_MODE answers only the judge sample questions (--sample <id>)");
    input = { question_id: s.question_id, question: s.question, as_of: s.as_of };
    const rt = await makeRuntime(root, { maxCalls: 0, sampleMode: true });
    // Deterministic parts run for real; every model reply comes from cache/samples/.
    await runIngest(root, rt);
    const { cards, edges } = loadIngested(root);
    const engine = buildEngine(root, cards, edges);
    const r = await runAsk(engine, agentContext(root, engine.data, engine.vocab), rt, input);
    console.log(JSON.stringify({ ...r, answer: { ...r.answer, checked: undefined } }, null, 2));
    console.log(`\n${r.prose}`);
    return;
  }

  if (!input.question) throw new Error('--question "..." is required');
  const maxCalls = requireMaxCalls(args);
  printEstimate(estimateQuestions(root, [{ ...input, pattern: "?", seats: [], expected_current_card: null, expected_in_effect_card: null, expected_reasons: [], expected_flags: [] }], "ask"), maxCalls);
  if (args.dryRun) return;
  const { cards, edges } = loadIngested(root);
  const zEvents: QueryEvent[] = [];
  const engine = buildEngine(root, cards, edges, undefined, await loadData(root, args.source, (e) => zEvents.push(e)));
  await traceZetaris(root, "ask", zEvents);
  const rt = await makeRuntime(root, { maxCalls, sampleMode: false });
  console.log(`routes:\n  ${routeLines(rt).join("\n  ")}`);
  const r = await runAsk(engine, agentContext(root, engine.data, engine.vocab), rt, input);
  if (rt.client.sticky.size) console.log(`routes after fallback:\n  ${routeLines(rt).join("\n  ")}`);
  const trace = await writeTrace(root, "ask", rt.events);
  console.log(JSON.stringify({ ...r, answer: { ...r.answer, checked: undefined } }, null, 2));
  console.log(`\n${r.prose}\n\ncalls used ${rt.client.budget.used}/${maxCalls}; trace ${trace}`);
});
