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
import type { DecisionCard, EngineEvent, RelationEdge } from "../engine/types.ts";
import { SUSPECTED_GOLD_ERRORS, TRIAGE } from "./suspected-gold.ts";

export type GoldQuestion = {
  question_id: string;
  pattern: string;
  question: string;
  as_of: string | null;
  seats: string[];
  expected_current_card: string | null;
  expected_in_effect_card: string | null;
  expected_reasons: string[];
  expected_flags: string[];
  expected_client_explanation?: "present" | "absent";
};

// Warnings are alarms (P1-P7). Time tags (T2, T6, T10) name the time trap a question tests; they are
// never alarms and are scored separately.
const WARNINGS = ["P1", "P2", "P3", "P4", "P5", "P6", "P7"];
const TIME_TAGS = ["T2", "T6", "T10"];
const PATTERNS = [...WARNINGS, ...TIME_TAGS];

export type Score = {
  question_id: string;
  pattern: string;
  warnings_recalled: boolean; // expected P-flags are a subset of predicted P-flags
  ctrl_false_alarm: boolean; // any P-warning on a CTRL question
  time_tags_ok: boolean;
  current_ok: boolean;
  in_effect_ok: boolean;
  reasons_ok: boolean;
  predicted_flags: string[];
  expected_flags: string[];
  additional_warnings: string[]; // extra P-warnings on non-CTRL questions: audited by a human, not failures
  why: string[]; // metric failures
  time_tag_why: string | null;
};

export function scoreQuestion(q: GoldQuestion, a: Answer): Score {
  const pred = a.flags.map((f) => f.pattern).sort();
  const want = [...q.expected_flags].sort();
  const predW = pred.filter((p) => WARNINGS.includes(p));
  const wantW = want.filter((p) => WARNINGS.includes(p));
  const predT = pred.filter((p) => TIME_TAGS.includes(p));
  const wantT = want.filter((p) => TIME_TAGS.includes(p));
  const missingW = wantW.filter((p) => !predW.includes(p));
  const ctrlAlarm = q.pattern === "CTRL" && predW.length > 0;
  const missingReasons = q.expected_reasons.filter((r) => r !== "not_recorded" && !a.reasons.includes(r));
  const why: string[] = [];
  if (missingW.length) why.push(`missing warning ${missingW.join(" ")}`);
  if (ctrlAlarm) why.push(`CTRL false alarm ${predW.join(" ")}`);
  if (a.current_card !== q.expected_current_card) why.push(`current ${a.current_card ?? "none"} != ${q.expected_current_card}`);
  if (a.in_effect_card !== q.expected_in_effect_card) why.push(`in_effect ${a.in_effect_card ?? "none"} != ${q.expected_in_effect_card}`);
  if (missingReasons.length) why.push(`reasons missing ${missingReasons.join(",")}`);
  const tExtra = predT.filter((p) => !wantT.includes(p));
  const tMissing = wantT.filter((p) => !predT.includes(p));
  const timeOk = !tExtra.length && !tMissing.length;
  return {
    question_id: q.question_id,
    pattern: q.pattern,
    warnings_recalled: missingW.length === 0,
    ctrl_false_alarm: ctrlAlarm,
    time_tags_ok: timeOk,
    current_ok: a.current_card === q.expected_current_card,
    in_effect_ok: a.in_effect_card === q.expected_in_effect_card,
    reasons_ok: missingReasons.length === 0,
    predicted_flags: pred,
    expected_flags: want,
    additional_warnings: q.pattern === "CTRL" ? [] : predW.filter((p) => !wantW.includes(p)),
    why,
    time_tag_why: timeOk ? null : `time tags ${tExtra.map((p) => `+${p}`).concat(tMissing.map((p) => `-${p}`)).join(" ")}`,
  };
}

export function summarise(scores: Score[]) {
  const rate = (xs: boolean[]) => (xs.length ? Math.round((xs.filter(Boolean).length / xs.length) * 1000) / 1000 : null);
  const perPattern = Object.fromEntries(
    PATTERNS.map((p) => {
      const tp = scores.filter((s) => s.predicted_flags.includes(p) && s.expected_flags.includes(p)).length;
      const fp = scores.filter((s) => s.predicted_flags.includes(p) && !s.expected_flags.includes(p)).length;
      const fn = scores.filter((s) => !s.predicted_flags.includes(p) && s.expected_flags.includes(p)).length;
      return [p, { tp, fp, fn, precision: tp + fp ? Math.round((tp / (tp + fp)) * 1000) / 1000 : null, recall: tp + fn ? Math.round((tp / (tp + fn)) * 1000) / 1000 : null }];
    }),
  );
  const byQuestionPattern = Object.fromEntries(
    [...new Set(scores.map((s) => s.pattern))].sort().map((p) => {
      const g = scores.filter((s) => s.pattern === p);
      return [
        p,
        {
          n: g.length,
          warnings_recalled: rate(g.map((s) => s.warnings_recalled)),
          time_tags: rate(g.map((s) => s.time_tags_ok)),
          current: rate(g.map((s) => s.current_ok)),
          in_effect: rate(g.map((s) => s.in_effect_ok)),
          reasons: rate(g.map((s) => s.reasons_ok)),
        },
      ];
    }),
  );
  const ctrl = scores.filter((s) => s.pattern === "CTRL");
  const timed = scores.filter((s) => s.expected_flags.some((f) => TIME_TAGS.includes(f)) || s.predicted_flags.some((f) => TIME_TAGS.includes(f)));
  return {
    n: scores.length,
    required_warning_recall: rate(scores.filter((s) => s.expected_flags.some((f) => WARNINGS.includes(f))).map((s) => s.warnings_recalled)),
    time_tag_accuracy: rate(timed.map((s) => s.time_tags_ok)),
    time_tag_n: timed.length,
    current_card: rate(scores.map((s) => s.current_ok)),
    in_effect_card: rate(scores.map((s) => s.in_effect_ok)),
    reasons_superset: rate(scores.map((s) => s.reasons_ok)),
    ctrl_false_alarms: ctrl.filter((s) => s.ctrl_false_alarm).length,
    ctrl_n: ctrl.length,
    flag_precision_recall: perPattern,
    by_question_pattern: byQuestionPattern,
  };
}

export async function runOracle(root: string) {
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
  const engine = buildEngine(root, cards, edges, (e) => pending.push(toTrace(e)));
  saveState(engine, root);
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
  runOracle(root).then(printReport);
}
