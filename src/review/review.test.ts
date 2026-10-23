// Ledger, routing rules and human judgments (no network). Records, judgments and dates here are invented.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DecisionCard, SourceRecord } from "../engine/types.ts";
import { loadVocab } from "../engine/vocab.ts";
import { extractionScore } from "../eval/extraction-score.ts";
import { appendJudgment, applyJudgments, confirmation, latestPerRecord, loadJudgments, localIso, validateJudgment } from "./judgments.ts";
import type { Judgment } from "./judgments.ts";
import { buildLedger, tally } from "./ledger.ts";
import { routeRecord } from "./routing.ts";
import type { RecordOutcome } from "./routing.ts";

const repo = join(import.meta.dirname, "../..");
const vocab = loadVocab(repo);
const JUDGED = "2026-10-20T07:41:05-05:00"; // a fixed past fixture time
const rec = (id: string, source_type: SourceRecord["source_type"], text: string) =>
  ({ record_id: id, source_type, text, author: "p.xx.bea_lund", source_recorded_at: "2026-02-02T09:00:00-06:00", thread_id: "WO-NL-01", source_version: "v1" }) as SourceRecord;
const card = (record_id: string, quote: string, n = 0): DecisionCard => ({
  card_id: `m.${record_id}.0.${n}`, record_id, quote, mode: "decides", topic: "scope", facets: ["scope.lines"],
  scope: "job:WO-NL-01", decided_at: "2026-02-02T09:00:00-06:00", effective: "2026-02-02T09:00:00-06:00", decided_by: "p.nl.ria_moth",
});
const emptyReport = { records_done: 0, records_rejected: [], records_prose_reply: [], records_failed_upstream: [], cards_gate_rejected: [], cards_dropped_by_skeptic: [] };
const base: RecordOutcome = { record_id: "rec-0001", source_type: "client_message", reached: true, cards: 0, prose: false, gate_rejected: 0, skeptic_dropped: 0 };

describe("routing rules", () => {
  it("routes each outcome to its bucket", () => {
    expect(routeRecord({ ...base, cards: 2 }).bucket).toBe("auto_cards");
    expect(routeRecord({ ...base, source_type: "field_note" }).bucket).toBe("auto_empty");
    expect(routeRecord({ ...base, source_type: "client_message" }).bucket).toBe("needs_human");
    expect(routeRecord({ ...base, source_type: "internal_note" }).bucket).toBe("needs_human");
    expect(routeRecord({ ...base, source_type: "quote_version" as never }).bucket).toBe("needs_human"); // unknown type: a person, never empty
    expect(routeRecord({ ...base, reached: false }).why).toMatch(/stopped before/);
    expect(routeRecord({ ...base, cards: 1, failed_upstream: "HTTP 503" }).bucket).toBe("needs_human");
    expect(routeRecord({ ...base, cards: 1, prose: true }).why).toMatch(/prose/);
    expect(routeRecord({ ...base, rejected: "invalid JSON" }).bucket).toBe("needs_human");
    expect(routeRecord({ ...base, cards: 1, gate_rejected: 1 }).why).toMatch(/not in the record/);
    expect(routeRecord({ ...base, cards: 1, skeptic_dropped: 1 }).why).toMatch(/checker dropped/);
    expect(routeRecord({ ...base, source_type: "field_note", failed_upstream: "x" }).bucket).toBe("needs_human"); // a failure is never "empty"
  });

  it("a human judgment overrides every other rule", () => {
    const judged = { reviewer: "Ciki", judged_at: JUDGED, reason: "only a status update", verdict: "no_decision" as const };
    const r = routeRecord({ ...base, failed_upstream: "x", judged });
    expect(r.bucket).toBe("human_confirmed");
    expect(r.why).toBe("nothing to keep, judged by Ciki on 2026-10-20: only a status update");
  });
});

describe("ledger", () => {
  const records = [
    rec("rec-0001", "client_message", "Yes, use the oak trim."),
    rec("rec-0002", "client_message", "Thanks."),
    rec("rec-0003", "field_note", "Sanded the deck."),
    rec("rec-0004", "internal_note", "Called the supplier."),
  ];

  it("puts every record in exactly one bucket and the buckets add up", () => {
    const report = { ...emptyReport, records_done: 3, records_failed_upstream: [{ record_id: "rec-0004", error: "HTTP 503" }] };
    const l = buildLedger(records, [card("rec-0001", "Yes, use the oak trim.")], report, []);
    expect(l.complete).toBe(true);
    expect(l.counts).toEqual({ auto_cards: 1, auto_empty: 1, needs_human: 2, human_confirmed: 0 });
    expect(l.line).toBe("4 records = 1 auto + 1 empty (open for spot-check) + 2 need you + 0 confirmed; unaccounted: 0");
    expect(l.items.map((x) => x.record_id)).toEqual(records.map((r) => r.record_id));
  });

  it("records after the point where the run stopped need a person", () => {
    const l = buildLedger(records, [], { ...emptyReport, records_done: 2 }, []);
    expect(l.items.filter((x) => x.why.includes("stopped before")).map((x) => x.record_id)).toEqual(["rec-0003", "rec-0004"]);
    expect(l.complete).toBe(true);
  });

  it("a forced mismatch flips complete and says LEDGER MISMATCH", () => {
    const items = [{ record_id: "rec-0001", bucket: "auto_cards" as const, why: "" }, { record_id: "rec-0001", bucket: "needs_human" as const, why: "" }];
    const l = tally(3, items);
    expect(l.complete).toBe(false);
    expect(l.unaccounted).toBe(2);
    expect(l.line).toMatch(/^LEDGER MISMATCH: 3 records = 1 auto \+ 0 empty \(open for spot-check\) \+ 1 need you \+ 0 confirmed; unaccounted: 2/);
  });
});

