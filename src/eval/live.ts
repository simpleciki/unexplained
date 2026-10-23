// eval:live: the gold questions answered with model outputs (ingested cards and relations, Router,
// Judge, Explainer, Skeptic) instead of oracle inputs, scored with the oracle scorer.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseJsonl } from "../engine/data.ts";
import { buildEngine } from "../engine/engine.ts";
import type { Dataset, DecisionCard, RelationEdge } from "../engine/types.ts";
import { RunStopped } from "../llm/client.ts";
import { agentContext } from "../agents/shared.ts";
import { runAsk } from "../pipeline/ask.ts";
import { loadIngested } from "../pipeline/ingest.ts";
import type { Runtime } from "../pipeline/runtime.ts";
import { extractionScore, relationScore, toGoldIds } from "./extraction-score.ts";
import { scoreQuestion, summarise } from "./scoring.ts";
import type { GoldQuestion, Score } from "./scoring.ts";

// 3 hero-case questions + one per warning P1-P7 + one T10 + one CTRL.
export const DEV_SUBSET = [
  "q-p5-heron-why", "q-p5-heron-v4", "q-p7-heron-invoice",
  "q-p1-nl02-send-v3", "q-p2-nl02-heater-price", "q-p3-nl03-progress", "q-p4-nl04-cap",
  "q-p5-oc05-why", "q-p6-pw03-trip", "q-p7-pw03-inv", "q-t10-rm-may", "q-ctrl-oc01-inv",
];

const gold = <T>(root: string, f: string) => parseJsonl<T>(readFileSync(join(root, "eval/gold", f), "utf8"));

export function subsetQuestions(root: string, subset: "dev" | "full"): GoldQuestion[] {
  const all = gold<GoldQuestion>(root, "gold_questions.jsonl");
  if (subset === "full") return all;
  return DEV_SUBSET.map((id) => all.find((q) => q.question_id === id) ?? (() => { throw new Error(`dev question ${id} missing`); })());
}

export async function runLive(root: string, rt: Runtime, subset: "dev" | "full", data?: Dataset) {
  const { cards, edges } = loadIngested(root);
  const engine = buildEngine(root, cards, edges, undefined, data);
  const ctx = agentContext(root, engine.data, engine.vocab);
  const questions = subsetQuestions(root, subset);
  const scores: Score[] = [];
  const results: unknown[] = [];
  let stopped: string | undefined;
  // Model cards are scored by the gold card they match (see toGoldIds).
  const ex = extractionScore(cards, gold<DecisionCard>(root, "gold_cards.jsonl"));
  for (const q of questions) {
    try {
      const r = await runAsk(engine, ctx, rt, { question_id: q.question_id, question: q.question, as_of: q.as_of });
      scores.push(scoreQuestion(q, toGoldIds(r.answer, ex.match)));
      results.push({ question_id: q.question_id, route: r.route, judge: r.judge, prose: r.prose, unresolved: r.unresolved, flags: r.answer.flags.map((f) => f.pattern) });
    } catch (e) {
      if (!(e instanceof RunStopped)) throw e;
      stopped = e.message;
      break;
    }
  }
  const rel = relationScore(edges, gold<RelationEdge>(root, "gold_edges.jsonl"), ex.match);
  const summary = summarise(scores);
  const out = {
    subset,
    complete: !stopped && scores.length === questions.length,
    stopped_reason: stopped,
    answered: scores.length,
    of: questions.length,
    summary,
    extraction: { ...ex, match: Object.fromEntries(ex.match) },
    relations: rel,
    failing: scores.filter((s) => s.why.length).map((s) => ({ question_id: s.question_id, why: s.why.join("; ") })),
    results,
  };
  mkdirSync(join(root, "eval/results"), { recursive: true });
  writeFileSync(join(root, `eval/results/live-${subset}.json`), JSON.stringify(out, null, 2) + "\n");
  return out;
}

export function printSideBySide(root: string, live: Awaited<ReturnType<typeof runLive>>) {
  const f = join(root, "eval/results/oracle.json");
  const oracle = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")).summary : null;
  const rows: [string, unknown, unknown][] = [
    ["required-warning recall", oracle?.required_warning_recall, live.summary.required_warning_recall],
    ["CTRL false alarms", oracle ? `${oracle.ctrl_false_alarms}/${oracle.ctrl_n}` : "-", `${live.summary.ctrl_false_alarms}/${live.summary.ctrl_n}`],
    ["time-tag accuracy", oracle?.time_tag_accuracy, live.summary.time_tag_accuracy],
    ["current card", oracle?.current_card, live.summary.current_card],
    ["in-effect card", oracle?.in_effect_card, live.summary.in_effect_card],
    ["reasons", oracle?.reasons_superset, live.summary.reasons_superset],
    ["extraction precision", "1 (gold)", live.extraction.precision],
    ["extraction recall", "1 (gold)", live.extraction.recall],
    ["relation accuracy", "1 (gold)", live.relations.accuracy],
  ];
  console.log(`metric                     oracle (80 q)   live (${live.answered}/${live.of} q, ${live.subset})`);
  for (const [m, o, l] of rows) console.log(`${m.padEnd(26)} ${String(o ?? "-").padEnd(15)} ${String(l ?? "-")}`);
  if (!live.complete) console.log(`stopped early: ${live.stopped_reason ?? "not all questions answered"}`);
}
