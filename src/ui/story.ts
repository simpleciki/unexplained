// The home page story: a curated job told as a call between the contractor's side and the client
// (data/stories/<job>.json). It is served only after every check below passes; any failure is a 500 with the
// reasons, never a silently wrong story. Checks: each text is the exact words of one of its records; each record
// exists and belongs to the job; each date matches its records' local dates (or, for a two-clock mark, the
// card's said-date and the record's written-date really differ as stated); each price equals the total of the
// quote version it names; the people, the closing invoice and the linked document exist.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Dataset, DecisionCard } from "../engine/types.ts";
import { shortDate } from "./findings.ts";

export type StoryMark = { kind: "noted" | "open"; text: string; said?: string; written?: string };
export type StoryEvent = {
  t: number;
  side: "contractor" | "client";
  date: string;
  who: string;
  record_ids: string[];
  text: string;
  price?: number;
  version?: string;
  invoice?: string;
  mark?: StoryMark;
};
export type Story = {
  job: string;
  contractor: { person: string; org: string; role: string };
  client: { person: string; role: string };
  tagline: string[];
  events: StoryEvent[];
  ending: { invoice: string; sub: string; link: { text: string; doc: string } };
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "4 Mar" -> ["4 Mar"]; "11–12 Mar" -> ["11 Mar", "12 Mar"]; "17 Mar call" -> ["17 Mar"]
export function daysOf(label: string): string[] | null {
  const m = label.match(/^(\d{1,2})(?:[–-](\d{1,2}))? ([A-Z][a-z]{2})(?: call)?$/);
  if (!m || !MONTHS.includes(m[3])) return null;
  const from = Number(m[1]);
  const to = m[2] ? Number(m[2]) : from;
  return Array.from({ length: to - from + 1 }, (_, i) => `${from + i} ${m[3]}`);
}

export function loadStoryFile(root: string, job: string): Story | null {
  if (!/^WO-[A-Z]{2}-\d{2}$/.test(job)) return null; // a job id, never a path
  const f = join(root, "data", "stories", `${job}.json`);
  return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as Story) : null;
}

export function validateStory(story: Story, job: string, data: Dataset, cards: DecisionCard[], people: { id: string }[]): string[] {
  const out: string[] = [];
  const recs = new Map(data.records.map((r) => [r.record_id, r]));
  const t = data.tables;
  if (story.job !== job) out.push(`story is for ${story.job}, not ${job}`);
  if (!t.workOrders.some((w) => w.work_order_id === job)) out.push(`unknown job ${job}`);
  for (const p of [story.contractor?.person, story.client?.person]) if (!people.some((x) => x.id === p)) out.push(`unknown person ${p}`);
  let lastT = -Infinity;
  story.events.forEach((e, i) => {
    const at = `event ${i + 1} (${e.date})`;
    if (!(e.t > lastT)) out.push(`${at}: events are not in time order`);
    lastT = e.t;
    if (e.side !== "contractor" && e.side !== "client") out.push(`${at}: side must be contractor or client`);
    if (!e.record_ids?.length) out.push(`${at}: no record_ids`);
    const rs = (e.record_ids ?? []).map((id) => recs.get(id));
    (e.record_ids ?? []).forEach((id, k) => {
      if (!rs[k]) out.push(`${at}: unknown record ${id}`);
      else if (rs[k]!.thread_id !== job) out.push(`${at}: ${id} belongs to ${rs[k]!.thread_id ?? "no job"}, not ${job}`);
    });
    if (!rs.some((r) => r && r.text.includes(e.text))) out.push(`${at}: the text is not the exact words of any of ${e.record_ids.join(", ")}`);
    const days = daysOf(e.date);
    if (!days) out.push(`${at}: unreadable date "${e.date}"`);
    else if (e.mark?.said || e.mark?.written) {
      // Two clocks: a card on the record was said on one day and written down on another.
      const said = e.mark.said ?? "";
      const written = e.mark.written ?? "";
      const ok = rs.some((r) => r && shortDate(r.source_recorded_at) === written && cards.some((c) => c.record_id === r.record_id && shortDate(c.decided_at) === said));
      if (said === written) out.push(`${at}: said and written are the same day`);
      if (!ok) out.push(`${at}: no card on ${e.record_ids.join(", ")} was said ${said} on a record written ${written}`);
      if (!days.includes(said)) out.push(`${at}: the date shows ${e.date} but the decision was said ${said}`);
      for (const d of [said, written]) if (!e.mark.text.includes(d)) out.push(`${at}: the mark does not name ${d}`);
    } else {
      for (const r of rs) if (r && !days.includes(shortDate(r.source_recorded_at))) out.push(`${at}: ${r.record_id} is dated ${shortDate(r.source_recorded_at)}, not ${e.date}`);
    }
    if (e.price !== undefined) {
      const q = t.quotes.find((x) => x.quote_id === e.version && x.work_order_id === job);
      if (!q) out.push(`${at}: price ${e.price} names no quote version of ${job}`);
      else if (Number(q.total) !== e.price) out.push(`${at}: price ${e.price} but ${q.quote_id} totals ${Number(q.total)}`);
    }
    if (e.invoice && !t.invoices.some((x) => x.invoice_id === e.invoice && x.work_order_id === job)) out.push(`${at}: ${e.invoice} is not an invoice of ${job}`);
  });
  if (!t.invoices.some((x) => x.invoice_id === story.ending?.invoice && x.work_order_id === job)) out.push(`ending: ${story.ending?.invoice} is not an invoice of ${job}`);
  const linked = story.ending?.link?.doc;
  if (!t.quotes.some((q) => q.quote_id === linked) && !t.invoices.some((i) => i.invoice_id === linked)) out.push(`ending: the linked document ${linked} does not exist`);
  return out;
}

// What GET /api/story returns: the validated story plus the names, organisation and closing amounts from the data.
export function storyResponse(story: Story, data: Dataset, people: { id: string; name: string; role: string }[]) {
  const t = data.tables;
  const w = t.workOrders.find((x) => x.work_order_id === story.job)!;
  const client = t.clients.find((c) => c.client_id === w.client_id);
  const inv = t.invoices.find((x) => x.invoice_id === story.ending.invoice)!;
  const person = (id: string) => people.find((p) => p.id === id)!;
  return {
    job: story.job,
    title: w.job_title,
    client_name: client?.name ?? w.client_id,
    contractor: { ...story.contractor, name: person(story.contractor.person).name },
    client: { ...story.client, name: person(story.client.person).name, org: client?.name ?? "" },
    tagline: story.tagline,
    events: story.events.map((e, i) => ({ order: i + 1, ...e })),
    // The invoice status column is end-of-period state: here it is the end of the story, which is what it means.
    ending: { ...story.ending, price: Number(inv.total), invoice_status: inv.status },
  };
}
