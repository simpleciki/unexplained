// npm run ingest -- --max-calls N [--dry-run]
// Second read (extraction run 3): AI_PROVIDER=nvidia-direct npm run ingest -- --second-pass-of snapshot/ingest-2026-10-23 --out state/run-3 --max-calls N
// Full run into its own folder: npm run ingest -- --out state/run-2 [--cache-dir DIR] --max-calls N
//   (with AI_PROVIDER=nvidia-direct NVIDIA_DISABLE_THINKING=1 the cache is cache-thinking-off/ unless --cache-dir says otherwise)
// Sample: npm run ingest -- --records <id,id,...> --out state/sample-007 --max-calls N [--dry-run]
//   Researcher + Skeptic over those records only (no Keeper); writes cards and the report to --out, never to
//   state/cards.json; prints extraction precision/recall against gold restricted to those records, next to
//   the current state/cards.json restricted the same way.
import { estimateIngest, printEstimate } from "../eval/estimate.ts";
import { probeCacheMisses } from "../eval/cache-probe.ts";
import { type IngestSample, runIngest, sampleOutDir } from "../pipeline/ingest.ts";
import { loadCurrentCards, loadGoldCards, printSampleScore, sampleScore } from "../eval/sample-score.ts";
import { noCardRecords, runSecondPass, SECOND_PASS, SECOND_PASS_CACHE } from "../pipeline/second-pass.ts";
import type { DecisionCard } from "../engine/types.ts";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { localIso } from "../review/judgments.ts";
import { loadData, traceZetaris } from "../adapters/zetaris.ts";
import type { QueryEvent } from "../zetaris/client.ts";
import { makeRuntime, routeLines, THINKING_OFF, THINKING_OFF_CACHE, thinkingOff, writeTrace } from "../pipeline/runtime.ts";
import { main, parseArgs, requireMaxCalls, root } from "./args.ts";

