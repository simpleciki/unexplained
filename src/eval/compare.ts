// eval:compare — group A (one model call reading the records) vs group C (the engine with human judgments),
// scored by the rules pre-registered in docs/eval-protocol-011.md (commit 0d8bc73) and its amendment 1
// (docs/eval-protocol-011-amendment-1.md, commit d1985f6: an upstream failure later in C's path is unscorable). Each answer gets one
// outcome: correct / confidently_wrong / handed_to_person / unscorable; "passed while abstaining" is counted
// inside correct. Groups are a registry so a later group B plugs in without changing the scoring.
import { buildEngine } from "../engine/engine.ts";
import type { Answer } from "../engine/answer.ts";
import { parseJsonl } from "../engine/data.ts";
import type { Dataset, DecisionCard } from "../engine/types.ts";
import { asOfMs } from "../engine/time.ts";
import { loadVocab } from "../engine/vocab.ts";
import { agentContext } from "../agents/shared.ts";
import { RunStopped } from "../llm/client.ts";
import { ProviderError } from "../llm/provider.ts";
import { runAsk } from "../pipeline/ask.ts";
import { loadIngested } from "../pipeline/ingest.ts";
import type { Runtime } from "../pipeline/runtime.ts";
import { openQuestions } from "../review/judgments.ts";
import { loadReviewView } from "../review/queue.ts";
import type { ReviewView } from "../review/queue.ts";
import { matchCards, toGoldIds } from "./extraction-score.ts";
import { aAnswer, aInputs, askA } from "./group-a.ts";
import type { AReply } from "./group-a.ts";
import { scoreQuestion } from "./scoring.ts";
import type { GoldQuestion, Score } from "./scoring.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type Outcome = "correct" | "confidently_wrong" | "handed_to_person" | "unscorable";
export const OUTCOMES: Outcome[] = ["correct", "confidently_wrong", "handed_to_person", "unscorable"];

export type OpenItem = { kind: "needs_human" | "open_question"; record_id: string; text: string };

export type QuestionResult = {
  question_id: string;
  group: string;
  outcome: Outcome;
  abstained: boolean; // A: verdict cannot_tell; C: open items listed ("Not cleared")
  why: string;
  records_given: number;
  score: Score | null;
  model: string | null;
  human_cards_cited?: number;
  open_items?: OpenItem[];
  reply?: unknown;
};

// --- outcome rules (docs/eval-protocol-011.md, "Outcomes") ---

export function classifyA(q: GoldQuestion, reply: AReply | null, error: string | undefined, gold: DecisionCard[]) {
  if (!reply) return { outcome: "unscorable" as const, abstained: false, why: `no usable reply: ${(error ?? "").slice(0, 160)}`, score: null };
  const score = scoreQuestion(q, aAnswer(reply, gold) as Answer);
  const abstained = reply.verdict === "cannot_tell";
  if (!score.why.length) return { outcome: "correct" as const, abstained, why: abstained ? `passed while abstaining: ${reply.cannot_tell_because ?? ""}` : "all checks pass", score };
  if (abstained && reply.cannot_tell_because) return { outcome: "handed_to_person" as const, abstained, why: `cannot tell: ${reply.cannot_tell_because}`, score };
  return { outcome: "confidently_wrong" as const, abstained, why: score.why[0], score };
}

export function classifyC(q: GoldQuestion, answer: Answer | null, noReply: string | undefined, openItems: OpenItem[]) {
  if (!answer || noReply !== undefined) return { outcome: "unscorable" as const, abstained: false, why: `no usable reply: ${(noReply ?? "").slice(0, 160)}`, score: null };
  const score = scoreQuestion(q, answer);
  const abstained = openItems.length > 0;
  const first = openItems[0] ? `${openItems[0].record_id}: ${openItems[0].text}` : "";
  if (!score.why.length) return { outcome: "correct" as const, abstained, why: abstained ? `passed while not cleared (${openItems.length} open; first ${first})` : "all checks pass", score };
  if (abstained) return { outcome: "handed_to_person" as const, abstained, why: `not cleared, ${openItems.length} open; first ${first}`, score };
  return { outcome: "confidently_wrong" as const, abstained, why: score.why[0], score };
}

// C's open items: on the jobs of the question's seats, records routed to a person and not judged yet, and
// open questions on the latest human judgments, all written by as_of. No model call.
export function openItemsFor(view: ReviewView, q: GoldQuestion): OpenItem[] {
  const at = q.as_of ? asOfMs(q.as_of) : Number.POSITIVE_INFINITY;
  const jobs = new Set(q.seats.filter((s) => s.startsWith("job:")).map((s) => s.slice(4)));
  const inScope = view.items.filter((x) => x.job && jobs.has(x.job) && Date.parse(x.recorded_at) <= at);
  const ids = new Set(inScope.map((x) => x.record_id));
  return [
    ...inScope.filter((x) => x.bucket === "needs_human").map((x) => ({ kind: "needs_human" as const, record_id: x.record_id, text: x.why })),
    ...openQuestions(view.judgments).filter((o) => ids.has(o.record_id)).map((o) => ({ kind: "open_question" as const, record_id: o.record_id, text: `open question (${o.reviewer}): ${o.question}` })),
  ];
}

// --- groups ---

