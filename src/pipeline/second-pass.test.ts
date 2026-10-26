// Extraction run 3 (docs/extraction-run-3.md), with a stand-in provider (no network): only records with no
// first-pass card are read; first-pass cards are kept unchanged; the run reads and writes only its own cache folder
// and output; a rejected response_format stops the run instead of being dropped.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadDataset } from "../engine/data.ts";
import type { DecisionCard, SourceRecord } from "../engine/types.ts";
import { FakeProvider } from "../llm/fake.ts";
import { NvidiaDirect, ResponseFormatRejected } from "../llm/nvidia-direct.ts";
import type { ChatRequest } from "../llm/provider.ts";
import { makeRuntime } from "./runtime.ts";
import { noCardRecords, runSecondPass, SECOND_PASS, SECOND_PASS_CACHE } from "./second-pass.ts";

const repo = join(import.meta.dirname, "../..");
const FIRST = "snapshot/ingest-2026-10-23";
// A real gold card on rec-0011, a record with no first-pass card: the stand-in "finds" it on the second read.
const FOUND = { mode: "decides", topic: "approval", facets: ["approval.status", "price.labor"], scope: "job:WO-NL-01", decided_by: "p.nl.ria_moth", quote: "Ok on the extra ground hours. Approved.", decided_at: "record_time", effective: "record_time" };

function standIn(req: ChatRequest): string {
  if ((req.system ?? "").startsWith("You re-read")) return JSON.stringify({ cards: /Record rec-0011 /.test(req.user) ? [FOUND] : [] });
  if ((req.system ?? "").startsWith("You check extracted")) {
    const ids = [...req.user.matchAll(/"id":"([^"]+)"/g)].map((m) => m[1]);
    return JSON.stringify({ verdicts: ids.map((id) => ({ id, supported: true })) });
  }
  return "{}";
}

function setup() {
  const root = mkdtempSync(join(tmpdir(), "unexplained-run3-"));
  cpSync(join(repo, "data"), join(root, "data"), { recursive: true });
  cpSync(join(repo, FIRST), join(root, FIRST), { recursive: true });
  mkdirSync(join(root, "cache"));
  return root;
}

describe("second pass: record selection", () => {
  const rec = (id: string): SourceRecord => ({ record_id: id, source_type: "client_message", source_version: "v1", text: "x", author: "a", source_recorded_at: "2026-03-01T09:00:00-06:00", thread_id: "WO-NL-01" });
  const card = (id: string, record_id: string) => ({ card_id: id, record_id }) as DecisionCard;
  it("takes only records with no card, with the reason", () => {
    const records = ["rec-0001", "rec-0002", "rec-0003", "rec-0004", "rec-0005", "rec-0006"].map(rec);
    const first = { records_done: 4, records_failed_upstream: [{ record_id: "rec-0003", error: "x" }], records_prose_reply: ["rec-0004"], records_rejected: [{ record_id: "rec-0004", why: "prose" }], cards_gate_rejected: [], cards_dropped_by_skeptic: [{ card_id: "m.rec-0005.0.0", why: "no" }] };
    expect(noCardRecords(records, [card("m.rec-0001.0.0", "rec-0001")], first)).toEqual([
      { record_id: "rec-0002", reason: "read as empty" },
      { record_id: "rec-0003", reason: "failed upstream" },
      { record_id: "rec-0004", reason: "answered in prose" },
      { record_id: "rec-0005", reason: "cards dropped by the checker" },
      { record_id: "rec-0006", reason: "not reached" },
    ]);
  });

  it("on the 2026-10-23 snapshot: 69 records, none of them with a first-pass card", () => {
    const data = loadDataset(repo);
    const cards = JSON.parse(readFileSync(join(repo, FIRST, "cards.json"), "utf8")) as DecisionCard[];
    const t = noCardRecords(data.records, cards, JSON.parse(readFileSync(join(repo, FIRST, "ingest-report.json"), "utf8")));
    expect(t).toHaveLength(69);
    const withCards = new Set(cards.map((c) => c.record_id));
    expect(t.every((x) => !withCards.has(x.record_id))).toBe(true);
  });
});

