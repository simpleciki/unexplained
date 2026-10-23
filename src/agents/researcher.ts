// Researcher.extract: one record -> candidate decision cards. The model copies words and phrases;
// code turns time phrases into times (timephrase.ts) and the gate (verify.ts) rejects anything whose
// quote is not verbatim in the record, whose keys are unknown, or whose decider is not allowed.
import type { DecisionCard, SourceRecord } from "../engine/types.ts";
import { parsePhrase } from "../engine/timephrase.ts";
import type { ModelClient } from "../llm/client.ts";
import { arr, obj, oneOf, str, strArr } from "../llm/json.ts";
import type { AgentContext } from "./shared.ts";
import { RULES, peopleText, vocabText } from "./shared.ts";

export const EXTRACT_TYPES = new Set(["client_message", "internal_note", "field_note"]);
const MODES = ["decides", "mentions", "gives_reason", "proposes"] as const;

export type RawCard = {
  mode: (typeof MODES)[number];
  topic: string;
  facets: string[];
  scope: string;
  decided_at: string;
  effective: string;
  decided_by: string;
  quote: string;
};

// The worked examples are invented (other names, trades and amounts). Never copy or paraphrase text
// from data/records/ into them: extraction is scored on those records.
export const SYSTEM = `You extract decision cards from one record of a repair contractor's job file.
A card is one decision, reason, proposal or report. Its quote is the shortest exact span of the record that states it
completely, usually one or two sentences. Do not split one decision into several cards: a one-word acceptance such as
"Accepted." belongs in the same quote as the sentence that says what is accepted. Do not merge two different decisions
into one card.
A contractor's quote is only a proposal; only a client reviewer can decide.
Modes:
- decides: the client reviewer decides, approves, rejects, or sets or withdraws a rule. A client decision that someone
  else reports (a note logging the client's approval on a call) is still decides, with decided_by = the client.
- gives_reason: someone states why: why a quote was rejected, why a price changed, why something is needed. A refusal
  that comes with its cause is a gives_reason card; add a decides card for the refusal only if it is a separate statement.
- proposes: a promise, offer or plan about the future ("we can send the crew back on Tuesday", "I'll call you once the
  parts arrive"), including a quote the contractor submits.
- mentions: the writer refers to a decision, practice or state without making a new decision (including saying what
  they have NOT approved).
Examples (invented, not from this job file):
- Client reviewer writes "Yes, that works. Use the cedar boards on the north side." -> one decides card, quote
  "Yes, that works. Use the cedar boards on the north side."
- Client reviewer writes "We can't accept the glazing quote: it charges for six panes and only two are broken." -> one
  gives_reason card with that whole sentence as the quote.
- Estimator writes "We'll measure the stairwell again on Monday and send a revised number by Wednesday." -> one
  proposes card.
- Office coordinator writes "Bea Lund told me over lunch that the repaint is approved at $2,140." -> one decides card,
  decided_by = Bea Lund.
- Client reviewer writes "I haven't signed off on the shed roof yet." -> one mentions card.
- Field technician writes "Arrived 9:40, deck sanded, dust sheets left in the hallway." -> {"cards":[]}.
Rules:
${RULES}
Return JSON only: {"cards":[{"mode":"decides|mentions|gives_reason|proposes","topic":"...","facets":["..."],"scope":"job:<id>|client:<id>|global",
"decided_at":"the time phrase as written in the text, or record_time","effective":"the start phrase as written, or record_time",
"decided_by":"person id","quote":"exact words copied from the record"}]}
Return {"cards":[]} when the record decides, proposes or explains nothing.`;

export function extractPrompt(rec: SourceRecord, ctx: AgentContext, hint?: string): string {
  const job = ctx.jobs.find((j) => j.id === rec.thread_id);
  return [
    `Record ${rec.record_id} (${rec.source_type}), written ${rec.source_recorded_at} by ${rec.author}.`,
    job ? `Job ${job.id} "${job.title}" for client ${job.client}. Allowed scopes: job:${job.id}, client:${job.client}, global.` : "Allowed scopes: global.",
    `Text:\n"""${rec.text}"""`,
    `Vocabulary:\n${vocabText(ctx.vocab)}`,
    `People:\n${peopleText(ctx.people)}`,
    hint ? `A checker rejected earlier cards from this record: ${hint}. Extract again, more carefully.` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function parseCards(v: unknown): RawCard[] {
  return arr(obj(v, "reply").cards, "cards").map((c, i) => {
    const o = obj(c, `cards[${i}]`);
    return {
      mode: oneOf(o.mode, MODES, `cards[${i}].mode`),
      topic: str(o.topic, `cards[${i}].topic`),
      facets: strArr(o.facets, `cards[${i}].facets`),
      scope: str(o.scope, `cards[${i}].scope`),
      decided_at: typeof o.decided_at === "string" ? o.decided_at : "record_time",
      effective: typeof o.effective === "string" ? o.effective : "record_time",
      decided_by: str(o.decided_by, `cards[${i}].decided_by`),
      quote: str(o.quote, `cards[${i}].quote`),
    };
  });
}

// Model output -> engine card. Times come from code; an effective start never precedes the decision.
export function toCard(raw: RawCard, rec: SourceRecord, n: number, round = 0): DecisionCard {
  const decided = parsePhrase(raw.decided_at, rec.source_recorded_at).iso;
  const eff = parsePhrase(raw.effective, decided).iso;
  return {
    card_id: `m.${rec.record_id}.${round}.${n}`,
    record_id: rec.record_id,
    quote: raw.quote,
    mode: raw.mode,
    topic: raw.topic,
    facets: raw.facets,
    scope: raw.scope,
    decided_at: decided,
    effective: Date.parse(eff) < Date.parse(decided) ? decided : eff,
    decided_by: raw.decided_by,
  };
}

export type ExtractResult = { cards: DecisionCard[]; rejected: boolean; model: string; error?: string };

export async function extract(client: ModelClient, model: string, rec: SourceRecord, ctx: AgentContext, round = 0, hint?: string): Promise<ExtractResult> {
  const r = await client.json(
    { stage: "ingest", agent: "Researcher.extract", model, system: SYSTEM, user: extractPrompt(rec, ctx, hint) },
    parseCards,
    2,
  );
  if (!r.value) return { cards: [], rejected: true, model: r.model, error: r.error };
  return { cards: r.value.map((c, i) => toCard(c, rec, i, round)), rejected: false, model: r.model };
}
