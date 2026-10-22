// Computes the hero-case numbers shown in the demo opening from the generated data.
// Deterministic, no model calls. Every number cites the record ids it was computed from.
// Run after `npm run generate:data`; writes eval/demo/hero_case.json.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const HERO_JOB = "WO-PW-05";
const HERO_QUESTIONS = ["q-p5-heron-why", "q-p5-heron-v4", "q-p7-heron-invoice"];

type Rec = { record_id: string; source_type: string; text: string; author: string; source_recorded_at: string; thread_id?: string; row_key?: string };
type Card = { card_id: string; record_id: string; mode: string; topic: string; scope: string; decided_by: string };
type Question = { question_id: string; as_of: string | null };
type Row = Record<string, string>;

const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const jsonl = <T>(rel: string): T[] => read(rel).split("\n").filter(Boolean).map((l) => JSON.parse(l) as T);

function csv(rel: string): Row[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const text = read(rel);
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") row.push(field), (field = "");
    else if (ch === "\n") row.push(field), rows.push(row), (row = []), (field = "");
    else if (ch !== "\r") field += ch;
  }
  const [header, ...body] = rows;
  return body.map((cols) => Object.fromEntries(header.map((h, i) => [h, cols[i] ?? ""])));
}

const records = jsonl<Rec>("data/records/records.jsonl");
const cards = jsonl<Card>("eval/gold/gold_cards.jsonl");
const questions = jsonl<Question>("eval/gold/gold_questions.jsonl");
const quotes = csv("data/tables/quote_versions.csv").filter((q) => q.work_order_id === HERO_JOB);
const events = csv("data/tables/submission_events.csv").filter((e) => e.work_order_id === HERO_JOB);
const invoices = csv("data/tables/invoices.csv").filter((i) => i.work_order_id === HERO_JOB);
const deciders = new Set(
  read("data/vocab.yaml")
    .split("deciders:")[1]
    .match(/p\.[a-z]{2}\.[a-z_]+/g) ?? [],
);

const recordFor = (type: string, key: string) => {
  const r = records.find((x) => x.source_type === type && x.row_key === key);
  if (!r) throw new Error(`no ${type} record for ${key}`);
  return r;
};
const fail = (msg: string): never => {
  throw new Error(`hero-numbers: ${msg}`);
};
// Day numbers use the local (America/Chicago) calendar date written in each timestamp.
const localDay = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000;
const money = (n: number) => Math.round(n * 100) / 100;

// Rejections: client decisions on the approval topic for this job, in decision order.
const rejectionCards = cards
  .filter((c) => c.scope === `job:${HERO_JOB}` && c.topic === "approval" && c.mode === "decides" && deciders.has(c.decided_by))
  .map((c) => ({ card: c, rec: records.find((r) => r.record_id === c.record_id)! }))
  .sort((a, b) => Date.parse(a.rec.source_recorded_at) - Date.parse(b.rec.source_recorded_at));
if (rejectionCards.length !== 3) fail(`expected 3 rejections, found ${rejectionCards.length}`);
const rejectedQuotes = quotes.filter((q) => q.status === "rejected");
if (rejectedQuotes.length !== 3) fail(`expected 3 rejected quote rows, found ${rejectedQuotes.length}`);

// "Today" for the case is the latest as_of among its gold questions.
const asOfs = questions.filter((q) => HERO_QUESTIONS.includes(q.question_id)).map((q) => q.as_of ?? fail("hero question without as_of"));
const today = asOfs.sort().at(-1)!;

// The first quote is the first submission event of the job (v1 was created, voided and re-sent).
const firstEvent = [...events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0];
const firstEventRec = recordFor("submission_event", firstEvent.event_id);

const byVersion = (v: string) => quotes.find((q) => q.version === v) ?? fail(`no version ${v}`);
const v1 = byVersion("1");
const v2 = byVersion("2");
const latest = [...quotes].sort((a, b) => +a.version - +b.version).at(-1)!;

