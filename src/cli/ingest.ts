// npm run ingest -- --max-calls N [--dry-run]
// Sample: npm run ingest -- --records <id,id,...> --out state/sample-007 --max-calls N [--dry-run]
//   Researcher + Skeptic over those records only (no Keeper); writes cards and the report to --out, never to
//   state/cards.json; prints extraction precision/recall against gold restricted to those records, next to
//   the current state/cards.json restricted the same way.
import { estimateIngest, printEstimate } from "../eval/estimate.ts";
import { probeCacheMisses } from "../eval/cache-probe.ts";
import { type IngestSample, runIngest, sampleOutDir } from "../pipeline/ingest.ts";
import { loadCurrentCards, loadGoldCards, printSampleScore, sampleScore } from "../eval/sample-score.ts";
import type { DecisionCard } from "../engine/types.ts";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { loadData, traceZetaris } from "../adapters/zetaris.ts";
import type { QueryEvent } from "../zetaris/client.ts";
import { makeRuntime, routeLines, writeTrace } from "../pipeline/runtime.ts";
import { main, parseArgs, requireMaxCalls, root } from "./args.ts";

main(async () => {
  const args = parseArgs(process.argv.slice(2));
  const maxCalls = requireMaxCalls(args);
  if (!args.records !== !args.out) throw new Error("--records and --out go together (sample mode)");
  const sample: IngestSample | undefined = args.records && args.out ? { records: args.records, out: args.out } : undefined;
  if (sample) sampleOutDir(root, sample.out); // refuse state/ before anything runs
  printEstimate(estimateIngest(root, sample?.records), maxCalls);
  if (args.dryRun) {
    // No model call: the real ingest code runs on a copy of data/ and cache/ with a stand-in provider.
    const p = await probeCacheMisses(root, sample);
    console.log(`\ncache probe (${p.cached} cached replies):`);
    for (const [agent, c] of Object.entries(p.byAgent)) console.log(`  ${agent.padEnd(20)} hit ${String(c.hit).padStart(4)}  miss ${String(c.miss).padStart(4)}`);
    console.log(`  would call the model ${p.misses} times if every reply were valid JSON (Researcher misses are exact; Skeptic/Keeper are a lower bound)`);
    return;
  }
  const zEvents: QueryEvent[] = [];
  const data = await loadData(root, args.source, (e) => zEvents.push(e)); // Zetaris unreachable = loud error, no fallback
  const zTrace = await traceZetaris(root, "ingest", zEvents);
  if (zTrace) console.log(`data read through Zetaris (${zEvents.filter((e) => e.action === "query").length} tables and views); trace ${zTrace}`);
  const rt = await makeRuntime(root, { maxCalls, sampleMode: false });
  console.log(`routes:\n  ${routeLines(rt).join("\n  ")}`);
  const report = await runIngest(root, rt, data, sample);
  if (rt.client.sticky.size) console.log(`routes after fallback:\n  ${routeLines(rt).join("\n  ")}`);
  const trace = await writeTrace(root, "ingest", rt.events);
  console.log(JSON.stringify({ ...report, records_rejected: report.records_rejected.length, records_prose_reply: report.records_prose_reply.length, pairs_prose_reply: report.pairs_prose_reply.length, cards_gate_rejected: report.cards_gate_rejected.length, cards_dropped_by_skeptic: report.cards_dropped_by_skeptic.length, ledger: undefined, records_failed_upstream: report.records_failed_upstream.map((r) => r.record_id), pairs_failed_upstream: report.pairs_failed_upstream.length }, null, 2));
  if (report.ledger) console.log(report.ledger.line);
  if (sample) {
    const out = sampleOutDir(root, sample.out);
    console.log(`calls used ${rt.client.budget.used}/${maxCalls}; wrote ${relative(root, out)}/cards.json, review-queue.json and ingest-report.json (state/cards.json untouched); trace ${trace}`);
    const cards = JSON.parse(readFileSync(join(out, "cards.json"), "utf8")) as DecisionCard[];
    printSampleScore(sampleScore(sample.records, cards, loadCurrentCards(root), loadGoldCards(root)));
  } else console.log(`calls used ${rt.client.budget.used}/${maxCalls}; wrote state/cards.json, state/edges.json, state/review-queue.json, state/ingest-report.json, state/seats.json, state/hmem-snapshot.json; trace ${trace}`);
  if (!report.complete) console.log(`stopped early (${report.stopped_reason}); rerun with a larger --max-calls: finished records come from the cache.`);
});
