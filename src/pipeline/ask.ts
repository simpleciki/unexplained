// ask: one question end to end. Router -> deterministic focus -> Judge (only if the focus quote changed)
// -> engine answer -> Explainer -> Skeptic stage 2 (unsupported sentences removed, listed as unresolved).
import type { Engine } from "../engine/engine.ts";
import { answerQuestion } from "../engine/answer.ts";
import type { Answer } from "../engine/answer.ts";
import { diffLines } from "../engine/docs.ts";
import { focusOf } from "../engine/focus.ts";
import { asOfMs } from "../engine/time.ts";
import { route } from "../agents/router.ts";
import type { RouteResult } from "../agents/router.ts";
import { judgeExplained } from "../agents/judge.ts";
import { explain, findingsOf } from "../agents/explainer.ts";
import { checkAnswer } from "../agents/skeptic.ts";
import type { Sentence } from "../agents/skeptic.ts";
import type { AgentContext } from "../agents/shared.ts";
import type { Runtime } from "./runtime.ts";
import { confirmation } from "../review/judgments.ts";
import type { Judgment } from "../review/judgments.ts";

export type AskInput = { question_id: string; question: string; as_of: string | null };
export type AskResult = {
  question_id: string;
  route: RouteResult;
  judge: Awaited<ReturnType<typeof judgeExplained>>;
  answer: Answer;
  prose: string;
  sentences: Sentence[];
  unresolved: (Sentence & { why: string })[];
  // For each cited card that a person confirmed: "<card>: confirmed by <reviewer> on <date>: <reason>".
  confirmed: string[];
};

export async function runAsk(engine: Engine, ctx: AgentContext, rt: Runtime, input: AskInput, judgments: Judgment[] = []): Promise<AskResult> {
  const r = await route(rt.client, rt.models.router, input.question, ctx, input.as_of);
  const q = { question_id: input.question_id, question: input.question, as_of: r.as_of, seats: r.seats };

  // P2's "does the client-facing text explain the change" is the Judge's call, on the focus quote only.
  let judge: AskResult["judge"] = null;
  const asOf = q.as_of ? asOfMs(q.as_of) : Number.POSITIVE_INFINITY;
  const focus = focusOf(q, asOf, engine.docs, engine.data);
  if (focus.quote) {
    const prev = engine.docs.versionsOf(focus.quote.work_order_id).filter((v) => v.version < focus.quote!.version).at(-1);
    const changes = prev ? diffLines(prev.lines, focus.quote.lines) : [];
    if (changes.length) judge = await judgeExplained(rt.client, rt.models.judge, changes, focus.quote.record.text);
  }

  const answer = answerQuestion(engine, q, {
    route: r.topic ? { topic: r.topic, facets: r.facets } : undefined,
    clientExplanation: judge?.clientExplanation,
  });
  const cards = new Map(engine.cards.map((c) => [c.card_id, c]));
  const findings = findingsOf(answer, cards);
  const sentences = (await explain(rt.client, rt.models.explainer, input.question, findings)) ?? [];
  const checked = sentences.length ? await checkAnswer(rt.client, rt.models.skeptic, findings, sentences) : { kept: [], removed: [] };
  const prose = checked.kept.map((s) => `${s.text}${s.cites.length ? ` [${s.cites.join(", ")}]` : ""}`).join(" ");
  const cited = new Set(checked.kept.flatMap((s) => s.cites));
  const confirmed = [...cited].flatMap((id) => {
    const c = cards.get(id);
    const line = c && confirmation(c, judgments);
    return line ? [`${id}: ${line}`] : [];
  });
  return { question_id: input.question_id, route: r, judge, answer, prose, sentences: checked.kept, unresolved: checked.removed, confirmed };
}