main(async () => {
  const args = parseArgs(process.argv.slice(2));
  const maxCalls = requireMaxCalls(args);
  if (args.secondPassOf) return secondPass(args, maxCalls);
  if (args.records && !args.out) throw new Error("--records needs --out (sample mode)");
  const sample: IngestSample | undefined = args.records && args.out ? { records: args.records, out: args.out } : undefined;
  // --out without --records: a full run (Keeper included) into its own folder; state/ is not written.
  const fullOut = !sample && args.out ? args.out : undefined;
  const outDir = args.out ? sampleOutDir(root, args.out) : undefined; // refuse state/ and snapshot/ before anything runs
  const off = thinkingOff();
  const cacheDir = args.cacheDir ?? (off ? THINKING_OFF_CACHE : "cache");
  if (off && resolve(root, cacheDir) === resolve(root, "cache")) throw new Error("a thinking-off run must not use cache/: pass its own --cache-dir");
  const cacheNamespace = off ? THINKING_OFF : undefined;
  if (off || args.cacheDir) console.log(`cache: ${cacheDir}/${cacheNamespace ? ` (key namespace "${cacheNamespace}": no reply cached with thinking on can match)` : ""}`);
  printEstimate(estimateIngest(root, sample?.records), maxCalls);
  if (args.dryRun) {
    // No model call: the real ingest code runs on a copy of data/ and the run's cache with a stand-in provider.
    const p = await probeCacheMisses(root, sample, { dir: cacheDir, namespace: cacheNamespace });
    console.log(`\ncache probe (${p.cached} cached replies in ${cacheDir}/):`);
    for (const [agent, c] of Object.entries(p.byAgent)) console.log(`  ${agent.padEnd(20)} hit ${String(c.hit).padStart(4)}  miss ${String(c.miss).padStart(4)}`);
    console.log(`  would call the model ${p.misses} times if every reply were valid JSON (Researcher misses are exact; Skeptic/Keeper are a lower bound)`);
    return;
  }
  const zEvents: QueryEvent[] = [];
  const data = await loadData(root, args.source, (e) => zEvents.push(e)); // Zetaris unreachable = loud error, no fallback
  const zTrace = await traceZetaris(root, "ingest", zEvents);
  if (zTrace) console.log(`data read through Zetaris (${zEvents.filter((e) => e.action === "query").length} tables and views); trace ${zTrace}`);
  const started = new Date();
  const rt = await makeRuntime(root, { maxCalls, sampleMode: false, cacheDir, cacheNamespace, deadModesFile: outDir ? join(outDir, "dead-modes.json") : undefined });
  console.log(`routes:\n  ${routeLines(rt).join("\n  ")}`);
  const report = await runIngest(root, rt, data, sample, fullOut);
  if (rt.client.sticky.size) console.log(`routes after fallback:\n  ${routeLines(rt).join("\n  ")}`);
  const trace = await writeTrace(root, "ingest", rt.events);
  // A run in its own folder says how it was made, and where its trace (per-call latency) is.
  if (outDir) writeFileSync(join(outDir, "run.json"), JSON.stringify({ started: localIso(started), finished: localIso(new Date()), route: rt.route, thinking: off ? "off" : "default", cache_dir: cacheDir, cache_namespace: cacheNamespace ?? null, max_calls: maxCalls, calls_used: rt.client.budget.used, trace, complete: report.complete, stopped_reason: report.stopped_reason ?? null }, null, 2) + "\n");
  console.log(JSON.stringify({ ...report, records_rejected: report.records_rejected.length, records_prose_reply: report.records_prose_reply.length, pairs_prose_reply: report.pairs_prose_reply.length, cards_gate_rejected: report.cards_gate_rejected.length, cards_dropped_by_skeptic: report.cards_dropped_by_skeptic.length, ledger: undefined, records_failed_upstream: report.records_failed_upstream.map((r) => r.record_id), pairs_failed_upstream: report.pairs_failed_upstream.length }, null, 2));
  if (report.ledger) console.log(report.ledger.line);
  if (sample) {
    const out = sampleOutDir(root, sample.out);
    console.log(`calls used ${rt.client.budget.used}/${maxCalls}; wrote ${relative(root, out)}/cards.json, review-queue.json and ingest-report.json (state/cards.json untouched); trace ${trace}`);
    const cards = JSON.parse(readFileSync(join(out, "cards.json"), "utf8")) as DecisionCard[];
    printSampleScore(sampleScore(sample.records, cards, loadCurrentCards(root), loadGoldCards(root)));
  } else if (fullOut) console.log(`calls used ${rt.client.budget.used}/${maxCalls}; wrote ${relative(root, outDir!)}/ (cards, edges, report, seats, H-MEM snapshot, run.json); state/ untouched; trace ${trace}`);
  else console.log(`calls used ${rt.client.budget.used}/${maxCalls}; wrote state/cards.json, state/edges.json, state/review-queue.json, state/ingest-report.json, state/seats.json, state/hmem-snapshot.json; trace ${trace}`);
  if (!report.complete) console.log(`stopped early (${report.stopped_reason}); rerun with a larger --max-calls: finished records come from the cache.`);
});

