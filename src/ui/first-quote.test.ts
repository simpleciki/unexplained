// Task 017 on a temporary repo copy whose "model" cards are the gold cards (no model, no real state/): a person's
// confirmed approval counts, P6 judges a client's usual structure only with 3+ approved quotes, and a job's first
// quote clears against the client's rules and usual quotes when the client has them.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadDataset } from "../engine/data.ts";
import type { Line } from "../engine/docs.ts";
import { extractableRecords } from "../pipeline/ingest.ts";
import { MIN_STRUCTURE_NORM_VERSIONS } from "../engine/detectors/norms.ts";
import { check, loadCtx } from "./api.ts";
import { route } from "./server.ts";

const repo = join(import.meta.dirname, "../..");
const jsonl = (f: string) => readFileSync(join(repo, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const gold = jsonl("eval/gold/gold_cards.jsonl");

function setup(cards: unknown[]) {
  const root = mkdtempSync(join(tmpdir(), "unexplained-017-"));
  cpSync(join(repo, "data"), join(root, "data"), { recursive: true });
  const data = loadDataset(root);
  const n = extractableRecords(data.records).length;
  mkdirSync(join(root, "state"));
  writeFileSync(join(root, "state/cards.json"), JSON.stringify(cards));
  writeFileSync(join(root, "state/edges.json"), "[]");
  writeFileSync(join(root, "state/ingest-report.json"), JSON.stringify({ records_total: n, records_done: n, records_rejected: [], records_prose_reply: [], records_failed_upstream: [], cards_gate_rejected: [], cards_dropped_by_skeptic: [] }));
  return { box: { ctx: loadCtx(root, data), html: "" } };
}
const p = (c: ReturnType<typeof check>, pattern: string) => c!.warnings.find((w) => w.pattern === pattern)!;

describe("task 017", () => {
  it("a person's confirmed approval counts: P7 stops firing on INV-OC-01 and INV-OC-04", () => {
    // No model card on these records, so the approvals exist only once a person keeps them.
    const { box } = setup(gold.filter((c) => !["rec-0078", "rec-0083", "rec-0128"].includes(c.record_id)));
    for (const inv of ["INV-OC-01", "INV-OC-04"]) expect(p(check(box.ctx, inv), "P7").fired).toBe(true);
    for (const rid of ["rec-0078", "rec-0083", "rec-0128"]) {
      const g = gold.find((c) => c.record_id === rid && c.topic === "approval");
      // The form's shape: a topic, no facets.
      const body = { record_id: rid, verdict: "cards", reason: "the client approves the quote here", reviewer: "Ciki", cards: [{ mode: "decides", quote: g.quote, decided_by: g.decided_by, topic: "approval" }] };
      const r = route(box, "POST", "/api/judgments", JSON.stringify(body));
      expect(r.status).toBe(201);
      expect(JSON.parse(r.body).judgment.cards[0].facets).toEqual(["approval.status"]);
    }
    for (const inv of ["INV-OC-01", "INV-OC-04"]) expect(p(check(box.ctx, inv), "P7").fired).toBe(false);
  });

  it(`P6 judges structure only with ${MIN_STRUCTURE_NORM_VERSIONS}+ approved quotes of the client`, () => {
    const { box } = setup(gold);
    // Two approved North Loft quotes before Q-NL-02-v1, and it has a freight line none of them had: no warning.
    const two = p(check(box.ctx, "Q-NL-02-v1"), "P6");
    expect((two.details as { structure: { norm_from: string[] } }).structure.norm_from).toHaveLength(2);
    expect(two.fired).toBe(false);
    expect(two.status).toBe("not enough history to judge this client's usual structure (2 of 3 approved quotes)");
    // Exactly three approved Oak Circle quotes before Q-OC-03-v1: a category none of them had now warns.
    const before = p(check(box.ctx, "Q-OC-03-v1"), "P6");
    const s = (before.details as { structure: { norm_from: string[]; portal_categories: string[]; approved_categories: string[] } }).structure;
    expect(s.norm_from).toHaveLength(3);
    expect(before.fired).toBe(false);
    const extra = s.portal_categories.find((c) => !s.approved_categories.includes(c))!;
    const v = box.ctx.engine.docs.versions.find((x) => x.quote_id === "Q-OC-03-v1")!;
    v.lines = [...v.lines, { ...v.lines[0], category: extra, description: `${extra} line`, kind: "material" } as Line];
    const after = p(check(box.ctx, "Q-OC-03-v1"), "P6");
    expect(after.fired).toBe(true);
    expect((after.details as { off_norm: string[] }).off_norm).toContain(`${extra}: never in an approved quote of this client`);
  });

  it("a first quote clears against the client's rules and usual quotes; without client history it does not", () => {
    const { box } = setup(gold);
    const c = check(box.ctx, "Q-RM-04-v1")!;
    expect(c.records.seen).toBe(0);
    expect(c.verdict).toMatchObject({ state: "clear", text: "Clear — first quote on this job; checked against the client's rules and usual quotes only.", notes: [] });
    expect(p(c, "P4").status).toBe("clear");
    expect(p(c, "P6").status).toBe("clear");
    expect(p(c, "P1").status).toBe("no records on file to check against");
    // Oak Circle's first job: no client rule and no approved quote yet, so nothing on file to check it against.
    const first = check(box.ctx, "Q-OC-01-v1")!;
    expect(first.verdict.state).toBe("not_cleared");
    expect(first.verdict.text).toBe("Not cleared — no records on file before this quote, so there is nothing to check it against.");
    // Rules on file but too few approved quotes: still not cleared.
    expect(check(box.ctx, "Q-PW-02-v1")!.verdict.state).toBe("not_cleared");
    // A first-version quote whose client checks fire is a warning, not a clear.
    expect(check(box.ctx, "Q-NL-03-v1")!.verdict.state).toBe("warnings");
  });
});
