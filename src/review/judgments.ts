// Human judgments: review/judgments.jsonl, append-only. A new judgment for a record appends and supersedes
// the previous one (the latest wins); nothing is ever rewritten or deleted, so every decision stays
// traceable. This is reviewer data, never gold: eval/gold/ is not touched.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseJsonl } from "../engine/data.ts";
import type { CardMode, DecisionCard, RelationEdge, SourceRecord } from "../engine/types.ts";
import type { Vocab } from "../engine/vocab.ts";
import { effectiveFromForm } from "./effective.ts";

const MODES: CardMode[] = ["decides", "mentions", "gives_reason", "proposes"];

// effective: when the decision starts to apply (ISO with offset; the form sends "YYYY-MM-DDTHH:MM" and it is
// stored with the offset of that date). Absent on older judgments: the record time is used.
// open_question: the person keeps the card but has a doubt; it stays an open item until a later judgment
// for the record drops it.
export type JudgedCard = { mode: CardMode; quote: string; decided_by: string; topic?: string; facets?: string[]; scope?: string; effective?: string; open_question?: string };
export type Judgment = {
  judgment_id: string;
  record_id: string;
  verdict: "cards" | "no_decision";
  cards: JudgedCard[];
  reason: string;
  reviewer: string;
  judged_at: string;
  supersedes?: string;
};
export type JudgmentInput = Omit<Judgment, "judgment_id" | "judged_at" | "supersedes">;

export const judgmentsPath = (root: string) => join(root, "review", "judgments.jsonl");

export function loadJudgments(root: string): Judgment[] {
  const f = judgmentsPath(root);
  return existsSync(f) ? parseJsonl<Judgment>(readFileSync(f, "utf8")) : [];
}

// Latest judgment per record (file order is time order: the file is append-only).
export function latestPerRecord(judgments: Judgment[]): Map<string, Judgment> {
  const out = new Map<string, Judgment>();
  for (const j of judgments) out.set(j.record_id, j);
  return out;
}

