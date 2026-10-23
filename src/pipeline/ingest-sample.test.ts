// ingest --records/--out (sample mode), on a temporary copy of data/ and eval/gold/ with a fake provider
// that answers extraction from the gold cards. No network.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseArgs } from "../cli/args.ts";
import { parseJsonl } from "../engine/data.ts";
import type { DecisionCard } from "../engine/types.ts";
import { modeDisputes } from "../eval/extraction-score.ts";
import { sampleScore } from "../eval/sample-score.ts";
import { FakeProvider } from "../llm/fake.ts";
import type { ChatRequest } from "../llm/provider.ts";
import { runIngest, sampleOutDir } from "./ingest.ts";
import { makeRuntime } from "./runtime.ts";

const repo = join(import.meta.dirname, "../..");
const gold = parseJsonl<DecisionCard>(readFileSync(join(repo, "eval/gold/gold_cards.jsonl"), "utf8"));
const SAMPLE = ["rec-0028", "rec-0069", "rec-0107"];

function tempRoot() {
  const dir = mkdtempSync(join(tmpdir(), "unexplained-sample-"));
  cpSync(join(repo, "data"), join(dir, "data"), { recursive: true });
  cpSync(join(repo, "eval/gold"), join(dir, "eval/gold"), { recursive: true });
  return dir;
}

function fake(asked: string[]) {
  return (req: ChatRequest): string => {
    const sys = req.system ?? "";
    if (sys.startsWith("You extract")) {
      const rec = req.user.match(/^Record (rec-\d+)/)![1];
      asked.push(rec);
      return JSON.stringify({ cards: gold.filter((c) => c.record_id === rec).map(({ card_id: _i, record_id: _r, ...c }) => c) });
    }
    if (sys.startsWith("You check extracted")) {
      const ids = [...req.user.matchAll(/"id":"([^"]+)"/g)].map((m) => m[1]);
      return JSON.stringify({ verdicts: ids.map((id) => ({ id, supported: true })) });
    }
    throw new Error(`sample mode must not ask: ${sys.slice(0, 40)}`);
  };
}

describe("ingest sample mode", () => {
  it("--records restricts extraction to those records and runs no Keeper", async () => {
    const root = tempRoot();
    const asked: string[] = [];
    const rt = await makeRuntime(root, { maxCalls: 100, sampleMode: false, provider: new FakeProvider(fake(asked)) });
    const report = await runIngest(root, rt, undefined, { records: SAMPLE, out: "state/sample-test" });
    expect([...new Set(asked)].sort()).toEqual(SAMPLE);
    expect(report.records_total).toBe(3);
    expect(report.pairs_total).toBe(0);
    expect(rt.events.some((e) => e.agent.startsWith("Keeper"))).toBe(false);
    const cards = JSON.parse(readFileSync(join(root, "state/sample-test/cards.json"), "utf8")) as DecisionCard[];
    expect(cards.every((c) => SAMPLE.includes(c.record_id))).toBe(true);
    expect(cards.length).toBe(gold.filter((g) => SAMPLE.includes(g.record_id)).length);
  }, 60_000);

  it("--out leaves state/cards.json and the rest of state/ byte-identical", async () => {
    const root = tempRoot();
    mkdirSync(join(root, "state"), { recursive: true });
    const before = { "cards.json": '[{"card_id":"keep-me"}]\n', "edges.json": "[]\n", "ingest-report.json": '{"complete":true}\n', "seats.json": "{}\n", "hmem-snapshot.json": "{}\n" };
    for (const [f, text] of Object.entries(before)) writeFileSync(join(root, "state", f), text);
    const rt = await makeRuntime(root, { maxCalls: 100, sampleMode: false, provider: new FakeProvider(fake([])) });
    await runIngest(root, rt, undefined, { records: SAMPLE, out: "state/sample-007" });
    for (const [f, text] of Object.entries(before)) expect(readFileSync(join(root, "state", f), "utf8")).toBe(text);
    expect(readdirSync(join(root, "state")).sort()).toEqual([...Object.keys(before), "sample-007"].sort());
    expect(readdirSync(join(root, "state/sample-007")).sort()).toEqual(["cards.json", "ingest-report.json", "review-queue.json"]);
  }, 60_000);

  it("refuses unknown record ids and an --out of state/ itself", async () => {
    const root = tempRoot();
    const rt = await makeRuntime(root, { maxCalls: 100, sampleMode: false, provider: new FakeProvider(fake([])) });
    await expect(runIngest(root, rt, undefined, { records: ["rec-9999"], out: "state/x" })).rejects.toThrow(/rec-9999/);
    expect(() => sampleOutDir(root, "state")).toThrow(/--out/);
    expect(() => sampleOutDir(root, "./state/")).toThrow(/--out/);
    expect(sampleOutDir(root, "state/sample-007")).toBe(join(root, "state/sample-007"));
  });

  it("parses --records and --out", () => {
    const a = parseArgs(["--records", "rec-0028, rec-0069", "--out", "state/s", "--max-calls", "40"]);
    expect(a.records).toEqual(["rec-0028", "rec-0069"]);
    expect(a.out).toBe("state/s");
  });
});

describe("sample score", () => {
  const sampleGold = gold.filter((g) => SAMPLE.includes(g.record_id));
  const asModel = (cs: DecisionCard[]) => cs.map((c, i) => ({ ...c, card_id: `m.${c.record_id}.0.${i}` }));

  it("scores against gold restricted to the sample, for the sample and for the current cards", () => {
    // Current cards: every gold card in the dataset (as if a perfect full ingest), so outside cards exist.
    const s = sampleScore(SAMPLE, asModel(sampleGold), asModel(gold), gold);
    expect(s.gold_cards).toBe(sampleGold.length);
    expect(s.sample.recall).toBe(1);
    expect(s.sample.precision).toBe(1);
    expect(s.current!.cards).toBe(sampleGold.length); // cards outside the sample are not counted
    expect(s.current!.recall).toBe(1);
    const goldByMode = Object.values(s.sample.by_mode).reduce((n, m) => n + m.gold, 0);
    expect(goldByMode).toBe(sampleGold.length);
  });

  it("an empty sample has recall 0 and no precision; no current cards prints as none", () => {
    const s = sampleScore(SAMPLE, [], null, gold);
    expect(s.sample.recall).toBe(sampleGold.length ? 0 : null);
    expect(s.sample.precision).toBeNull();
    expect(s.current).toBeNull();
  });
});

describe("mode disputes", () => {
  const g = (id: string, mode: DecisionCard["mode"], quote: string) => ({ card_id: id, record_id: "rec-1", mode, quote }) as DecisionCard;

  it("lists an unmatched model card whose quote matches an unmatched gold card of another mode", () => {
    const goldCards = [g("g1", "decides", "Approved the second version on Friday."), g("g2", "proposes", "We will come back next week.")];
    const model = [g("m1", "mentions", "Approved the second version on Friday."), g("m2", "proposes", "We will come back next week.")];
    const d = modeDisputes(model, goldCards);
    expect(d.map((x) => [x.model.card_id, x.gold.card_id])).toEqual([["m1", "g1"]]);
  });

  it("ignores a gold card already matched by another model card and quotes below the match threshold", () => {
    const goldCards = [g("g1", "decides", "Approved the second version on Friday.")];
    const model = [g("m1", "decides", "Approved the second version on Friday."), g("m2", "mentions", "Approved the second version on Friday."), g("m3", "mentions", "Approved.")];
    expect(modeDisputes(model, goldCards)).toEqual([]);
  });
});
