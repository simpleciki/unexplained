// The home story is served only when every word, date, price and mark checks out against the records (no
// network). A temporary repo copy with the gold cards as state, so the two-clock card exists.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadDataset } from "../engine/data.ts";
import { extractableRecords } from "../pipeline/ingest.ts";
import { loadCtx } from "./api.ts";
import { route } from "./server.ts";
import { daysOf } from "./story.ts";

const repo = join(import.meta.dirname, "../..");

function setup(dropCardsOf: string[] = []) {
  const root = mkdtempSync(join(tmpdir(), "unexplained-story-"));
  cpSync(join(repo, "data"), join(root, "data"), { recursive: true });
  cpSync(join(repo, "eval/demo"), join(root, "eval/demo"), { recursive: true }); // hero_case.json: the on-hold numbers
  mkdirSync(join(root, "state"));
  const jsonl = (f: string) => readFileSync(join(repo, "eval/gold", f), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  writeFileSync(join(root, "state/cards.json"), JSON.stringify(jsonl("gold_cards.jsonl").filter((c: { record_id: string }) => !dropCardsOf.includes(c.record_id))));
  writeFileSync(join(root, "state/edges.json"), "[]");
  const n = extractableRecords(loadDataset(root).records).length;
  writeFileSync(join(root, "state/ingest-report.json"), JSON.stringify({ records_total: n, records_done: n, records_rejected: [], records_prose_reply: [], records_failed_upstream: [], cards_gate_rejected: [], cards_dropped_by_skeptic: [] }));
  return { root, box: { ctx: loadCtx(root, loadDataset(root)), html: "<html>outbox</html>", home: "<html>home</html>" } };
}
const get = (box: Parameters<typeof route>[0], url: string) => {
  const r = route(box, "GET", url);
  return { status: r.status, body: r.type === "json" ? JSON.parse(r.body) : r.body };
};
// Rewrite the story file in the temp copy, then ask again.
function tamper(root: string, edit: (s: { events: Record<string, unknown>[] } & Record<string, unknown>) => void, job = "WO-NL-01") {
  const f = join(root, `data/stories/${job}.json`);
  const s = JSON.parse(readFileSync(f, "utf8"));
  edit(s);
  writeFileSync(f, JSON.stringify(s));
}

describe("story endpoint", () => {
  it("serves the WO-NL-01 story: every text is the exact words of one of its records on that job", () => {
    const { root, box } = setup();
    const r = get(box, "/api/story?job=WO-NL-01");
    expect(r.status).toBe(200);
    const recs = new Map(loadDataset(root).records.map((x) => [x.record_id, x]));
    expect(r.body.events).toHaveLength(9);
    for (const e of r.body.events) {
      expect(e.record_ids.every((id: string) => recs.get(id)?.thread_id === "WO-NL-01")).toBe(true);
      expect(e.record_ids.some((id: string) => recs.get(id)!.text.includes(e.text))).toBe(true);
    }
    expect(r.body.events.map((e: { price?: number }) => e.price).filter(Boolean)).toEqual([1804, 1988, 2156]);
    expect(r.body).toMatchObject({ title: "Replace 200A house panel at Loft 1A", client_name: "North Loft Holdings", contractor: { name: "Mira Kell" }, client: { name: "Ria Moth" }, ending: { price: 2156, invoice_status: "paid", link: { doc: "Q-PW-05-v3" } } });
  });

  it("fails loudly (500 with the reason) when any check fails", () => {
    const cases: [string, (s: { events: Record<string, unknown>[] } & Record<string, unknown>) => void, RegExp][] = [
      ["a changed word", (s) => { s.events[1].text = "Approved as sent at $95 an hour. Do not add trip fees."; }, /not the exact words/],
      ["a wrong price", (s) => { s.events[0].price = 1900; }, /price 1900 but Q-NL-01-v1 totals 1804/],
      ["a record of another job", (s) => { s.events[5].record_ids = ["rec-0029"]; }, /belongs to WO-NL-02/],
      ["a wrong date", (s) => { s.events[2].date = "7 Mar"; }, /rec-0006 is dated 6 Mar, not 7 Mar/],
      ["an unknown record", (s) => { s.events[3].record_ids = ["rec-9999"]; }, /unknown record rec-9999/],
      ["a wrong two-clock date", (s) => { (s.events[7].mark as Record<string, string>).said = "16 Mar"; }, /no card on rec-0016 was said 16 Mar/],
      ["events out of order", (s) => { s.events[4].t = 1; }, /not in time order/],
      ["a missing linked document", (s) => { (s.ending as { link: { doc: string } }).link.doc = "Q-XX-99-v1"; }, /linked document Q-XX-99-v1 does not exist/],
    ];
    for (const [name, edit, why] of cases) {
      const { root, box } = setup();
      tamper(root, edit);
      const r = get(box, "/api/story?job=WO-NL-01");
      expect(r.status, name).toBe(500);
      expect(r.body.errors.join("\n"), name).toMatch(why);
    }
  });

  it("serves the WO-PW-05 story: three versions, three rejections, and an on-hold ending with the hero case numbers", () => {
    const { root, box } = setup();
    const r = get(box, "/api/story?job=WO-PW-05");
    expect(r.status, JSON.stringify(r.body.errors)).toBe(200);
    const recs = new Map(loadDataset(root).records.map((x) => [x.record_id, x]));
    for (const e of r.body.events) expect(e.record_ids.some((id: string) => recs.get(id)?.thread_id === "WO-PW-05" && recs.get(id)!.text.includes(e.text))).toBe(true);
    expect(r.body.events.map((e: { price?: number }) => e.price).filter(Boolean)).toEqual([761, 1626, 2026]);
    expect(r.body.events.filter((e: { side: string }) => e.side === "client").map((e: { text: string }) => e.text)).toEqual(["Not approving this one.", "Not this version either.", "Rejected."]);
    const hero = JSON.parse(readFileSync(join(repo, "eval/demo/hero_case.json"), "utf8"));
    expect(r.body).toMatchObject({ client: { name: "Otto Gell" }, ending: { kind: "on_hold", versions: 3, reasons: hero.reasons_written.value, held_usd: hero.held_usd.value, days: hero.days.value } });
    expect(r.body.ending).toMatchObject({ held_usd: 2306, days: 53, reasons: 0 });
    expect(r.body.ending.invoice_status).toBeUndefined();
  });

  it("refuses an on-hold ending with a wrong number, or on a job that was invoiced", () => {
    const cases: [string, (s: Record<string, unknown>) => void, RegExp][] = [
      ["held dollars", (s) => { (s.ending as Record<string, number>).held_usd = 2026; }, /held_usd 2026 but hero_case.json has 2306/],
      ["days", (s) => { (s.ending as Record<string, number>).days = 52; }, /days 52 but hero_case.json has 53/],
      ["reasons", (s) => { (s.ending as Record<string, number>).reasons = 1; }, /reasons 1 but hero_case.json has 0/],
      ["versions", (s) => { (s.ending as Record<string, number>).versions = 4; }, /4 versions but WO-PW-05 has 3 quote versions/],
      ["a wrong quote price", (s) => { (s.events as Record<string, unknown>[])[5].price = 2306; }, /price 2306 but Q-PW-05-v3 totals 2026/],
    ];
    for (const [name, edit, why] of cases) {
      const { root, box } = setup();
      tamper(root, edit, "WO-PW-05");
      const r = get(box, "/api/story?job=WO-PW-05");
      expect(r.status, name).toBe(500);
      expect(r.body.errors.join("\n"), name).toMatch(why);
    }
    // An invoiced job cannot end on hold, and the hero case belongs to WO-PW-05 only.
    const { root, box } = setup();
    tamper(root, (s) => { s.ending = { kind: "on_hold", versions: 3, reasons: 0, held_usd: 2306, days: 53, sub: "", link: { text: "", doc: "Q-NL-01-v3" } }; });
    const errors = get(box, "/api/story?job=WO-NL-01").body.errors.join("\n");
    expect(errors).toMatch(/WO-NL-01 has an invoice, so it is not on hold/);
    expect(errors).toMatch(/hero_case.json is for WO-PW-05, not WO-NL-01/);
  });

  it("the two-clock mark needs a real card said on one day and written on another", () => {
    const { box } = setup(["rec-0016"]); // no card on rec-0016
    const r = get(box, "/api/story?job=WO-NL-01");
    expect(r.status).toBe(500);
    expect(r.body.errors.join()).toMatch(/no card on rec-0016 was said 17 Mar on a record written 20 Mar/);
  });

  it("refuses a job id that is a path, and a job with no story", () => {
    const { box } = setup();
    expect(get(box, "/api/story?job=../../etc/passwd").status).toBe(404);
    expect(get(box, "/api/story?job=WO-OC-01").status).toBe(404);
    expect(get(box, "/api/story").body.job).toBe("WO-NL-01"); // the default story is unchanged
  });

  it("reads date labels", () => {
    expect(daysOf("4 Mar")).toEqual(["4 Mar"]);
    expect(daysOf("11–12 Mar")).toEqual(["11 Mar", "12 Mar"]);
    expect(daysOf("17 Mar call")).toEqual(["17 Mar"]);
    expect(daysOf("March 4")).toBeNull();
  });
});

describe("home page", () => {
  it("is served at / and the check page at /outbox", () => {
    const { box } = setup();
    expect(get(box, "/").body).toBe("<html>home</html>");
    expect(get(box, "/outbox").body).toBe("<html>outbox</html>");
  });

  it("holds no record text: every word of the story comes from the API", () => {
    const html = readFileSync(join(repo, "src/ui/home.html"), "utf8");
    for (const job of ["WO-NL-01", "WO-PW-05"]) {
      const story = JSON.parse(readFileSync(join(repo, `data/stories/${job}.json`), "utf8"));
      for (const e of story.events) expect(html).not.toContain(e.text);
    }
    for (const r of loadDataset(repo).records) {
      for (const sentence of r.text.split(/(?<=[.!?])\s+/).filter((x) => x.length >= 24)) expect(html, r.record_id).not.toContain(sentence);
    }
    for (const fixed of ["Mira Kell", "Ria Moth", "North Loft", "Heron Court", "2,156", "WO-NL-01\"", "Q-PW-05-v3", "Otto", "2,306", "WO-PW-05\""]) expect(html).not.toContain(fixed);
  });
});
