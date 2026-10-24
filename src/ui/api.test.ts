// The gatekeeper API through route() (no network, no model): a temporary repo copy with data/, the vocab,
// and a small invented state/ so judgments are written to the copy, never to the real review/ folder.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadDataset } from "../engine/data.ts";
import { extractableRecords } from "../pipeline/ingest.ts";
import { loadIngested } from "../pipeline/ingest.ts";
import { loadCtx, summary } from "./api.ts";
import { route } from "./server.ts";

const repo = join(import.meta.dirname, "../..");

function setup() {
  const root = mkdtempSync(join(tmpdir(), "unexplained-ui-"));
  cpSync(join(repo, "data"), join(root, "data"), { recursive: true });
  const data = loadDataset(root);
  const records = extractableRecords(data.records);
  // An ingest that reached every record and produced one card, on rec-0005 ("Approved as sent at $92 an hour.").
  const card = { card_id: "m.rec-0005.0.0", record_id: "rec-0005", quote: "Approved as sent at $92 an hour.", mode: "decides", topic: "approval", facets: ["approval.status"], scope: "job:WO-NL-01", decided_at: "2026-03-05T07:40:00-06:00", effective: "2026-03-05T07:40:00-06:00", decided_by: "p.nl.ria_moth" };
  mkdirSync(join(root, "state"));
  writeFileSync(join(root, "state/cards.json"), JSON.stringify([card]));
  writeFileSync(join(root, "state/edges.json"), "[]");
  writeFileSync(join(root, "state/ingest-report.json"), JSON.stringify({ records_total: records.length, records_done: records.length, records_rejected: [], records_prose_reply: [], records_failed_upstream: [], cards_gate_rejected: [], cards_dropped_by_skeptic: [] }));
  return { root, box: { ctx: loadCtx(root, data), html: "<html>ui</html>" }, records };
}
const get = (box: Parameters<typeof route>[0], url: string) => {
  const r = route(box, "GET", url);
  return { status: r.status, body: r.type === "json" ? JSON.parse(r.body) : r.body };
};

