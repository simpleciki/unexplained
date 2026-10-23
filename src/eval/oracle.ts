// Oracle evaluation: the engine runs with gold cards as extracted cards and gold edges as relation
// judgments, so the score is the upper bound of the deterministic layer. This file (not src/engine/)
// is where gold files are opened; they are handed to the engine as plain inputs.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createTraceLogger, hashPrompt } from "../trace.ts";
import type { TraceInput } from "../trace.ts";
import { parseJsonl } from "../engine/data.ts";
import { buildEngine, saveState } from "../engine/engine.ts";
import { answerQuestion } from "../engine/answer.ts";
import type { Answer } from "../engine/answer.ts";
import { scoreQuestion, summarise } from "./scoring.ts";
import type { GoldQuestion, Score } from "./scoring.ts";
import type { Dataset, DecisionCard, EngineEvent, RelationEdge } from "../engine/types.ts";
import { loadData, traceZetaris } from "../adapters/zetaris.ts";
import type { QueryEvent } from "../zetaris/client.ts";
import { SUSPECTED_GOLD_ERRORS, TRIAGE } from "./suspected-gold.ts";

export type { GoldQuestion, Score } from "./scoring.ts";

export async function runOracle(root: string, data?: Dataset) {
  const gold = (f: string) => readFileSync(join(root, "eval/gold", f), "utf8");
  const cards = parseJsonl<DecisionCard>(gold("gold_cards.jsonl"));
  const edges = parseJsonl<RelationEdge>(gold("gold_edges.jsonl"));
  const questions = parseJsonl<GoldQuestion>(gold("gold_questions.jsonl"));
  const cardById = new Map(cards.map((c) => [c.card_id, c]));

  const runId = `oracle-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const trace = createTraceLogger(runId, join(root, "logs"));
  const pending: TraceInput[] = [];
  const toTrace = (e: EngineEvent): TraceInput => ({
    phase: "build", agent: "engine", action: e.action, input_ref: e.ref, output_ref: e.details ? hashPrompt(JSON.stringify(e.details)) : "", outcome: e.outcome, retry_count: 0, latency_ms: 0,
  });

  const t0 = performance.now();
  const engine = buildEngine(root, cards, edges, (e) => pending.push(toTrace(e)), data);
  // Kept out of state/: a live ingest owns that folder.
  saveState(engine, root, join(root, "eval/results/oracle-state"));
  pending.push({ phase: "build", agent: "engine", action: "build_engine", input_ref: "gold_cards+gold_edges", output_ref: "state/seats.json", outcome: `cards=${engine.graph.cards.size} links=${engine.graph.links.length} hmem_overrides=${engine.memory.overrides} drift=${engine.memory.drift}`, retry_count: 0, latency_ms: Math.round(performance.now() - t0) });

  const scores: Score[] = [];
  const answers: Answer[] = [];
  for (const q of questions) {
    const t = performance.now();
    // Oracle routing: the seat's topic and facets come from the gold card the question is about.
    const routeCard = cardById.get(q.expected_current_card ?? q.expected_in_effect_card ?? "");
    const effectCard = cardById.get(q.expected_in_effect_card ?? "") ?? routeCard;
    const a = answerQuestion(engine, q, {
      route: routeCard ? { topic: routeCard.topic, facets: routeCard.facets } : undefined,
      inEffectRoute: effectCard ? { topic: effectCard.topic, facets: effectCard.facets } : undefined,
      clientExplanation: q.expected_client_explanation,
    });
    const s = scoreQuestion(q, a);
    answers.push(a);
    scores.push(s);
    pending.push({ phase: "oracle", agent: "engine", action: "answer", input_ref: q.question_id, output_ref: hashPrompt(JSON.stringify(a.flags)), outcome: s.why.length ? `fail: ${s.why.join("; ")}` : "pass", retry_count: 0, latency_ms: Math.round(performance.now() - t) });
  }
  for (const ev of pending) await trace.append(ev);

  const summary = summarise(scores);
  const out = {
    run_id: runId,
    mode: "oracle",
    notes: [
      "Cards = eval/gold/gold_cards.jsonl, relations = eval/gold/gold_edges.jsonl.",
      "Routing (which topic/facets a question is about) is oracle: the seat of the gold current card, and of the gold in-effect card when it differs. The engine still has to pick the right card on that seat as of the date.",
      "P2 'does the client-facing text explain the change' is oracle: expected_client_explanation.",
      "Approval polarity, rule meaning, focus version and open-item wording are read deterministically from text.",
    ],
    summary,
    failing: scores.filter((s) => s.why.length).map((s) => ({ question_id: s.question_id, pattern: s.pattern, why: s.why.join("; "), bucket: TRIAGE[s.question_id] ?? "UNTRIAGED" })),
    time_tag_mismatches: scores.filter((s) => s.time_tag_why).map((s) => ({ question_id: s.question_id, pattern: s.pattern, why: s.time_tag_why, bucket: TRIAGE[`${s.question_id}#time`] ?? "UNTRIAGED" })),
    additional_findings: scores.flatMap((s) =>
      s.additional_warnings.map((p) => {
        const flag = answers.find((a) => a.question_id === s.question_id)!.flags.find((f) => f.pattern === p)!;
        return { question_id: s.question_id, warning: p, evidence: flag.evidence, details: flag.details };
      }),
    ),
    suspected_gold_errors: SUSPECTED_GOLD_ERRORS,
    scores,
    answers,
    trace_file: relative(root, trace.path), // repo-relative: no machine path in a published file
  };
  mkdirSync(join(root, "eval/results"), { recursive: true });
  writeFileSync(join(root, "eval/results/oracle.json"), JSON.stringify(out, null, 2) + "\n");
  return out;
}

