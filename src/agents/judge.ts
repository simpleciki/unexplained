// Judge.explained: does the client-facing quote text explain each changed line? A line counts as
// explained only if the model quotes words that really are in that quote's text (checked by code).
import type { LineChange } from "../engine/docs.ts";
import { normaliseText } from "../engine/verify.ts";
import type { ModelClient } from "../llm/client.ts";
import { arr, obj, str } from "../llm/json.ts";
import { RULES } from "./shared.ts";

const SYSTEM = `You check whether a quote sent to a client explains each change from the previous version.
Only the client-facing text of the new quote counts (its scope, line descriptions and cover note).
An internal note the client never sees does not explain anything to the client.
Rules:
${RULES}
Return JSON only: {"lines":[{"description":"<changed line>","explained":true|false,"quote":"exact words from the quote text that explain it, or empty"}]}`;

export type LineJudgment = { description: string; explained: boolean; quote: string; rejected_quote?: boolean };

export async function judgeExplained(
  client: ModelClient,
  model: string,
  changes: LineChange[],
  quoteText: string,
): Promise<{ lines: LineJudgment[]; clientExplanation: "present" | "absent" } | null> {
  const user = [
    `Changed lines:\n${changes.map((c) => `- ${c.change} ${c.kind} "${c.description}" (${c.delta >= 0 ? "+" : ""}${c.delta})`).join("\n")}`,
    `Client-facing quote text:\n"""${quoteText}"""`,
  ].join("\n\n");
  const r = await client.json(
    { stage: "answer", agent: "Judge.explained", model, system: SYSTEM, user },
    (v) =>
      arr(obj(v, "reply").lines, "lines").map((x, i) => {
        const o = obj(x, `lines[${i}]`);
        if (typeof o.explained !== "boolean") throw new Error(`lines[${i}].explained must be true or false`);
        return { description: str(o.description, `lines[${i}].description`), explained: o.explained, quote: typeof o.quote === "string" ? o.quote : "" };
      }),
    1,
  );
  if (!r.value) return null;
  const text = normaliseText(quoteText);
  const lines = r.value.map((l) => {
    const verbatim = l.quote.trim().length > 0 && text.includes(normaliseText(l.quote));
    return l.explained && !verbatim ? { ...l, explained: false, rejected_quote: true } : l;
  });
  return { lines, clientExplanation: lines.length && lines.every((l) => l.explained) ? "present" : "absent" };
}
