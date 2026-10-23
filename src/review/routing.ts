// Where each record goes after ingest. The promise is not "the model is always right"; it is "nothing is
// silently dropped": a record the system cannot vouch for goes to a person with its original text.
// Rules, first match wins:
//   0. a person has judged the record                     -> human_confirmed (the latest judgment wins)
//   1. the run stopped before the record                  -> needs_human
//   2. the model service failed on it                     -> needs_human
//   3. the model answered in prose, not cards             -> needs_human
//   4. no valid reply for another reason                  -> needs_human
//   5. a card quoted words that are not in the record     -> needs_human
//   6. the checker dropped a card as unsupported          -> needs_human
//   7. cards that passed the gate and the checker         -> auto_cards
//   8. no cards, and the record is a field note           -> auto_empty (field notes are work logs)
//   9. no cards, any other type                           -> needs_human (client messages and office notes
//      are where decisions are made; an empty answer there is never trusted on its own)
// Rule 9 was set after measuring the first full ingest: the model said "nothing here" on 59 records and
// was wrong on 26, almost all client messages and internal notes; its justification is what the record
// types mean, not the numbers.
import type { SourceType } from "../engine/types.ts";

export type Bucket = "auto_cards" | "auto_empty" | "needs_human" | "human_confirmed";
export const BUCKETS: Bucket[] = ["auto_cards", "auto_empty", "needs_human", "human_confirmed"];

export type RecordOutcome = {
  record_id: string;
  source_type: SourceType;
  reached: boolean;
  cards: number;
  failed_upstream?: string;
  prose: boolean;
  rejected?: string;
  gate_rejected: number;
  skeptic_dropped: number;
  judged?: { reviewer: string; judged_at: string; reason: string; verdict: "cards" | "no_decision"; open_questions?: string[] };
};

export function routeRecord(o: RecordOutcome): { bucket: Bucket; why: string } {
  if (o.judged) {
    const what = o.judged.verdict === "cards" ? "cards kept" : "nothing to keep, judged";
    const q = o.judged.open_questions?.length ? ` (open question: ${o.judged.open_questions.join("; ")})` : "";
    return { bucket: "human_confirmed", why: `${what} by ${o.judged.reviewer} on ${o.judged.judged_at.slice(0, 10)}: ${o.judged.reason}${q}` };
  }
  if (!o.reached) return { bucket: "needs_human", why: "the run stopped before this record" };
  if (o.failed_upstream) {
    const msg = o.failed_upstream.match(/"message":"([^"]+)"/)?.[1] ?? o.failed_upstream; // the runtime's own message when the error is JSON
    return { bucket: "needs_human", why: `the model service failed: ${msg.slice(0, 120)}` };
  }
  if (o.prose) return { bucket: "needs_human", why: "the model answered in prose instead of cards, after retries" };
  if (o.rejected) return { bucket: "needs_human", why: `no valid reply: ${o.rejected.slice(0, 120)}` };
  if (o.gate_rejected) return { bucket: "needs_human", why: `${o.gate_rejected} card(s) quoted words that are not in the record` };
  if (o.skeptic_dropped) return { bucket: "needs_human", why: `the checker dropped ${o.skeptic_dropped} card(s) as unsupported` };
  if (o.cards) return { bucket: "auto_cards", why: `${o.cards} card(s) passed the quote gate and the checker` };
  if (o.source_type === "field_note") return { bucket: "auto_empty", why: "field note with no decision (a work log)" };
  return { bucket: "needs_human", why: `the model found no decision in this ${o.source_type.replace("_", " ")}; a person should confirm` };
}