describe("gatekeeper API", () => {
  it("serves the page, the ledger and the jobs with their documents", () => {
    const { box, records } = setup();
    expect(get(box, "/").body).toBe("<html>ui</html>");
    const l = get(box, "/api/ledger").body;
    expect(l.complete).toBe(true);
    expect(l.total).toBe(records.length);
    expect(l.line).toMatch(/^\d+ records = 1 auto \+ \d+ empty \(open for spot-check\) \+ \d+ need you \+ 0 confirmed; unaccounted: 0$/);
    const jobs = get(box, "/api/jobs").body;
    const nl01 = jobs.find((j: { job: string }) => j.job === "WO-NL-01");
    expect(nl01.docs.map((d: { id: string }) => d.id)).toEqual(["Q-NL-01-v1", "Q-NL-01-v2", "Q-NL-01-v3", "INV-NL-01"]);
    expect(nl01.needs_human).toBeGreaterThan(0);
  });

  it("checks a document: every warning carries the source record text of its evidence, plus the job's queue", () => {
    const { box } = setup();
    const c = get(box, "/api/check?doc=INV-NL-04");
    expect(c.status).toBe(200);
    expect(c.body.doc).toMatchObject({ id: "INV-NL-04", kind: "invoice", job: "WO-NL-04", at: "2026-05-04 10:30" });
    expect(c.body.cutoff).toBe("records up to 10:29, just before this invoice was issued");
    expect(JSON.stringify(c.body)).not.toMatch(/UTC/);
    expect(c.body.warnings.map((w: { pattern: string }) => w.pattern)).toEqual(["P1", "P2", "P3", "P4", "P5", "P6", "P7"]);
    for (const w of c.body.warnings) for (const e of w.evidence) expect(typeof e.source.text).toBe("string");
    expect(c.body.queue.needs_human.every((x: { job: string }) => x.job === "WO-NL-04")).toBe(true);
    expect(c.body.queue.spot_check.every((x: { bucket: string }) => x.bucket === "auto_empty")).toBe(true);
    expect(get(box, "/api/check?doc=Q-XX-99").status).toBe(404);
  });

  it("never says Clear while a job record before the document is unjudged; does once they are all judged", () => {
    const { box } = setup();
    const doc = "Q-NL-01-v1"; // submitted 2026-03-04T09:15:00-06:00; no earlier version, so P2 has nothing open
    const before = get(box, `/api/check?doc=${doc}`).body;
    expect(before.warnings.filter((w: { fired: boolean }) => w.fired)).toEqual([]);
    expect(before.records.unjudged).toBeGreaterThan(0);
    expect(before.verdict.state).toBe("not_cleared");
    expect(before.verdict.notes[0]).toMatch(/not judged yet; the result can change/);
    expect(before.warnings.find((w: { pattern: string }) => w.pattern === "P1").status).toBe(`no evidence in the ${before.records.read} of ${before.records.seen} records read; ${before.records.spot_check} read as empty, not spot-checked`);
    expect(before.cutoff).toBe("records up to 09:14, just before this quote was submitted");
    expect(before.doc.at).toBe("2026-03-04 09:15");
    const cutoff = Date.parse("2026-03-04T09:15:00-06:00");
    const open = before.queue.needs_human.filter((x: { recorded_at: string }) => Date.parse(x.recorded_at) < cutoff);
    expect(open).toHaveLength(before.records.unjudged);
    for (const x of open) {
      const r = route(box, "POST", "/api/judgments", JSON.stringify({ record_id: x.record_id, verdict: "no_decision", cards: [], reason: "read it: no decision here", reviewer: "Ciki" }));
      expect(r.status).toBe(201);
    }
    // Judged, but records the model read as empty are still open: not clear until a person spot-checks them.
    const mid = get(box, `/api/check?doc=${doc}`).body;
    expect(mid.records.unjudged).toBe(0);
    expect(mid.records.spot_check).toBeGreaterThan(0);
    expect(mid.verdict.state).toBe("not_cleared");
    expect(mid.verdict.notes).toEqual([`${mid.records.spot_check} record${mid.records.spot_check > 1 ? "s" : ""} the model read as empty need${mid.records.spot_check > 1 ? "" : "s"} a person to spot-check before this can clear`]);
    expect(mid.warnings.find((w: { pattern: string }) => w.pattern === "P1").status).toMatch(/; \d+ read as empty, not spot-checked$/);
    for (const x of mid.queue.spot_check) {
      const r = route(box, "POST", "/api/judgments", JSON.stringify({ record_id: x.record_id, verdict: "no_decision", cards: [], reason: "spot-checked: a work log, no decision", reviewer: "Ciki" }));
      expect(r.status).toBe(201);
    }
    const after = get(box, `/api/check?doc=${doc}`).body;
    expect(after.records).toMatchObject({ unjudged: 0, spot_check: 0 });
    expect(after.verdict.state).toBe("clear");
    expect(after.verdict.text).toBe("Clear — every record in this job is accounted for and judged");
    // This fixture has no approved quote, so P6 says it cannot judge the client's usual structure (task 017).
    expect(after.warnings.find((w: { pattern: string }) => w.pattern === "P6").status).toMatch(/^not enough history to judge this client's usual structure/);
    expect(after.warnings.filter((w: { pattern: string }) => w.pattern !== "P6").every((w: { status: string }) => w.status === "clear")).toBe(true);
  });

  it("an open P2 (needs the Judge) also keeps the verdict from Clear", () => {
    const { box } = setup();
    const c = get(box, "/api/check?doc=Q-NL-01-v2").body;
    expect(c.warnings.find((w: { pattern: string }) => w.pattern === "P2").open).toBe(true);
    expect(c.verdict.state).not.toBe("clear");
    expect(c.verdict.notes.join()).toMatch(/P2 .* needs the Judge model step/);
  });

  it("prefills effective from a time phrase in the quote; the human card carries it; an edit is stored", () => {
    const { box } = setup();
    const quote = "Electrical labor for North Loft is $98 per hour from 1 May 2026.";
    const pre = get(box, `/api/effective?record=rec-0017&quote=${encodeURIComponent(quote)}`).body;
    expect(pre).toMatchObject({ iso: "2026-05-01T00:00:00-05:00", from: 'the words "1 May 2026"', local: "2026-05-01 00:00" });
    const noPhrase = get(box, `/api/effective?record=rec-0017&quote=${encodeURIComponent("Leave material pricing as already approved.")}`).body;
    expect(noPhrase).toMatchObject({ iso: "2026-04-08T07:55:00-05:00", from: "the message time" });
    const post = (cards: unknown[]) => route(box, "POST", "/api/judgments", JSON.stringify({ record_id: "rec-0017", verdict: "cards", cards, reason: "rate from 1 May; material unchanged", reviewer: "Ciki" }));
    // Two quote rows -> two cards: the second decision in the record gets its own card.
    const r = post([
      { mode: "decides", quote, decided_by: "p.nl.ria_moth", topic: "price", effective: "2026-05-01T00:00" },
      { mode: "decides", quote: "Leave material pricing as already approved.", decided_by: "p.nl.ria_moth", topic: "price" },
    ]);
    expect(r.status).toBe(201);
    const human = box.ctx.engine.cards.filter((c) => c.record_id === "rec-0017");
    expect(human.map((c) => [c.quote, c.effective, c.decided_at])).toEqual([
      [quote, "2026-05-01T00:00:00-05:00", "2026-04-08T07:55:00-05:00"],
      ["Leave material pricing as already approved.", "2026-04-08T07:55:00-05:00", "2026-04-08T07:55:00-05:00"],
    ]);
    // An edited date is stored as edited (with the offset of that date).
    expect(post([{ mode: "decides", quote, decided_by: "p.nl.ria_moth", topic: "price", effective: "2026-05-15T08:30" }]).status).toBe(201);
    expect(box.ctx.engine.cards.find((c) => c.record_id === "rec-0017")!.effective).toBe("2026-05-15T08:30:00-05:00");
    expect(JSON.parse(post([{ mode: "decides", quote, decided_by: "p.nl.ria_moth", topic: "price", effective: "soon" }]).body).errors.join()).toMatch(/not a date/);
  });

  it("an open question keeps the card and turns a would-be Clear into Not cleared with the note", () => {
    const { box } = setup();
    const doc = "Q-NL-01-v1";
    const open = get(box, `/api/check?doc=${doc}`).body.queue.needs_human.filter((x: { recorded_at: string }) => Date.parse(x.recorded_at) < Date.parse("2026-03-04T09:15:00-06:00"));
    const [first, ...rest] = open;
    for (const x of rest) route(box, "POST", "/api/judgments", JSON.stringify({ record_id: x.record_id, verdict: "no_decision", cards: [], reason: "read it", reviewer: "Ciki" }));
    for (const x of get(box, `/api/check?doc=${doc}`).body.queue.spot_check) route(box, "POST", "/api/judgments", JSON.stringify({ record_id: x.record_id, verdict: "no_decision", cards: [], reason: "spot-checked", reviewer: "Ciki" }));
    const words = first.text.split(/(?<=\.)\s/)[0];
    const r = route(box, "POST", "/api/judgments", JSON.stringify({ record_id: first.record_id, verdict: "cards", cards: [{ mode: "mentions", quote: words, decided_by: first.author, topic: "scope", open_question: "which split is usual here?" }], reason: "keep it, but ask", reviewer: "Ciki" }));
    expect(r.status).toBe(201);
    expect(box.ctx.engine.cards.some((c) => c.record_id === first.record_id && c.source === "human")).toBe(true);
    const c = get(box, `/api/check?doc=${doc}`).body;
    expect(c.records.unjudged).toBe(0);
    expect(c.verdict.state).toBe("not_cleared");
    expect(c.verdict.notes).toEqual([expect.stringMatching(new RegExp(`^Open question \\(Ciki, \\d+/\\d+\\) on ${first.record_id}: which split is usual here\\?$`))]);
    // Resolving it = a new judgment for that record without the question.
    route(box, "POST", "/api/judgments", JSON.stringify({ record_id: first.record_id, verdict: "cards", cards: [{ mode: "mentions", quote: words, decided_by: first.author, topic: "scope" }], reason: "answered", reviewer: "Ciki" }));
    expect(get(box, `/api/check?doc=${doc}`).body.verdict.state).toBe("clear");
  });

  it("returns the superseded history for a re-judged record", () => {
    const { box } = setup();
    route(box, "POST", "/api/judgments", JSON.stringify({ record_id: "rec-0011", verdict: "no_decision", cards: [], reason: "hours not stated", reviewer: "Ciki" }));
    route(box, "POST", "/api/judgments", JSON.stringify({ record_id: "rec-0011", verdict: "cards", cards: [{ mode: "decides", quote: "Ok on the extra ground hours. Approved.", decided_by: "p.nl.ria_moth", topic: "approval", open_question: "how many hours?" }], reason: "approved, hours not stated", reviewer: "Ciki" }));
    const item = get(box, "/api/queue?job=WO-NL-01").body.confirmed.find((x: { record_id: string }) => x.record_id === "rec-0011");
    expect(item.judgment).toMatchObject({ judgment_id: "j.rec-0011.2", supersedes: "j.rec-0011.1" });
    expect(item.history).toEqual([expect.objectContaining({ judgment_id: "j.rec-0011.1", verdict: "no_decision", types: [], reason: "hours not stated" })]);
    expect(item.why).toMatch(/open question: how many hours\?/);
  });

  it("a Decision by a non-decider is warned, stored as submitted, and loads with mode_used mentions", () => {
    const { root, box } = setup();
    const r = route(box, "POST", "/api/judgments", JSON.stringify({ record_id: "rec-0284", verdict: "cards", cards: [{ mode: "decides", quote: "Tallow Creek jobs only this spring.", decided_by: "p.hw.delia_vorn", topic: "client_rule" }], reason: "an office rule", reviewer: "Ciki" }));
    expect(r.status).toBe(201);
    const out = JSON.parse(r.body);
    expect(out.warnings).toEqual([{ card: 0, decided_by: "p.hw.delia_vorn", topic: "client_rule", mode_used: "mentions", text: "Delia Vorn is not a client decider for client_rule. The system will read this card as Mentions." }]);
    // Stored as the reviewer chose it.
    const line = JSON.parse(readFileSync(join(root, "review/judgments.jsonl"), "utf8").trim().split("\n").at(-1)!);
    expect(line.cards[0].mode).toBe("decides");
    // Loaded: the human card keeps the chosen mode and says what the engine uses.
    const human = loadIngested(root).cards.find((c) => c.record_id === "rec-0284")!;
    expect(human).toMatchObject({ mode: "decides", mode_used: "mentions", source: "human" });
    // The confirmed view carries both, with the reason.
    const item = get(box, "/api/queue?job=WO-NL-01").body.confirmed.find((x: { record_id: string }) => x.record_id === "rec-0284");
    expect(item.card_modes).toEqual([{ chosen: "decides", used: "mentions", why: "Delia Vorn is not a client decider for client_rule" }]);
  });

  it("a Decision by a listed client decider has no warning and no mode_used", () => {
    const { root, box } = setup();
    const r = route(box, "POST", "/api/judgments", JSON.stringify({ record_id: "rec-0011", verdict: "cards", cards: [{ mode: "decides", quote: "Ok on the extra ground hours. Approved.", decided_by: "p.nl.ria_moth", topic: "approval" }], reason: "client approves", reviewer: "Ciki" }));
    expect(JSON.parse(r.body).warnings).toEqual([]);
    const human = loadIngested(root).cards.find((c) => c.record_id === "rec-0011")!;
    expect(human.mode).toBe("decides");
    expect(human).not.toHaveProperty("mode_used");
    const item = get(box, "/api/queue?job=WO-NL-01").body.confirmed.find((x: { record_id: string }) => x.record_id === "rec-0011");
    expect(item.card_modes).toEqual([{ chosen: "decides", used: "decides", why: null }]);
  });

  it("evidence for a firing pattern shows a human card's chosen mode, the mode used and why", () => {
    const { box } = setup();
    const post = (b: unknown) => expect(route(box, "POST", "/api/judgments", JSON.stringify(b)).status).toBe(201);
    // An open promise (the riser ground) on WO-NL-01 ...
    post({ record_id: "rec-0006", verdict: "cards", reason: "a promise to check the riser", reviewer: "Ciki", cards: [{ mode: "proposes", quote: "Once he opens the gutter we'll see if the studio riser needs its own isolated ground", decided_by: "p.hw.mira_kell", topic: "open_item", facets: ["open_item.inspection"] }] });
    // ... and a later field finding kept as a Decision by the technician: the decider rule uses it as Mentions,
    // which makes it a follow-up of the open item, cited by P1 when v2 prices the riser ground.
    post({ record_id: "rec-0007", verdict: "cards", reason: "the finding", reviewer: "Ciki", cards: [{ mode: "decides", quote: "Studio riser does need an isolated ground.", decided_by: "p.hw.cal_rhees", topic: "scope", facets: ["open_item.inspection"] }] });
    const c = get(box, "/api/check?doc=Q-NL-01-v2").body;
    const p1 = c.warnings.find((w: { pattern: string }) => w.pattern === "P1");
    expect(p1.fired).toBe(true);
    const ev = p1.evidence.find((e: { id: string }) => e.id === "h.j.rec-0007.1.0");
    expect(ev).toMatchObject({ kind: "card", by: "person", mode_chosen: "decides", mode: "mentions", mode_note: "Cal Rhees is not a client decider for scope" });
    expect(ev.source.record_id).toBe("rec-0007");
    // The promise itself was not changed by the rule: no note.
    const promise = p1.evidence.find((e: { id: string }) => e.id === "h.j.rec-0006.1.0");
    expect(promise).toMatchObject({ mode_chosen: "proposes", mode: "proposes", mode_note: null });
  });

  it("zero records is not clear: a document with no records before its cut-off is Not cleared and says why", () => {
    const { box } = setup();
    const c = get(box, "/api/check?doc=Q-OC-02-v1").body;
    expect(c.records.seen).toBe(0);
    expect(c.verdict).toMatchObject({ state: "not_cleared", text: "Not cleared — no records on file before this quote, so there is nothing to check it against." });
    expect(c.verdict.notes[0]).toMatch(/^No messages, internal notes or field notes in this job were written before this quote/);
    expect(c.verdict.text).not.toMatch(/accounted for and judged/);
    expect(summary(box.ctx).states["Q-OC-02-v1"]).toBe("not_cleared");
    expect(c.warnings.filter((w: { pattern: string }) => w.pattern !== "P6").every((w: { status: string }) => w.status === "no records on file to check against")).toBe(true);
  });

  it("records written after the cut-off are not counted in Needs your judgment; they are listed apart", () => {
    const { box } = setup();
    for (const doc of ["Q-OC-02-v1", "Q-PW-05-v3", "Q-NL-01-v3"]) {
      const c = get(box, `/api/check?doc=${doc}`).body;
      const t = box.ctx.data.tables;
      const cut = Date.parse(t.quotes.find((x) => x.quote_id === doc)?.submitted_at ?? t.invoices.find((x) => x.invoice_id === doc)!.issued_at);
      // The count in the verdict notes and the panel agree.
      expect(c.queue.needs_human.length).toBe(c.records.unjudged);
      expect(c.queue.spot_check.length).toBe(c.records.spot_check);
      expect(c.queue.spot_check.every((x: { recorded_at: string }) => Date.parse(x.recorded_at) < cut)).toBe(true);
      expect(c.queue.needs_human.every((x: { recorded_at: string }) => Date.parse(x.recorded_at) < cut)).toBe(true);
      expect(c.queue.after.every((x: { recorded_at: string }) => Date.parse(x.recorded_at) >= cut)).toBe(true);
      const all = get(box, `/api/queue?job=${c.doc.job}`).body;
      expect(c.queue.needs_human.length + c.queue.spot_check.length + c.queue.after.length).toBe(all.needs_human.length + all.spot_check.length);
    }
    const oc = get(box, "/api/check?doc=Q-OC-02-v1").body;
    expect(oc.queue.needs_human).toEqual([]);
    expect(oc.queue.after.map((x: { record_id: string }) => x.record_id)).toContain("rec-0107");
  });

  it("fired warnings stay Warnings with their evidence; open spot-check records are listed in the notes", () => {
    const { box } = setup();
    const c = get(box, "/api/check?doc=INV-NL-04").body;
    const fired = c.warnings.filter((w: { fired: boolean }) => w.fired);
    expect(fired.length).toBeGreaterThan(0);
    expect(c.verdict).toMatchObject({ state: "warnings", text: `Warnings found (${fired.length})` });
    for (const w of fired) expect(w.evidence.length).toBeGreaterThan(0);
    if (c.records.spot_check) expect(c.verdict.notes.join()).toMatch(/read as empty needs? a person to spot-check/);
  });

  it("no document is Clear with zero records or with a spot-check record open", () => {
    const { box } = setup();
    for (const [id, state] of Object.entries(summary(box.ctx).states)) {
      if (state !== "clear") continue;
      const c = get(box, `/api/check?doc=${id}`).body;
      expect(c.records.seen).toBeGreaterThan(0);
      expect(c.records.spot_check).toBe(0);
    }
  });

  it("the curated view: one problem example per pattern plus every designed-clean document, totals by state", () => {
    const { box } = setup();
    const c = get(box, "/api/summary?view=curated").body;
    expect(c.view).toBe("curated");
    expect(c.picks.map((p: { pattern: string }) => p.pattern)).toEqual(["P1", "P2", "P3", "P4", "P5", "P6", "P7"]);
    const t = box.ctx.data.tables;
    const clean = [...t.quotes.filter((x) => x.status === "approved"), ...t.invoices.filter((x) => x.status === "paid")];
    expect(clean).toHaveLength(25);
    expect(c.documents).toBe(32);
    expect(new Set(c.ids)).toEqual(new Set([...c.picks.map((p: { doc: string }) => p.doc), ...clean.map((x) => ("invoice_id" in x ? x.invoice_id : x.quote_id))]));
    const b = c.by_state;
    expect(b.warnings.n + b.not_cleared.n + b.clear.n).toBe(32);
    expect(Math.round((b.warnings.total + b.not_cleared.total + b.clear.total) * 100) / 100).toBe(c.total);
    // The same documents keep the same state in both views.
    const all = summary(box.ctx).states;
    for (const [id, st] of Object.entries(summary(box.ctx, "curated").states)) expect(st).toBe(all[id]);
    expect(get(box, "/api/summary").body.view).toBe("all");
    expect(get(box, "/api/summary?view=some").status).toBe(400);
  });

  it("summarises every document and the money in each verdict state", () => {
    const { box } = setup();
    const s = get(box, "/api/summary").body;
    expect(s.documents).toBe(58);
    const b = s.by_state;
    expect(b.warnings.n + b.not_cleared.n + b.clear.n).toBe(58);
    expect(Math.round((b.warnings.total + b.not_cleared.total + b.clear.total) * 100) / 100).toBe(s.total);
    const jobs = get(box, "/api/jobs").body;
    expect(jobs.flatMap((j: { docs: { state: string }[] }) => j.docs).every((d: { state: string }) => ["warnings", "not_cleared", "clear"].includes(d.state))).toBe(true);
  });

  it("lists the queue for one job: needs_human, then the spot-check items", () => {
    const { box } = setup();
    const q = get(box, "/api/queue?job=WO-NL-01").body;
    expect(q.needs_human.length).toBeGreaterThan(0);
    expect(q.spot_check.map((x: { record_id: string }) => x.record_id)).toContain("rec-0007");
    expect(q.needs_human[0]).toHaveProperty("text");
  });

  it("rejects an invalid judgment and writes nothing", () => {
    const { root, box } = setup();
    const bad = (b: unknown) => route(box, "POST", "/api/judgments", JSON.stringify(b));
    const r1 = bad({ record_id: "rec-0011", verdict: "cards", cards: [{ mode: "decides", quote: "Approved it all.", decided_by: "p.nl.ria_moth", topic: "approval" }], reason: "x", reviewer: "Ciki" });
    expect(r1.status).toBe(400);
    expect(JSON.parse(r1.body).errors.join()).toMatch(/exact words/);
    expect(bad({ record_id: "rec-0011", verdict: "no_decision", cards: [], reason: "", reviewer: "Ciki" }).status).toBe(400);
    expect(bad({ record_id: "rec-9999", verdict: "no_decision", cards: [], reason: "x", reviewer: "Ciki" }).status).toBe(400);
    expect(route(box, "POST", "/api/judgments", "not json").status).toBe(400);
    expect(existsSync(join(root, "review/judgments.jsonl"))).toBe(false);
  });

  it("accepts a valid judgment: appended, the record becomes confirmed and the ledger updates", () => {
    const { root, box } = setup();
    const before = get(box, "/api/ledger").body.counts;
    const r = route(box, "POST", "/api/judgments", JSON.stringify({ record_id: "rec-0011", verdict: "cards", cards: [{ mode: "decides", quote: "Ok on the extra ground hours. Approved.", decided_by: "p.nl.ria_moth", topic: "approval" }], reason: "client approves the extra hours", reviewer: "Ciki" }));
    expect(r.status).toBe(201);
    const out = JSON.parse(r.body);
    expect(out.judgment).toMatchObject({ judgment_id: "j.rec-0011.1", reviewer: "Ciki" });
    expect(out.ledger.counts.human_confirmed).toBe(1);
    expect(out.ledger.counts.needs_human).toBe(before.needs_human - 1);
    expect(readFileSync(join(root, "review/judgments.jsonl"), "utf8").trim().split("\n")).toHaveLength(1);
    const q = get(box, "/api/queue?job=WO-NL-01").body;
    expect(q.confirmed.map((x: { record_id: string }) => x.record_id)).toEqual(["rec-0011"]);
    expect(q.confirmed[0].why).toMatch(/^cards kept by Ciki on \d{4}-\d\d-\d\d: client approves the extra hours$/);
  });

  it("unknown routes are 404", () => {
    const { box } = setup();
    expect(route(box, "GET", "/api/nope").status).toBe(404);
  });
});
