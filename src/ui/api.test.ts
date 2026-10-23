// The gatekeeper API through route() (no network, no model): a temporary repo copy with data/, the vocab,
// and a small invented state/ so judgments are written to the copy, never to the real review/ folder.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadDataset } from "../engine/data.ts";
import { extractableRecords } from "../pipeline/ingest.ts";
import { loadCtx } from "./api.ts";
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
    expect(before.warnings.find((w: { pattern: string }) => w.pattern === "P1").status).toBe(`no evidence in the ${before.records.read} of ${before.records.seen} records read`);
    expect(before.cutoff).toBe("records up to 09:14, just before this quote was submitted");
    expect(before.doc.at).toBe("2026-03-04 09:15");
    const cutoff = Date.parse("2026-03-04T09:15:00-06:00");
    const open = before.queue.needs_human.filter((x: { recorded_at: string }) => Date.parse(x.recorded_at) < cutoff);
    expect(open).toHaveLength(before.records.unjudged);
    for (const x of open) {
      const r = route(box, "POST", "/api/judgments", JSON.stringify({ record_id: x.record_id, verdict: "no_decision", cards: [], reason: "read it: no decision here", reviewer: "Ciki" }));
      expect(r.status).toBe(201);
    }
    const after = get(box, `/api/check?doc=${doc}`).body;
    expect(after.records.unjudged).toBe(0);
    expect(after.verdict.state).toBe("clear");
    expect(after.verdict.text).toBe("Clear — every record in this job is accounted for and judged");
    expect(after.warnings.every((w: { status: string }) => w.status === "clear")).toBe(true);
  });

  it("an open P2 (needs the Judge) also keeps the verdict from Clear", () => {
    const { box } = setup();
    const c = get(box, "/api/check?doc=Q-NL-01-v2").body;
    expect(c.warnings.find((w: { pattern: string }) => w.pattern === "P2").open).toBe(true);
    expect(c.verdict.state).not.toBe("clear");
    expect(c.verdict.notes.join()).toMatch(/P2 .* needs the Judge model step/);
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
    expect(q.confirmed[0].why).toMatch(/^decision confirmed by Ciki on \d{4}-\d\d-\d\d: client approves the extra hours$/);
  });

  it("unknown routes are 404", () => {
    const { box } = setup();
    expect(route(box, "GET", "/api/nope").status).toBe(404);
  });
});
