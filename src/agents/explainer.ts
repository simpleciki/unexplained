// Explainer: the structured answer -> a short answer for the office gatekeeper, sentence by sentence,
// each citing the record ids it rests on. The Skeptic checks every sentence afterwards.
import type { Answer } from "../engine/answer.ts";
import type { CheckedCard } from "../engine/types.ts";
import type { ModelClient } from "../llm/client.ts";
import { arr, obj, str, strArr } from "../llm/json.ts";
import { RULES } from "./shared.ts";
import type { Sentence } from "./skeptic.ts";

const SYSTEM = `You write a short answer (3 to 6 sentences) for a repair contractor's office gatekeeper.
Say what the client will push back on, why (only reasons the findings show), and what to fix before sending.
Every sentence cites the record ids it rests on. If the findings show nothing wrong, say so plainly.
Rules:
${RULES}
Return JSON only: {"sentences":[{"text":"...","cites":["rec-...."]}]}`;

// The findings the prose may use: compact, with each cited card's quote and record id.
export function findingsOf(a: Answer, cards: Map<string, CheckedCard>) {
  const card = (id: string | null) => {
    const c = id ? cards.get(id) : undefined;
    return c ? { card: c.card_id, record: c.record_id, mode: c.mode, quote: c.quote, decided_at: c.decided_at, by: c.decided_by } : null;
  };
  return {
    question_id: a.question_id,
    as_of: a.as_of,
    focus: a.focus,
    current: card(a.current_card),
    in_effect: card(a.in_effect_card),
    reasons: a.reasons.map(card).filter(Boolean),
    warnings: a.flags.map((f) => ({ pattern: f.pattern, evidence: f.evidence, details: f.details })),
    unresolved: a.unresolved,
  };
}

export async function explain(client: ModelClient, model: string, question: string, findings: unknown): Promise<Sentence[] | null> {
  const r = await client.json(
    { stage: "answer", agent: "Explainer", model, system: SYSTEM, user: `Question: ${question}\n\nFindings:\n${JSON.stringify(findings)}` },
    (v) =>
      arr(obj(v, "reply").sentences, "sentences").map((x, i) => {
        const o = obj(x, `sentences[${i}]`);
        return { text: str(o.text, `sentences[${i}].text`), cites: o.cites == null ? [] : strArr(o.cites, `sentences[${i}].cites`) };
      }),
    1,
  );
  return r.value;
}