function printReport(out: Awaited<ReturnType<typeof runOracle>>) {
  const s = out.summary;
  const cell = (v: unknown, w: number) => String(v ?? "-").padEnd(w);
  console.log("Per question pattern (rate of questions correct)");
  console.log("pattern  n  warn_recall time_tags current in_effect reasons");
  for (const [p, r] of Object.entries(s.by_question_pattern)) {
    console.log(`${p.padEnd(7)} ${String(r.n).padStart(2)}  ${cell(r.warnings_recalled, 11)} ${cell(r.time_tags, 9)} ${cell(r.current, 7)} ${cell(r.in_effect, 9)} ${r.reasons}`);
  }
  console.log("\nFlag precision / recall over all questions");
  for (const [p, r] of Object.entries(s.flag_precision_recall)) {
    console.log(`${p.padEnd(4)} tp ${r.tp} fp ${r.fp} fn ${r.fn}  precision ${r.precision}  recall ${r.recall}`);
  }
  console.log(
    `\nOverall (n=${s.n}): required-warning recall ${s.required_warning_recall}, CTRL false alarms ${s.ctrl_false_alarms}/${s.ctrl_n}, time-tag accuracy ${s.time_tag_accuracy} (n=${s.time_tag_n}), current ${s.current_card}, in-effect ${s.in_effect_card}, reasons ${s.reasons_superset}`,
  );
  console.log(`\nFailing questions: ${out.failing.length}`);
  for (const f of out.failing) console.log(`- [${f.bucket}] ${f.question_id} (${f.pattern}) ${f.why}`);
  console.log(`\nTime-tag mismatches (not alarms): ${out.time_tag_mismatches.length}`);
  for (const f of out.time_tag_mismatches) console.log(`- [${f.bucket}] ${f.question_id} (${f.pattern}) ${f.why}`);
  console.log(`\nAdditional findings (extra warnings on non-CTRL questions, for human audit): ${out.additional_findings.length}`);
  for (const f of out.additional_findings) console.log(`- ${f.question_id} +${f.warning} evidence ${f.evidence.join(",")}`);
  console.log(`\nWrote eval/results/oracle.json; trace ${out.trace_file}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const i = process.argv.indexOf("--source");
  const source = i > 0 ? process.argv[i + 1] : "zetaris";
  if (source !== "files" && source !== "zetaris") throw new Error("--source must be files or zetaris");
  const zetarisEvents: QueryEvent[] = [];
  loadData(root, source, (e) => zetarisEvents.push(e))
    .then(async (data) => {
      const trace = await traceZetaris(root, "oracle", zetarisEvents);
      if (trace) console.log(`read ${zetarisEvents.filter((e) => e.action === "query").length} tables and views through Zetaris; trace ${trace}`);
      return runOracle(root, data);
    })
    .then(printReport)
    .catch((e) => {
      console.error(`error: ${(e as Error).message}`);
      process.exit(1);
    });
}