// Extraction run 3 (docs/extraction-run-3.md): only the records with no card in --second-pass-of, read again with the
// second-pass prompt; route nvidia-direct, thinking on, response_format json_object; own cache folder and namespace.
async function secondPass(args: ReturnType<typeof parseArgs>, maxCalls: number) {
  if (!args.out) throw new Error("--second-pass-of needs --out (its own folder, e.g. state/run-3)");
  if (args.records) throw new Error("--second-pass-of picks its own records; do not pass --records");
  if (process.env.AI_PROVIDER !== "nvidia-direct") throw new Error("the second pass runs on AI_PROVIDER=nvidia-direct (docs/extraction-run-3.md)");
  if (process.env.NVIDIA_DISABLE_THINKING === "1") throw new Error("the second pass runs with thinking on: unset NVIDIA_DISABLE_THINKING");
  const outDir = sampleOutDir(root, args.out);
  const firstDir = resolve(root, args.secondPassOf!);
  const cacheDir = args.cacheDir ?? SECOND_PASS_CACHE;
  const data = await loadData(root, args.source);
  const first = JSON.parse(readFileSync(join(firstDir, "ingest-report.json"), "utf8"));
  const targets = noCardRecords(data.records, JSON.parse(readFileSync(join(firstDir, "cards.json"), "utf8")), first);
  const reasons = Object.entries(targets.reduce<Record<string, number>>((a, t) => ({ ...a, [t.reason]: (a[t.reason] ?? 0) + 1 }), {}));
  console.log(`second pass of ${args.secondPassOf}: ${targets.length} records produced no card (${reasons.map(([k, n]) => `${k} ${n}`).join(", ")})`);
  console.log(`  ${targets.map((t) => t.record_id).join(" ")}`);
  console.log(`cache: ${cacheDir}/ (key namespace "${SECOND_PASS}"); route nvidia-direct, thinking on, response_format json_object; writes only ${relative(root, outDir)}/`);
  const n = targets.length;
  const goldOn = new Set(loadGoldCards(root).map((c) => c.record_id));
  const withGold = targets.filter((t) => goldOn.has(t.record_id)).length;
  printEstimate({
    name: `second pass (${n} records, no Keeper)`,
    stages: [
      // Per record: 1 read (+2 retries); worst adds 2 re-reads of 3 attempts each. Skeptic: up to 3 rounds of 3 attempts.
      { stage: "ingest", agent: "Researcher.second", base: n, worst: n * 3 + n * 2 * 3, basis: `${n} records with no first-pass card` },
      { stage: "ingest", agent: "Skeptic.cards", base: withGold, worst: n * 3 * 3, basis: `${withGold} of them carry cards in the gold layout` },
    ],
    base: n + withGold,
    worst: n * 9 + n * 9,
    notes: ["Every reply is fresh: the run's cache folder is its own.", "No GET /v1/models: the direct route offers its fixed model."],
  }, maxCalls);
  if (args.dryRun) {
    const cached = existsSync(resolve(root, cacheDir)) ? readdirSync(resolve(root, cacheDir)).filter((f) => f.endsWith(".json")).length : 0;
    console.log(`\n${cacheDir}/ holds ${cached} replies now; with an empty folder every call above reaches the model.`);
    return;
  }
  const started = new Date();
  const rt = await makeRuntime(root, { maxCalls, sampleMode: false, cacheDir, cacheNamespace: SECOND_PASS, deadModesFile: join(outDir, "dead-modes.json"), jsonObject: true });
  console.log(`routes:\n  ${routeLines(rt).join("\n  ")}`);
  let report: Awaited<ReturnType<typeof runSecondPass>> | undefined;
  let failure: Error | undefined;
  try {
    report = await runSecondPass(root, rt, data, firstDir, args.out);
  } catch (e) {
    failure = e as Error;
  }
  const trace = await writeTrace(root, "ingest-second-pass", rt.events);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "run.json"), JSON.stringify({ started: localIso(started), finished: localIso(new Date()), route: rt.route, thinking: "on", response_format: "json_object", second_pass_of: args.secondPassOf, cache_dir: cacheDir, cache_namespace: SECOND_PASS, max_calls: maxCalls, calls_used: rt.client.budget.used, trace, complete: report?.complete ?? false, stopped_reason: failure?.message ?? report?.stopped_reason ?? null }, null, 2) + "\n");
  if (failure) throw failure; // e.g. NVIDIA rejected response_format: the run stops, run.json says why
  console.log(JSON.stringify(report!.second_pass, null, 2));
  console.log(`calls used ${rt.client.budget.used}/${maxCalls}; wrote ${relative(root, outDir)}/ (merged cards, first-pass edges, report, seats, H-MEM snapshot, run.json); state/ and snapshot/ untouched; trace ${trace}`);
}
