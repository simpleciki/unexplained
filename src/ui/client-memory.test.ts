// "What this client told us before" comes from H-MEM, not the seat table: an empty H-MEM store gives an empty
// panel even with cards in the seat table; the cut-off and supersession filters hold; a disagreement with the
// seat table is shown, marked, never hidden; and the verdict and summary() do not change with the panel.
import { cpSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HMEM } from "../../vendor/meterless-hmem/src/index.ts";
import { loadDataset } from "../engine/data.ts";
import { check, loadCtx, summary } from "./api.ts";
import { recallClient } from "./client-memory.ts";

const repo = join(import.meta.dirname, "../..");
const T = (iso: string) => Date.parse(iso);

function memStore() {
  let now = 0;
  const h = new HMEM({ clock: () => now, actor: "test" });
  const add = (card: string, rec: string, at: string, quote: string, tags: string[]) => {
    now = T(at);
    return h.add({ content: quote, type: "factual", source: rec, provenance: { origin: "document", learnedAt: now, label: rec, refs: [card] }, tags });
  };
  return { h, add };
}

const base = (h: HMEM, asOf: string, seatSuccessor: (c: string) => string | undefined = () => undefined) => ({
  hmem: h,
  client: "cl.a",
  jobs: ["WO-A-1"],
  asOf: T(asOf),
  query: "client a rules",
  cardOf: (id: string) => ({ decided_by: "p.a", topic: id.includes("rule") ? "client_rule" : "approval" }),
  recordAt: (id: string) => ({ r1: "2026-03-01T09:00:00-06:00", r2: "2026-03-05T09:00:00-06:00", r3: "2026-03-20T09:00:00-05:00", r4: "2026-03-02T09:00:00-06:00", r9: "2026-03-02T09:00:00-06:00" })[id],
  seatSuccessor,
});

describe("client memory recall", () => {
  it("filters by scope and cut-off, newest first with rules before decisions", () => {
    const { h, add } = memStore();
    add("c.rule.1", "r1", "2026-03-01T09:00:00-06:00", "No trip fees.", ["client_rule", "client_rule.billing", "client:cl.a"]);
    add("c.ok.1", "r2", "2026-03-05T09:00:00-06:00", "Approved as sent.", ["approval", "approval.status", "job:WO-A-1"]);
    add("c.ok.2", "r3", "2026-03-20T09:00:00-05:00", "Approved v2.", ["approval", "approval.status", "job:WO-A-1"]);
    add("c.other", "r9", "2026-03-02T09:00:00-06:00", "Someone else's rule.", ["client_rule", "client:cl.b"]);
    const r = recallClient(base(h, "2026-03-10T00:00:00-05:00"));
    expect(r.items.map((x) => [x.card_id, x.kind])).toEqual([["c.rule.1", "rule"], ["c.ok.1", "decision"]]);
    expect(r.dropped).toEqual({ other_scope: 1, after_cutoff: 1, superseded: 0 });
    expect(r.recalled).toBe(4); // H-MEM's query returned every memory: no score threshold, no top-N cut
  });

  it("drops a memory superseded by the cut-off, keeps it when the successor comes later, marks a disagreement", () => {
    const { h, add } = memStore();
    const old = add("c.rule.old", "r1", "2026-03-01T09:00:00-06:00", "Old rule.", ["client_rule", "client:cl.a"]);
    const next = add("c.rule.new", "r3", "2026-03-20T09:00:00-05:00", "New rule.", ["client_rule", "client:cl.a"]);
    h.store.update(old.id, { supersededBy: next.id });
    h.store.update(next.id, { supersedes: old.id });
    const seat = (c: string) => (c === "c.rule.old" ? next.id : undefined);
    expect(recallClient(base(h, "2026-03-10T00:00:00-05:00", seat)).items.map((x) => x.card_id)).toEqual(["c.rule.old"]);
    const after = recallClient(base(h, "2026-03-25T00:00:00-05:00", seat));
    expect(after.items.map((x) => x.card_id)).toEqual(["c.rule.new"]);
    expect(after.dropped.superseded).toBe(1);
    // The seat table says nothing replaced the old rule; H-MEM says it was: shown, marked, not hidden.
    const disagree = recallClient(base(h, "2026-03-25T00:00:00-05:00", () => undefined));
    expect(disagree.items.map((x) => [x.card_id, x.disagree])).toEqual([["c.rule.new", false], ["c.rule.old", true]]);
  });

  it("never shows a memory whose record was written after the cut-off, even if decided before it", () => {
    const { h, add } = memStore();
    add("c.ok.late", "r3", "2026-03-02T09:00:00-06:00", "Approved on a call.", ["approval", "approval.status", "job:WO-A-1"]);
    expect(recallClient(base(h, "2026-03-10T00:00:00-05:00")).items).toEqual([]);
  });
});

describe("check page panel", () => {
  function ctxCopy() {
    const root = mkdtempSync(join(tmpdir(), "unexplained-mem-"));
    cpSync(join(repo, "data"), join(root, "data"), { recursive: true });
    mkdirSync(join(root, "state"));
    cpSync(join(repo, "state/cards.json"), join(root, "state/cards.json"));
    cpSync(join(repo, "state/edges.json"), join(root, "state/edges.json"));
    cpSync(join(repo, "state/ingest-report.json"), join(root, "state/ingest-report.json"));
    mkdirSync(join(root, "review"));
    cpSync(join(repo, "review/judgments.jsonl"), join(root, "review/judgments.jsonl"));
    const data = loadDataset(root);
    return () => loadCtx(root, data);
  }

  it("reads H-MEM: an empty store gives an empty panel, with the same verdict and summary", () => {
    const make = ctxCopy();
    const withMem = make();
    const empty = make();
    empty.engine.memory.hmem = new HMEM({ clock: () => 0, actor: "test" });
    expect(empty.engine.cards.length).toBeGreaterThan(0); // the seat table still has its cards
    const doc = "Q-PW-05-v3";
    const a = check(withMem, doc)!;
    const b = check(empty, doc)!;
    expect(a.client_memory.items.length).toBeGreaterThan(0);
    expect(a.client_memory.items.every((x) => x.memory_id.startsWith("mem-"))).toBe(true);
    expect(b.client_memory.items).toEqual([]);
    expect(b.verdict).toEqual(a.verdict);
    expect(JSON.stringify(b.warnings)).toBe(JSON.stringify(a.warnings));
    expect(b.to_confirm).toEqual(a.to_confirm);
    const { states: s1, ...r1 } = summary(withMem, "all");
    const { states: s2, ...r2 } = summary(empty, "all");
    expect(s2).toEqual(s1);
    expect(r2).toEqual(r1);
  });
});
