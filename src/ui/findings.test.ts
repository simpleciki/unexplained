// Finding sentences over every document (no network): with the gold cards as the ingested state (so P1-P7 all
// get exercised) and with the real ingest (state/, or the committed snapshot). No raw ids, booleans, nulls or timestamps; every
// quoted string is the exact words of a record in that warning's evidence.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadDataset } from "../engine/data.ts";
import { extractableRecords } from "../pipeline/ingest.ts";
import { check, jobs, loadCtx } from "./api.ts";
import { ingestSource } from "../pipeline/ingest-source.ts";
import { findingSentences, money, plainText, shortDate } from "./findings.ts";
import type { Seg } from "./findings.ts";

const repo = join(import.meta.dirname, "../..");
// The real ingest: state/ when there is a local one, else the committed snapshot (a fresh clone).
const hasIngest = (() => { try { ingestSource(repo); return true; } catch { return false; } })();
const FORBIDDEN = [/undefined/, /\bnull\b/, /m\.rec-/, /\bcard\.[a-z]/, /\bh\.j\./, /\btrue\b/, /\bfalse\b/, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/];

function goldRoot() {
  const root = mkdtempSync(join(tmpdir(), "unexplained-findings-"));
  cpSync(join(repo, "data"), join(root, "data"), { recursive: true });
  mkdirSync(join(root, "state"));
  const jsonl = (f: string) => readFileSync(join(repo, "eval/gold", f), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  writeFileSync(join(root, "state/cards.json"), JSON.stringify(jsonl("gold_cards.jsonl")));
  writeFileSync(join(root, "state/edges.json"), JSON.stringify(jsonl("gold_edges.jsonl")));
  const n = extractableRecords(loadDataset(root).records).length;
  writeFileSync(join(root, "state/ingest-report.json"), JSON.stringify({ records_total: n, records_done: n, records_rejected: [], records_prose_reply: [], records_failed_upstream: [], cards_gate_rejected: [], cards_dropped_by_skeptic: [] }));
  return root;
}

function allFindings(root: string) {
  const ctx = loadCtx(root, loadDataset(root));
  const out: { doc: string; pattern: string; sentences: string[]; segments: Seg[][]; sources: string[] }[] = [];
  for (const j of jobs(ctx)) for (const d of j.docs) {
    for (const w of check(ctx, d.id)!.warnings.filter((x) => x.fired)) {
      const x = w as typeof w & { finding: string[]; finding_segments: Seg[][] };
      out.push({ doc: d.id, pattern: w.pattern, sentences: x.finding, segments: x.finding_segments, sources: w.evidence.flatMap((e) => (e.source ? [e.source.text] : [])) });
    }
  }
  return { out, documents: jobs(ctx).flatMap((j) => j.docs).length };
}

function assertClean(rows: ReturnType<typeof allFindings>["out"]) {
  for (const r of rows) {
    expect(r.sentences.length, `${r.doc} ${r.pattern} has no sentence`).toBeGreaterThan(0);
    for (const s of r.sentences) {
      for (const re of FORBIDDEN) expect(s, `${r.doc} ${r.pattern}: ${s}`).not.toMatch(re);
      for (const [, q] of s.matchAll(/“([^”]+)”/g)) expect(r.sources.some((t) => t.includes(q)), `${r.doc} ${r.pattern} quotes words not in its evidence: ${q}`).toBe(true);
    }
  }
}

describe("finding sentences", () => {
  it("are clean on all 58 documents with the gold cards, and cover every pattern that fires", () => {
    const { out, documents } = allFindings(goldRoot());
    expect(documents).toBe(58);
    assertClean(out);
    const patterns = new Set(out.map((r) => r.pattern));
    for (const p of ["P1", "P3", "P4", "P5", "P6", "P7"]) expect(patterns.has(p), `${p} never fired with gold cards`).toBe(true);
  });

  it.skipIf(!hasIngest)("are clean on all documents with the real ingested state", () => {
    assertClean(allFindings(repo).out);
  });

  it("come as segments for every fired pattern: same words as the sentence, typed tokens, exact quotes", () => {
    const { out } = allFindings(goldRoot());
    const people = new Set(["Mira Kell", "Jonah Prent", "Delia Vorn", "Cal Rhees", "Nora Quinn", "Wes Dalby", "Ria Moth", "Helen Bray", "Tomas Frey", "Otto Gell", "Yvette Sarn", "Paul Kett"]);
    for (const r of out) {
      expect(r.segments.length, `${r.doc} ${r.pattern}`).toBe(r.sentences.length);
      r.segments.forEach((segs, i) => {
        expect(plainText(segs), `${r.doc} ${r.pattern}`).toBe(r.sentences[i]);
        for (const x of segs) {
          if (x.k === "person") expect(people.has(x.v), x.v).toBe(true);
          if (x.k === "date") expect(x.v).toMatch(/^\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/);
          if (x.k === "money") expect(x.v).toMatch(/^[−+]?\$[\d,]+(\.\d{2})?$/);
          if (x.k === "doc") expect(x.v).toMatch(/^(Q|INV)-[A-Z]{2}-\d{2}(-v\d+)?$/);
          if (x.k === "quote") expect(r.sources.some((t) => t.includes(x.v)), `${r.doc} ${r.pattern}: ${x.v}`).toBe(true);
        }
      });
    }
  });

  it("keep the exact wording (pinned with the gold cards) and mark what a person said", () => {
    const { out } = allFindings(goldRoot());
    const get = (doc: string, p: string) => out.find((r) => r.doc === doc && r.pattern === p)!;
    // Two approved quotes are too few to judge structure (task 017): no P6 on Q-NL-02-v1; with four it speaks.
    expect(out.find((r) => r.doc === "Q-NL-02-v1" && r.pattern === "P6")).toBeUndefined();
    expect(get("Q-NL-03-v1", "P6").sentences).toEqual(["Ria Moth approved quotes with labor, material and freight lines (Q-NL-01-v1, Q-NL-01-v2, Q-NL-01-v3 and Q-NL-02-v1). This quote has only 3 lines, where approved quotes have at least 4."]);
    expect(get("Q-NL-02-v2", "P1").sentences).toEqual(["Mira Kell promised on 19 Mar: “Said Nora will open the closet Friday and we would tell her then if the tank has to come out”. No result is on record before this quote. The line “Expansion tank if needed after second look” uses “tank” from the promise."]);
    expect(get("Q-NL-03-v2", "P3").sentences).toEqual(["Q-NL-03-v1 and Q-NL-03-v2 still say “Need to determine the cause before naming parts”, and no finding is on record before this quote. The question has not moved across 2 versions."]);
    expect(get("Q-NL-04-v3", "P4").sentences).toEqual(["Ria Moth set a rule on 10 Mar: “Anything over $2500 needs a one-line note from me before you submit”. It is still in force, and this quote breaks it: its total is above the $2,500 limit that needs a note first."]);
    expect(get("Q-NL-04-v3", "P5").sentences).toEqual([
      "Ria Moth gave a reason on 3 Apr: “I got three copies and two quote numbers. I am not approving this. Send one packet.”",
      "What the records show instead: a version was voided and resent within 30 minutes; the cover note names a different quote id; the same quote was announced 3 times; Q-NL-04-v2's total moved +$400 from Q-NL-04-v1; Q-NL-04-v2 added a line: Lump-sum weather allowance. These are inferred from the records, not stated reasons.",
    ]);
    expect(get("INV-NL-04", "P7").sentences).toEqual(["No version of this job was approved by the invoice date; the invoice bills Q-NL-04-v2. The client is likely to dispute it."]);
    // What a person said is marked, so the page puts it on its own line under the name and date.
    const p1 = get("Q-NL-02-v2", "P1").segments[0];
    expect(p1.slice(0, 4).map((x) => x.k)).toEqual(["person", "text", "date", "text"]);
    expect(p1.find((x) => x.k === "quote" && "said" in x && x.said)?.v).toBe("Said Nora will open the closet Friday and we would tell her then if the tank has to come out");
    expect(p1.filter((x) => x.k === "quote" && !("said" in x)).map((x) => x.v)).toEqual(["Expansion tank if needed after second look", "tank"]);
    expect(get("Q-NL-04-v3", "P5").segments[1].filter((x) => x.k === "money").map((x) => x.v)).toEqual(["+$400"]);
  });

  it("P1 names a priced line only through a meaningful shared word; otherwise it asks to check", () => {
    const promise = { id: "m.rec-9.0.0", kind: "card" as const, quote: "We'll scope the drain leader first and tell you.", decided_by: "p.hw.mira_kell", decided_at: "2026-04-30T10:20:00-05:00", source: { record_id: "rec-9", type: "client_message", author: "p.hw.mira_kell", at: "2026-04-30T10:20:00-05:00", text: "We'll scope the drain leader first and tell you." } };
    const quote = { id: "rec-10", kind: "record" as const, source: { record_id: "rec-10", type: "quote_version", author: "p.hw.jonah_prent", at: "2026-05-01T09:00:00-05:00", text: "Lines: 1. labor: Replace leader to first cleanout; 2. labor: Reset drain body" } };
    const item = (words: string[]) => ({ pattern: "P1", evidence: [promise, quote], details: { open_items: [{ card: promise.id, kind: "contractor_promise", quote: promise.quote, decided_at: promise.decided_at, unconfirmed_follow_ups: [], priced_item_words: words }] } });
    const ctx = { nameOf: () => "Mira Kell", docKind: "quote" as const, lines: [{ description: "Replace leader to first cleanout" }, { description: "Reset drain body" }] };
    // Only a generic word is shared: no claim, a request to check.
    const generic = findingSentences(item(["first"]), ctx).join(" ");
    expect(generic).toMatch(/Check whether any line in this quote depends on it\.$/);
    expect(generic).not.toMatch(/prices work tied to it|uses “/);
    // A meaningful word is shared: the line and the word are named, both exact words of their records.
    const linked = findingSentences(item(["first", "leader"]), ctx).join(" ");
    expect(linked).toMatch(/The line “Replace leader to first cleanout” uses “leader” from the promise\.$/);
  });

  it.skipIf(!hasIngest)("Q-PW-05-v3 does not claim a priced line from the word 'first'", () => {
    const ctx = loadCtx(repo, loadDataset(repo));
    const p1 = check(ctx, "Q-PW-05-v3")!.warnings.find((w) => w.pattern === "P1") as { fired: boolean; finding: string[] } | undefined;
    if (!p1?.fired) return;
    expect(p1.finding.join(" ")).not.toMatch(/prices work tied to it|uses “first”/);
  });

  it("formats dates, money and P2 without raw values", () => {
    expect(shortDate("2026-04-30T10:20:00-05:00")).toBe("30 Apr");
    expect(money(982)).toBe("$982");
    expect(money(2156.5)).toBe("$2,156.50");
    const p2 = findingSentences({ pattern: "P2", evidence: [], details: { from: "Q-XX-01-v1", to: "Q-XX-01-v2", total_delta: 168, changes: [{ change: "added", description: "Surge device", delta: 168 }], client_explanation: "absent" } }, { nameOf: (id) => id, docKind: "quote" });
    expect(p2).toEqual(["Between Q-XX-01-v1 and Q-XX-01-v2 the total moved +$168: added Surge device (+$168). The text the client sees does not explain the change."]);
  });
});