describe("judgments", () => {
  const records = [rec("rec-0001", "client_message", "Fine by me. Paint the porch rail grey."), rec("rec-0002", "internal_note", "Supplier is late.")];
  const ok = { record_id: "rec-0001", verdict: "cards" as const, cards: [{ mode: "decides" as const, quote: "Paint the porch rail grey.", decided_by: "p.nl.ria_moth", topic: "scope" }], reason: "client approves the colour", reviewer: "Ciki" };

  it("rejects a quote that is not exact words, an empty reason and an unknown record", () => {
    expect(validateJudgment(ok, records, vocab)).toEqual([]);
    expect(validateJudgment({ ...ok, cards: [{ ...ok.cards[0], quote: "Paint the rail grey." }] }, records, vocab).join()).toMatch(/exact words/);
    expect(validateJudgment({ ...ok, reason: "  " }, records, vocab).join()).toMatch(/reason is required/);
    expect(validateJudgment({ ...ok, record_id: "rec-9999" }, records, vocab)).toEqual(["unknown record rec-9999"]);
    expect(validateJudgment({ ...ok, cards: [{ ...ok.cards[0], topic: undefined }] }, records, vocab).join()).toMatch(/say which topic/);
    // ...unless a model card on the same record supplies it.
    expect(validateJudgment({ ...ok, cards: [{ ...ok.cards[0], topic: undefined }] }, records, vocab, [card("rec-0001", "Paint the porch rail grey.")])).toEqual([]);
  });

  it("appends; the latest per record wins and history stays; judged_at is the local clock at submit", () => {
    const root = mkdtempSync(join(tmpdir(), "unexplained-judge-"));
    const at = new Date(2026, 9, 20, 7, 41, 5);
    const first = appendJudgment(root, ok, records, vocab, [], at);
    const second = appendJudgment(root, { ...ok, verdict: "no_decision", cards: [], reason: "it is a question, not a decision" }, records, vocab, [], new Date(2026, 9, 20, 8, 0, 0));
    expect(first.judged_at).toBe(localIso(at));
    expect(first.judged_at).toMatch(/^2026-10-20T07:41:05[+-]\d\d:\d\d$/);
    expect(second.supersedes).toBe(first.judgment_id);
    const all = loadJudgments(root);
    expect(all.map((j) => j.judgment_id)).toEqual(["j.rec-0001.1", "j.rec-0001.2"]);
    expect(latestPerRecord(all).get("rec-0001")!.verdict).toBe("no_decision");
    expect(readFileSync(join(root, "review/judgments.jsonl"), "utf8").trim().split("\n")).toHaveLength(2);
    expect(() => appendJudgment(root, { ...ok, reason: "" }, records, vocab)).toThrow(/judgment rejected/);
    expect(loadJudgments(root)).toHaveLength(2);
  });

  it("human cards replace the model's cards for that record only, and model P/R ignores them", () => {
    const model = [card("rec-0001", "Fine by me.", 0), card("rec-0002", "Supplier is late.", 0)];
    const j: Judgment = { ...ok, judgment_id: "j.rec-0001.1", cards: ok.cards, judged_at: JUDGED };
    const edges = [{ old_card: model[0].card_id, new_card: model[1].card_id, relation: "SAME" as const }];
    const applied = applyJudgments(model, edges, [j], records);
    expect(applied.cards.map((c) => c.card_id)).toEqual(["m.rec-0002.0.0", "h.j.rec-0001.1.0"]);
    expect(applied.cards[1]).toMatchObject({ source: "human", judgment_id: "j.rec-0001.1", quote: "Paint the porch rail grey.", scope: "job:WO-NL-01" });
    expect(applied.edges).toEqual([]); // the edge touched a replaced model card
    expect(confirmation(applied.cards[1], [j])).toBe("confirmed by Ciki on 2026-10-20: client approves the colour");
    expect(confirmation(applied.cards[0], [j])).toBeUndefined();

    const gold = [{ ...card("rec-0001", "Paint the porch rail grey."), card_id: "g1" }];
    const modelOnly = extractionScore(model, gold);
    const system = extractionScore(applied.cards, gold);
    expect(modelOnly.matched).toBe(0); // the model never found it: its score must not borrow the person's card
    expect(system.matched).toBe(1);
  });

  it("an older judgment without effective still loads with the record time", () => {
    const old: Judgment = { judgment_id: "j.rec-0001.1", record_id: "rec-0001", verdict: "cards", cards: [{ mode: "decides", quote: "Paint the porch rail grey.", decided_by: "p.nl.ria_moth", topic: "scope", facets: [] }], reason: "r", reviewer: "Ciki", judged_at: JUDGED };
    const [c] = applyJudgments([], [], [old], records).cards;
    expect(c.effective).toBe(records[0].source_recorded_at);
    expect(c.decided_at).toBe(records[0].source_recorded_at);
  });

  it("a no_decision judgment leaves the record with no cards", () => {
    const model = [card("rec-0002", "Supplier is late.")];
    const j: Judgment = { judgment_id: "j.rec-0002.1", record_id: "rec-0002", verdict: "no_decision", cards: [], reason: "status only", reviewer: "Ciki", judged_at: JUDGED };
    expect(applyJudgments(model, [], [j], records).cards).toEqual([]);
  });
});
