// What a question is about: its job, client, the quote version or invoice in focus.
// Read deterministically from the question's seats, as_of and explicit ids in its wording.
import type { Dataset, Row } from "./types.ts";
import type { Docs, Version } from "./docs.ts";
import { ms } from "./docs.ts";

export type QuestionInput = { question_id: string; question: string; as_of: string | null; seats: string[] };
export type Focus = {
  job: string | null;
  client: string | null;
  quote: Version | null;
  invoice: Row | null;
  invoiceQuestion: boolean;
};

const DAY = 86_400_000;
const QUOTE_WORDS = /\b(quotes?|versions?|v\d+|send|upload|resend|reject\w*|turned down|normally approves?|costs?)\b/i;

export function focusOf(q: QuestionInput, asOf: number, docs: Docs, data: Dataset): Focus {
  const job = q.seats.find((s) => s.startsWith("job:"))?.slice(4) ?? null;
  const client = q.seats.find((s) => s.startsWith("client:"))?.slice(7) ?? (job ? docs.clientOf.get(job) ?? null : null);
  const invoiceQuestion = /\b(invoice|INV-[A-Z]{2}-\d{2}|bill)\b/i.test(q.question);
  if (!job) return { job, client, quote: null, invoice: null, invoiceQuestion };

  if (invoiceQuestion) {
    const named = q.question.match(/\bINV-[A-Z]{2}-\d{2}\b/)?.[0];
    const invoices = data.tables.invoices.filter((i) => i.work_order_id === job).sort((a, b) => ms(a.issued_at) - ms(b.issued_at));
    const invoice =
      invoices.find((i) => i.invoice_id === named) ??
      invoices.filter((i) => ms(i.issued_at) <= asOf).at(-1) ??
      invoices.find((i) => ms(i.issued_at) > asOf && ms(i.issued_at) - asOf <= DAY) ??
      null;
    return { job, client, quote: null, invoice, invoiceQuestion };
  }

  const all = docs.versionsOf(job);
  // "between v1 and v2" is about v2: take the highest version the question names.
  const named = [...q.question.matchAll(/\bv(\d+)\b/gi)].map((m) => Number(m[1]));
  let quote = named.length ? all.filter((v) => v.version === Math.max(...named)).at(-1) ?? null : null;
  if (!quote && /\b(send|upload|resend|file|submit)\b/i.test(q.question)) {
    // "Before I send ..." — the draft in hand is the next version sent within a day.
    quote = all.find((v) => v.at > asOf && v.at - asOf <= DAY) ?? null;
  }
  // Otherwise only a question that is about a quote gets the latest one as its focus.
  if (!quote && QUOTE_WORDS.test(q.question)) quote = all.filter((v) => v.at <= asOf).at(-1) ?? null;
  return { job, client, quote, invoice: null, invoiceQuestion };
}