describe("second pass: run", () => {
  it("keeps first-pass cards unchanged, adds the kept new card, and writes only its own folders", async () => {
    const root = setup();
    const before = readFileSync(join(root, FIRST, "cards.json"), "utf8");
    const fake = new FakeProvider(standIn);
    const rt = await makeRuntime(root, { maxCalls: 500, sampleMode: false, provider: fake, cacheDir: SECOND_PASS_CACHE, cacheNamespace: SECOND_PASS, deadModesFile: join(root, "state/run-3/dead-modes.json") });
    const report = await runSecondPass(root, rt, loadDataset(root), join(root, FIRST), "state/run-3");
    const first = JSON.parse(before) as DecisionCard[];
    const merged = JSON.parse(readFileSync(join(root, "state/run-3/cards.json"), "utf8")) as DecisionCard[];
    expect(merged.slice(0, first.length)).toEqual(first);
    expect(merged.slice(first.length).map((c) => [c.card_id, c.record_id, c.quote])).toEqual([["m.rec-0011.s0.0", "rec-0011", FOUND.quote]]);
    expect(report.second_pass).toMatchObject({ records_read: 69, cards_proposed: 1, cards_kept: 1, records_with_new_cards: ["rec-0011"] });
    // Only no-card records were read: one second-pass read per record, none for records that had cards.
    const reads = fake.calls.filter((c) => (c.system ?? "").startsWith("You re-read")).map((c) => c.user.match(/Record (rec-\d+) /)![1]);
    expect(new Set(reads).size).toBe(69);
    expect(reads.some((id) => first.some((c) => c.record_id === id))).toBe(false);
    // rec-0011 now has a card, so it is off the prose / rejected lists of the merged report.
    expect(report.records_prose_reply).not.toContain("rec-0011");
    expect(readFileSync(join(root, FIRST, "cards.json"), "utf8")).toBe(before); // snapshot untouched
    expect(readdirSync(join(root, "cache"))).toEqual([]); // cache/ untouched
    expect(readdirSync(join(root, SECOND_PASS_CACHE)).length).toBeGreaterThan(0);
    expect(existsSync(join(root, "state/cards.json"))).toBe(false); // state/ itself never written
  });

  it("stops the run when NVIDIA rejects response_format, on the first call", async () => {
    const sent: Record<string, unknown>[] = [];
    const fetchImpl = (async (_u: string, init: { body: string }) => {
      sent.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ error: "Unsupported parameter: response_format" }), { status: 400 });
    }) as unknown as typeof fetch;
    const direct = new NvidiaDirect({ apiKey: "test-key-not-real", fetch: fetchImpl, jsonObject: true, sleep: async () => {} });
    await expect(direct.chat({ model: "nvidia/nemotron-3.5-lightning-30b-a3b", user: "x" })).rejects.toBeInstanceOf(ResponseFormatRejected);
    expect(sent[0].response_format).toEqual({ type: "json_object" });
    expect(sent[0].chat_template_kwargs).toBeUndefined(); // thinking stays on

    const root = setup();
    const rt = await makeRuntime(root, { maxCalls: 500, sampleMode: false, provider: Object.assign(Object.create(direct), { id: "nvidia-direct" }), cacheDir: SECOND_PASS_CACHE, cacheNamespace: SECOND_PASS, deadModesFile: join(root, "state/run-3/dead-modes.json") });
    await expect(runSecondPass(root, rt, loadDataset(root), join(root, FIRST), "state/run-3")).rejects.toBeInstanceOf(ResponseFormatRejected);
    expect(sent).toHaveLength(2); // one call in the run, then it stopped (no retry, no next record)
    expect(existsSync(join(root, "state/run-3/cards.json"))).toBe(false);
  });
});