export type GroupCtx = { root: string; rt: Runtime; data: Dataset; gold: DecisionCard[]; questions: GoldQuestion[] };
export type GroupRun = { results: QuestionResult[]; stopped?: string };
export type GroupRunner = (ctx: GroupCtx) => Promise<GroupRun>;

export const runGroupA: GroupRunner = async ({ root, rt, data, gold, questions }) => {
  const vocab = loadVocab(root);
  const results: QuestionResult[] = [];
  for (const q of questions) {
    const inputs = aInputs(data, vocab, q);
    const given = inputs.records.length + (inputs.inHand ? 1 : 0);
    try {
      const r = await askA(rt.client, rt.models.researcher, q, inputs);
      results.push({ question_id: q.question_id, group: "a", records_given: given, model: r.model || null, reply: r.value, ...classifyA(q, r.value, r.error, gold) });
    } catch (e) {
      if (e instanceof RunStopped) return { results, stopped: e.message };
      if (!(e instanceof ProviderError)) throw e;
      results.push({ question_id: q.question_id, group: "a", records_given: given, model: null, ...classifyA(q, null, `upstream failure: ${e.message}`, gold) });
    }
  }
  return { results };
};

export const runGroupC: GroupRunner = async ({ root, rt, data, gold, questions }) => {
  const { cards, edges, judgments } = loadIngested(root, data);
  const view = loadReviewView(root, data);
  const recTime = new Map(data.records.map((r) => [r.record_id, Date.parse(r.source_recorded_at)]));
  const results: QuestionResult[] = [];
  for (const q of questions) {
    const at = q.as_of ? asOfMs(q.as_of) : Number.POSITIVE_INFINITY;
    // Same cut-off as A: only cards from records written by as_of (the engine adds decided_at <= as_of).
    const seen = cards.filter((c) => (recTime.get(c.record_id) ?? Number.POSITIVE_INFINITY) <= at);
    const ids = new Set(seen.map((c) => c.card_id));
    const engine = buildEngine(root, seen, edges.filter((e) => ids.has(e.old_card) && ids.has(e.new_card)), undefined, data);
    const given = data.records.filter((r) => Date.parse(r.source_recorded_at) <= at).length;
    const open = openItemsFor(view, q);
    try {
      const r = await runAsk(engine, agentContext(root, engine.data, engine.vocab), rt, { question_id: q.question_id, question: q.question, as_of: q.as_of }, judgments);
      // One yardstick: every card C can cite (model and human) is mapped to gold with matchCards.
      const match = matchCards(engine.cards.filter((c) => c.result === "PASS"), gold);
      const cited = [r.answer.current_card, r.answer.in_effect_card, ...r.answer.reasons, ...r.sentences.flatMap((s) => s.cites)].filter((x): x is string => !!x);
      const human = new Set(cited.filter((id) => id.startsWith("h.")));
      results.push({
        question_id: q.question_id, group: "c", records_given: given, model: null, human_cards_cited: human.size, open_items: open,
        ...classifyC(q, r.route.no_reply === undefined ? toGoldIds(r.answer, match) : null, r.route.no_reply, open),
      });
    } catch (e) {
      if (e instanceof RunStopped) return { results, stopped: e.message };
      if (!(e instanceof ProviderError)) throw e;
      // An upstream failure leaves no answer to score.
      results.push({ question_id: q.question_id, group: "c", records_given: given, model: null, human_cards_cited: 0, open_items: open, ...classifyC(q, null, `upstream failure: ${e.message}`, open) });
    }
  }
  return { results };
};

export const GROUPS: Record<string, GroupRunner> = { a: runGroupA, c: runGroupC };

// --- the comparison ---

export function tallyGroup(results: QuestionResult[]) {
  const counts = Object.fromEntries(OUTCOMES.map((o) => [o, results.filter((r) => r.outcome === o).length])) as Record<Outcome, number>;
  return { counts, passed_while_abstaining: results.filter((r) => r.outcome === "correct" && r.abstained).length, answered: results.length };
}

export async function runCompare(root: string, rt: Runtime, questions: GoldQuestion[], groups: string[], data: Dataset) {
  const gold = parseJsonl<DecisionCard>(readFileSync(join(root, "eval/gold/gold_cards.jsonl"), "utf8"));
  const requested = new Set(rt.modeOrder ?? []);
  const out: Record<string, ReturnType<typeof tallyGroup> & { calls: number; stopped?: string; models: Record<string, number>; unrequested_model_calls: number | null; results: QuestionResult[] }> = {};
  for (const g of groups) {
    const runner = GROUPS[g];
    if (!runner) throw new Error(`group ${g} is not built yet (built: ${Object.keys(GROUPS).join(", ")})`);
    const used0 = rt.client.budget.used;
    const ev0 = rt.events.length;
    const run = await runner({ root, rt, data, gold, questions });
    const events = rt.events.slice(ev0).filter((e) => e.action !== "route_fallback" && e.model_answered);
    const models: Record<string, number> = {};
    for (const e of events) models[e.model_answered] = (models[e.model_answered] ?? 0) + 1;
    out[g] = {
      ...tallyGroup(run.results),
      calls: rt.client.budget.used - used0,
      stopped: run.stopped,
      models,
      unrequested_model_calls: requested.size ? events.filter((e) => e.cache === "miss" && !requested.has(e.model_answered)).length : null,
      results: run.results,
    };
    if (run.stopped) break;
  }
  return { questions: questions.length, route: rt.route ?? null, groups: out };
}
