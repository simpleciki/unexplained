// Group A of the A-vs-C comparison (docs/eval-protocol-011.md): one model call per question that reads the
// records itself. Same cut-off as C (records written by as_of, plus the document C treats as in hand), same
// runtime and model order, same yardstick (matchCards to gold, then scoreQuestion).
import { Docs } from "../engine/docs.ts";
import { focusOf } from "../engine/focus.ts";
import { asOfMs } from "../engine/time.ts";
import type { Answer } from "../engine/answer.ts";
import type { CardMode, Dataset, DecisionCard, SourceRecord } from "../engine/types.ts";
import type { Vocab } from "../engine/vocab.ts";
import type { ModelClient } from "../llm/client.ts";
import { arr, obj, oneOf, str } from "../llm/json.ts";
import { matchCards } from "./extraction-score.ts";
import type { GoldQuestion } from "./scoring.ts";

const MODES: CardMode[] = ["decides", "mentions", "gives_reason", "proposes"];
const FLAGS = ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "T2", "T6", "T10"];

export type AInputs = { records: SourceRecord[]; inHand: SourceRecord | null };

// Records written by as_of, in time order, plus the document in hand: whatever C's focusOf picks for the
// question. If it was written after as_of (a draft sent shortly after), it is passed separately and labelled.
export function aInputs(data: Dataset, vocab: Vocab, q: GoldQuestion): AInputs {
  const at = q.as_of ? asOfMs(q.as_of) : Number.POSITIVE_INFINITY;
  const records = data.records.filter((r) => Date.parse(r.source_recorded_at) <= at).sort((a, b) => Date.parse(a.source_recorded_at) - Date.parse(b.source_recorded_at) || a.record_id.localeCompare(b.record_id));
  const f = focusOf(q, at, new Docs(data, [], vocab), data);
  const doc = f.quote?.record ?? (f.invoice ? data.records.find((r) => r.source_type === "invoice" && r.row_key === f.invoice!.invoice_id) ?? null : null);
  const inHand = doc && !records.some((r) => r.record_id === doc.record_id) ? doc : null;
  return { records, inHand };
}

const PATTERNS = `P1 a promise or open item never closed that the document depends on
P2 an unexplained change between quote versions
P3 going in circles: versions repeat "need to determine the cause" with no finding
P4 a client rule still in force is broken
P5 a rejection blamed on price without the client saying so
P6 off the client's normal structure (lines, split, trip or lump-sum charges, amount range of approved quotes)
P7 an invoice that does not match the approved version
T2, T6, T10 are time tags (a decision logged late, a scheduled change, which rate applies on a date); name one only if the question turns on it.`;

export const A_SYSTEM = `You are the gatekeeper in a repair contractor's office, checking a quote or invoice before it goes out to the client.
You answer one question from the records below. Use only these records; quote words exactly as written.
Warnings you may raise:
${PATTERNS}
"cannot_tell" is allowed and expected when the records do not settle the question: say what is missing in "cannot_tell_because".
Never guess. A reason for a rejection or a change may only come from a record where someone gives that reason.
Return JSON only:
{"verdict":"warn|clear|cannot_tell","flags":["P1"],
"current":{"record_id":"rec-…","quote":"exact words","mode":"decides|gives_reason|proposes|mentions"} or null,
"in_effect":{"record_id":"…","quote":"…","mode":"…"} or null,
"reasons":[{"record_id":"…","quote":"…","mode":"…"}],
"cannot_tell_because":"…" or null}
"current" is the latest decision on what the question asks about; "in_effect" is what applies on the question's date; "reasons" are the records that support your answer.`;

const line = (r: SourceRecord) => `[${r.record_id}] ${r.source_type} by ${r.author} at ${r.source_recorded_at}: ${r.text}`;

export function aPrompt(q: GoldQuestion, inputs: AInputs): string {
  return [
    `Question (asked ${q.as_of ?? "now"}): ${q.question}`,
    `Records up to ${q.as_of ?? "now"} (${inputs.records.length}):\n${inputs.records.map(line).join("\n")}`,
    inputs.inHand ? `The document in hand (not sent yet):\n${line(inputs.inHand)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export type ARef = { record_id: string; quote: string; mode: CardMode };
export type AReply = { verdict: "warn" | "clear" | "cannot_tell"; flags: string[]; current: ARef | null; in_effect: ARef | null; reasons: ARef[]; cannot_tell_because: string | null };

const ref = (v: unknown, at: string): ARef => {
  const o = obj(v, at);
  return { record_id: str(o.record_id, `${at}.record_id`), quote: str(o.quote, `${at}.quote`), mode: oneOf(o.mode, MODES, `${at}.mode`) };
};

export function parseAReply(v: unknown): AReply {
  const o = obj(v, "reply");
  return {
    verdict: oneOf(o.verdict, ["warn", "clear", "cannot_tell"] as const, "verdict"),
    flags: arr(o.flags ?? [], "flags").map((f, i) => str(f, `flags[${i}]`)).filter((f) => FLAGS.includes(f)),
    current: o.current == null ? null : ref(o.current, "current"),
    in_effect: o.in_effect == null ? null : ref(o.in_effect, "in_effect"),
    reasons: arr(o.reasons ?? [], "reasons").map((r, i) => ref(r, `reasons[${i}]`)),
    cannot_tell_because: typeof o.cannot_tell_because === "string" && o.cannot_tell_because.trim() ? o.cannot_tell_because.trim() : null,
  };
}

// A's references become cards and are mapped to gold ids with the unchanged matchCards rule; an unmatched
// one keeps its own id and so counts as wrong. The result is the part of an Answer scoreQuestion reads.
export function aAnswer(reply: AReply, gold: DecisionCard[]): Pick<Answer, "flags" | "current_card" | "in_effect_card" | "reasons"> {
  const asCard = (r: ARef, id: string) => ({ card_id: id, record_id: r.record_id, quote: r.quote, mode: r.mode }) as DecisionCard;
  const refs: [string, ARef][] = [
    ...(reply.current ? [["a.current", reply.current] as [string, ARef]] : []),
    ...(reply.in_effect ? [["a.in_effect", reply.in_effect] as [string, ARef]] : []),
    ...reply.reasons.map((r, i) => [`a.reason.${i}`, r] as [string, ARef]),
  ];
  // matchCards is one-to-one, so current / in effect / reasons are matched separately (they may name the same card).
  const toGold = (id: string, r: ARef) => {
    const m = matchCards([asCard(r, id)], gold);
    return [...m].find(([, model]) => model === id)?.[0] ?? id;
  };
  const ids = new Map(refs.map(([id, r]) => [id, toGold(id, r)]));
  return {
    flags: reply.flags.map((pattern) => ({ pattern, evidence: [], details: {} })),
    current_card: reply.current ? ids.get("a.current")! : null,
    in_effect_card: reply.in_effect ? ids.get("a.in_effect")! : null,
    reasons: reply.reasons.map((_, i) => ids.get(`a.reason.${i}`)!),
  };
}

export async function askA(client: ModelClient, model: string, q: GoldQuestion, inputs: AInputs) {
  return client.json({ stage: "compare", agent: "GroupA", model, system: A_SYSTEM, user: aPrompt(q, inputs) }, parseAReply, 2);
}