// Unbilled stop-gap work: the field note gives hours and a part price; hours are priced at the latest labor rate on the job.
const stopGap = records.find((r) => r.thread_id === HERO_JOB && r.source_type === "field_note" && /stop-gap/i.test(r.text)) ?? fail("no stop-gap note");
const hours = Number(stopGap.text.match(/(\d+) hours/)?.[1] ?? fail("stop-gap hours not found"));
const part = Number(stopGap.text.match(/\$(\d+(?:\.\d+)?) cover/)?.[1] ?? fail("stop-gap part price not found"));
const rate = Number(
  csv("data/tables/quote_lines.csv").find((l) => l.quote_id === latest.quote_id && l.kind === "labor")?.unit_price ?? fail("no labor rate"),
);
const stopGapUsd = money(hours * rate + part);
if (invoices.length) fail("hero job has an invoice; held_usd assumes nothing is billed");
const heldUsd = money(stopGapUsd + Number(latest.total));

// Cross-check against what the operations note says, so the screen and the records cannot drift apart.
const heldNote = records.find((r) => r.thread_id === HERO_JOB && r.source_type === "internal_note" && /on hold/i.test(r.text)) ?? fail("no on-hold note");
const stated = [...heldNote.text.matchAll(/\$([\d,]+)/g)].map((m) => Number(m[1].replace(/,/g, "")));
if (!stated.includes(stopGapUsd) || !stated.includes(Number(latest.total))) {
  fail(`on-hold note states ${stated.join(", ")} but data computes ${stopGapUsd} and ${latest.total}`);
}

const notices = events.filter((e) => e.event === "notified").sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
const noticesBy = (iso: string) => notices.filter((e) => Date.parse(e.at) <= Date.parse(iso));

// A written reason would be a client card that gives a reason on this job, or a reason sentence on a rejection record.
const clientReasonCards = cards.filter(
  (c) => c.scope === `job:${HERO_JOB}` && c.mode === "gives_reason" && deciders.has(c.decided_by),
);
const rejectionCardIds = new Set(rejectionCards.map((x) => x.card.card_id));
const extraCardsOnRejections = cards.filter(
  (c) => rejectionCards.some((x) => x.rec.record_id === c.record_id) && !rejectionCardIds.has(c.card_id),
);
const reasonsWritten = clientReasonCards.length + extraCardsOnRejections.length;
if (reasonsWritten !== 0) fail(`expected no written reasons, found ${reasonsWritten}`);

const day = (iso: string) => localDay(iso) - localDay(firstEvent.at);
const out = {
  job: HERO_JOB,
  first_quote_at: firstEvent.at,
  today,
  note: "Day numbers are calendar days in America/Chicago since the first quote (day 0). Generated by scripts/hero-numbers.ts from data/ and eval/gold/; do not edit by hand.",
  held_usd: {
    value: heldUsd,
    method: `unbilled stop-gap (${hours} h x ${rate.toFixed(2)} + ${part.toFixed(2)} part = ${stopGapUsd.toFixed(2)}) + latest quote ${latest.quote_id} total ${latest.total} on hold; job has no invoice`,
    sources: [stopGap.record_id, recordFor("quote_version", latest.quote_id).record_id, heldNote.record_id],
  },
  days: {
    value: day(today),
    method: "first quote date to the case's today (latest as_of among the hero gold questions)",
    sources: [firstEventRec.record_id],
  },
  ...Object.fromEntries(
    rejectionCards.flatMap((x, i) => [
      [`d${i + 1}`, { value: day(x.rec.source_recorded_at), method: `day of rejection ${i + 1}`, sources: [x.rec.record_id, firstEventRec.record_id] }],
      [
        `n${i + 1}`,
        {
          value: noticesBy(x.rec.source_recorded_at).reduce((s, e) => s + Number(e.recipients_count), 0),
          method: `notices (notified events x recipients) sent to the client up to rejection ${i + 1}`,
          sources: noticesBy(x.rec.source_recorded_at).map((e) => recordFor("submission_event", e.event_id).record_id),
        },
      ],
    ]),
  ),
  delta_v2: {
    value: money(Number(v2.total) - Number(v1.total)),
    method: `${v2.quote_id} total ${v2.total} minus ${v1.quote_id} total ${v1.total}`,
    sources: [recordFor("quote_version", v1.quote_id).record_id, recordFor("quote_version", v2.quote_id).record_id],
  },
  reasons_written: {
    value: reasonsWritten,
    method: "client gives_reason cards on the job plus any non-decision card on a rejection record",
    sources: rejectionCards.map((x) => x.rec.record_id),
  },
};

mkdirSync(join(root, "eval/demo"), { recursive: true });
writeFileSync(join(root, "eval/demo/hero_case.json"), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, typeof v === "object" ? v.value : v])), null, 2));