// Local wall-clock time with its UTC offset, e.g. 2026-10-23T07:41:05-05:00.
export function localIso(d: Date): string {
  const p = (n: number) => String(Math.abs(n)).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${off >= 0 ? "+" : "-"}${p(Math.trunc(off / 60))}:${p(off % 60)}`;
}

// Every problem with a judgment, or [] when it can be stored. A missing topic is taken from the model's
// card on the same record that shares the most words with the quote; with no such card it must be given.
export function validateJudgment(input: JudgmentInput, records: SourceRecord[], vocab: Vocab, modelCards: DecisionCard[] = []): string[] {
  const out: string[] = [];
  const rec = records.find((r) => r.record_id === input.record_id);
  if (!rec) return [`unknown record ${input.record_id}`];
  if (!input.reason?.trim()) out.push("a reason is required");
  if (!input.reviewer?.trim()) out.push("a reviewer name is required");
  if (input.verdict !== "cards" && input.verdict !== "no_decision") out.push(`verdict must be "cards" or "no_decision"`);
  if (input.verdict === "no_decision" && input.cards?.length) out.push('"no_decision" carries no cards');
  if (input.verdict === "cards" && !input.cards?.length) out.push('"cards" needs at least one card');
  for (const [i, c] of (input.cards ?? []).entries()) {
    if (!MODES.includes(c.mode)) out.push(`cards[${i}]: unknown mode ${c.mode}`);
    if (!c.quote || !rec.text.includes(c.quote)) out.push(`cards[${i}]: the quote must be exact words from ${rec.record_id}`);
    if (!c.decided_by?.trim()) out.push(`cards[${i}]: who decided is required`);
    const topic = c.topic ?? topicFromModel(c.quote, rec.record_id, modelCards)?.topic;
    if (!topic) out.push(`cards[${i}]: say which topic (${[...vocab.topics].join(", ")})`);
    else if (!vocab.topics.has(topic)) out.push(`cards[${i}]: unknown topic ${topic}`);
    for (const f of c.facets ?? []) if (!vocab.facets.has(f)) out.push(`cards[${i}]: unknown facet ${f}`);
    if (c.scope && !vocab.scopes.has(c.scope)) out.push(`cards[${i}]: unknown scope ${c.scope}`);
    if (c.effective !== undefined && !effectiveFromForm(c.effective, rec.source_recorded_at)) out.push(`cards[${i}]: "effective from" is not a date and time: ${c.effective}`);
  }
  return out;
}

function topicFromModel(quote: string, recordId: string, modelCards: DecisionCard[]): DecisionCard | undefined {
  const words = (s: string) => new Set(s.toLowerCase().split(/\W+/).filter(Boolean));
  const q = words(quote ?? "");
  let best: { c: DecisionCard; n: number } | undefined;
  for (const c of modelCards.filter((m) => m.record_id === recordId)) {
    const n = [...words(c.quote)].filter((w) => q.has(w)).length;
    if (n && (!best || n > best.n)) best = { c, n };
  }
  return best?.c;
}

// Validate and append. judged_at is this machine's local clock at the moment the person submits (not when
// the record was written, not when the file is read), so the judgment's own time is never guessed.
export function appendJudgment(root: string, input: JudgmentInput, records: SourceRecord[], vocab: Vocab, modelCards: DecisionCard[] = [], now = new Date()): Judgment {
  const problems = validateJudgment(input, records, vocab, modelCards);
  if (problems.length) throw new Error(`judgment rejected: ${problems.join("; ")}`);
  const all = loadJudgments(root);
  const previous = latestPerRecord(all).get(input.record_id);
  const n = all.filter((j) => j.record_id === input.record_id).length + 1;
  const rec = records.find((r) => r.record_id === input.record_id)!;
  const cards = input.verdict === "cards"
    ? input.cards.map((c) => {
        const m = c.topic ? undefined : topicFromModel(c.quote, input.record_id, modelCards);
        const { open_question, effective, ...rest } = c;
        const question = open_question?.trim();
        return {
          ...rest,
          topic: c.topic ?? m!.topic,
          facets: c.facets ?? m?.facets ?? [],
          ...(effective !== undefined ? { effective: effectiveFromForm(effective, rec.source_recorded_at)! } : {}),
          ...(question ? { open_question: question } : {}),
        };
      })
    : [];
  const j: Judgment = {
    judgment_id: `j.${input.record_id}.${n}`,
    record_id: input.record_id,
    verdict: input.verdict,
    cards,
    reason: input.reason.trim(),
    reviewer: input.reviewer.trim(),
    judged_at: localIso(now),
    ...(previous ? { supersedes: previous.judgment_id } : {}),
  };
  mkdirSync(join(root, "review"), { recursive: true });
  appendFileSync(judgmentsPath(root), JSON.stringify(j) + "\n");
  return j;
}

// Engine cards with judgments applied: a judged record uses the person's cards (source "human") in place of
// the model's; "no_decision" leaves it with none. Edges that touched a replaced model card are dropped.
// Human cards get no Keeper relations (that would need a model call); they enter the seat graph as
// independent cards. Fine for now: ask and eval:live rebuild the engine with them; state/seats.json stays
// the model's view.
export function applyJudgments(modelCards: DecisionCard[], edges: RelationEdge[], judgments: Judgment[], records: SourceRecord[]) {
  const latest = latestPerRecord(judgments);
  const recs = new Map(records.map((r) => [r.record_id, r]));
  const human: DecisionCard[] = [];
  for (const j of latest.values()) {
    const rec = recs.get(j.record_id);
    if (!rec) continue;
    j.cards.forEach((c, i) =>
      human.push({
        card_id: `h.${j.judgment_id}.${i}`,
        record_id: j.record_id,
        quote: c.quote,
        mode: c.mode,
        topic: c.topic ?? "",
        facets: c.facets ?? [],
        scope: c.scope ?? (rec.thread_id ? `job:${rec.thread_id}` : "global"),
        decided_at: rec.source_recorded_at, // when it was said
        effective: c.effective ?? rec.source_recorded_at, // when it applies; older judgments have no effective
        decided_by: c.decided_by,
        source: "human",
        judgment_id: j.judgment_id,
      }),
    );
  }
  const kept = modelCards.filter((c) => !latest.has(c.record_id));
  const ids = new Set(kept.map((c) => c.card_id));
  return {
    cards: [...kept, ...human],
    edges: edges.filter((e) => ids.has(e.old_card) && ids.has(e.new_card)),
    human,
  };
}

// The judgments a record's latest one replaced, oldest first (the file is append-only, so nothing is lost).
export function historyOf(judgments: Judgment[], recordId: string): Judgment[] {
  return judgments.filter((j) => j.record_id === recordId).slice(0, -1);
}

// Open questions on the latest judgment of each record: the person kept a card but has a doubt.
export function openQuestions(judgments: Judgment[]): { record_id: string; reviewer: string; judged_at: string; question: string }[] {
  return [...latestPerRecord(judgments).values()].flatMap((j) =>
    j.cards.filter((c) => c.open_question).map((c) => ({ record_id: j.record_id, reviewer: j.reviewer, judged_at: j.judged_at, question: c.open_question! })),
  );
}

// "confirmed by Ciki on 2026-10-23: <reason>" for a human card; undefined for a model card.
export function confirmation(card: DecisionCard, judgments: Judgment[]): string | undefined {
  if (card.source !== "human") return undefined;
  const j = judgments.find((x) => x.judgment_id === card.judgment_id);
  return j ? `confirmed by ${j.reviewer} on ${j.judged_at.slice(0, 10)}: ${j.reason}` : undefined;
}
