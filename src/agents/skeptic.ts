// Skeptic. Stage 1: is each card supported by its source text? Stage 2: is each sentence of the
// prose answer supported by the structured answer? Unsupported sentences are removed by code and
// listed under "unresolved"; unsupported cards go back to the Researcher (handled by the pipeline).
import type { DecisionCard, SourceRecord } from "../engine/types.ts";
import type { ModelClient } from "../llm/client.ts";
import { arr, obj, str } from "../llm/json.ts";
import { RULES } from "./shared.ts";

export type Verdict = { id: string; supported: boolean; why: string };

function parseVerdicts(v: unknown): Verdict[] {
  return arr(obj(v, "reply").verdicts, "verdicts").map((x, i) => {
    const o = obj(x, `verdicts[${i}]`);
    if (typeof o.supported !== "boolean") throw new Error(`verdicts[${i}].supported must be true or false`);
    return { id: String(o.id ?? ""), supported: o.supported, why: typeof o.why === "string" ? o.why : "" };
  });
}

const CARD_SYSTEM = `You check extracted decision cards against the record they came from.
A card is supported only if its quote is in the text, its mode (decides / mentions / gives_reason / proposes)
matches what the text does, the person named really made it, and the topic fits.
Rules:
${RULES}
Return JSON only: {"verdicts":[{"id":"<card id>","supported":true|false,"why":"one line"}]}`;

export async function checkCards(client: ModelClient, model: string, rec: SourceRecord, cards: DecisionCard[]): Promise<Verdict[] | null> {
  const user = [
    `Record ${rec.record_id} by ${rec.author}:\n"""${rec.text}"""`,
    `Cards:\n${cards.map((c) => JSON.stringify({ id: c.card_id, mode: c.mode, topic: c.topic, facets: c.facets, scope: c.scope, decided_by: c.decided_by, quote: c.quote })).join("\n")}`,
  ].join("\n\n");
  const r = await client.json({ stage: "ingest", agent: "Skeptic.cards", model, system: CARD_SYSTEM, user }, parseVerdicts, 2);
  return r.value;
}

const ANSWER_SYSTEM = `You check a short answer for an office gatekeeper against the structured findings it was written from.
A sentence is supported only if every claim in it is in the findings. A reason is supported only if the findings
show someone giving it. "Too expensive" is supported only if the findings quote the client saying so.
Rules:
${RULES}
Return JSON only: {"verdicts":[{"id":"<sentence number>","supported":true|false,"why":"one line"}]}`;

export type Sentence = { text: string; cites: string[] };

export async function checkAnswer(
  client: ModelClient,
  model: string,
  findings: unknown,
  sentences: Sentence[],
): Promise<{ kept: Sentence[]; removed: (Sentence & { why: string })[] }> {
  const user = [
    `Findings:\n${JSON.stringify(findings)}`,
    `Sentences:\n${sentences.map((s, i) => `${i + 1}. ${s.text}`).join("\n")}`,
  ].join("\n\n");
  const r = await client.json({ stage: "answer", agent: "Skeptic.answer", model, system: ANSWER_SYSTEM, user }, parseVerdicts, 2);
  // If the check itself fails, nothing is vouched for: every sentence goes to "unresolved".
  if (!r.value) return { kept: [], removed: sentences.map((s) => ({ ...s, why: "answer check failed" })) };
  const verdict = new Map(r.value.map((v) => [v.id, v]));
  const kept: Sentence[] = [];
  const removed: (Sentence & { why: string })[] = [];
  sentences.forEach((s, i) => {
    const v = verdict.get(String(i + 1));
    if (v?.supported) kept.push(s);
    else removed.push({ ...s, why: v?.why || "not checked" });
  });
  return { kept, removed };
}

export const sentenceText = (s: Sentence) => str(s.text, "sentence");
