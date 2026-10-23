// npm run eval:live -- --subset dev|full --max-calls N [--dry-run]
import { estimateQuestions, printEstimate } from "../eval/estimate.ts";
import { printSideBySide, runLive, subsetQuestions } from "../eval/live.ts";
import { makeRuntime, routeLines, writeTrace } from "../pipeline/runtime.ts";
import { loadData, traceZetaris } from "../adapters/zetaris.ts";
import type { QueryEvent } from "../zetaris/client.ts";
import { main, parseArgs, requireMaxCalls, root } from "./args.ts";

main(async () => {
  const args = parseArgs(process.argv.slice(2));
  const subset = args.subset ?? (() => { throw new Error("--subset dev|full is required"); })();
  const maxCalls = requireMaxCalls(args);
  printEstimate(estimateQuestions(root, subsetQuestions(root, subset), `eval:live --subset ${subset}`), maxCalls);
  if (args.dryRun) return;
  const zEvents: QueryEvent[] = [];
  const data = await loadData(root, args.source, (e) => zEvents.push(e)); // Zetaris unreachable = loud error, no fallback
  const zTrace = await traceZetaris(root, "eval-live", zEvents);
  if (zTrace) console.log(`data read through Zetaris (${zEvents.filter((e) => e.action === "query").length} tables and views); trace ${zTrace}`);
  const rt = await makeRuntime(root, { maxCalls, sampleMode: false });
  console.log(`routes:\n  ${routeLines(rt).join("\n  ")}`);
  const out = await runLive(root, rt, subset, data);
  if (rt.client.sticky.size) console.log(`routes after fallback:\n  ${routeLines(rt).join("\n  ")}`);
  const trace = await writeTrace(root, `eval-live-${subset}`, rt.events);
  printSideBySide(root, out);
  console.log(`\nfailing: ${out.failing.length}`);
  for (const f of out.failing) console.log(`- ${f.question_id} ${f.why}`);
  console.log(`\ncalls used ${rt.client.budget.used}/${maxCalls}; wrote eval/results/live-${subset}.json; trace ${trace}`);
});
