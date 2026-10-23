// "Effective from" for a card a person keeps: prefilled from a time phrase in the selected words (the
// existing parser in src/engine/timephrase.ts does the date), otherwise the message time. The person can
// change it; this only suggests, and says where the suggestion came from.
import { parsePhrase } from "../engine/timephrase.ts";

const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*";
// "1 May 2026", "17th of March at 09:20", "May 1, 2026", "2026-05-01"
const PHRASES = [
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}(?:,?\\s+\\d{4})?(?:\\s+at\\s+\\d{1,2}:\\d{2})?`, "i"),
  new RegExp(`\\b${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?`, "i"),
  /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2})?\b/,
];
// Words that make the date an end, not a start: "until 1 June" applies now and stops then.
const END_WORDS = /\b(until|till|before|through|by)\s+(?:the\s+)?$/i;

export type EffectiveSuggestion = { iso: string; from: string; phrase: string | null };

export function suggestEffective(quote: string, recordIso: string): EffectiveSuggestion {
  for (const re of PHRASES) {
    const m = quote.match(re);
    if (!m || m.index === undefined) continue;
    const r = parsePhrase(m[0], recordIso);
    if (r.source !== "phrase") continue;
    if (END_WORDS.test(quote.slice(0, m.index))) {
      return { iso: recordIso, from: `the message time ("${quote.slice(0, m.index).match(END_WORDS)![1]} ${m[0]}" marks an end, not a start)`, phrase: m[0] };
    }
    return { iso: r.iso, from: `the words "${m[0]}"`, phrase: m[0] };
  }
  return { iso: recordIso, from: "the message time", phrase: null };
}

// What the form sends ("2026-05-01T00:00") -> ISO with the Chicago offset of that date; null if unreadable.
export function effectiveFromForm(value: string, recordIso: string): string | null {
  const r = parsePhrase(value, recordIso);
  return r.source === "phrase" ? r.iso : null;
}
