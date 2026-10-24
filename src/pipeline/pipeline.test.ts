// End to end on a temporary copy of data/ and eval/gold/, with a fake provider that answers like a
// perfect model (from the gold files). Proves the wiring, the budget stop and SAMPLE_MODE replay;
// it says nothing about how good a real model is.
import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseJsonl } from "../engine/data.ts";
import type { DecisionCard, RelationEdge } from "../engine/types.ts";
import { FakeProvider } from "../llm/fake.ts";
import type { ChatRequest } from "../llm/provider.ts";
import { buildEngine } from "../engine/engine.ts";
import { agentContext } from "../agents/shared.ts";
import { runLive } from "../eval/live.ts";
import type { GoldQuestion } from "../eval/scoring.ts";
import { runAsk } from "./ask.ts";
import { loadIngested, runIngest } from "./ingest.ts";
import { makeRuntime } from "./runtime.ts";

const repo = join(import.meta.dirname, "../..");
function tempRoot() {
  const dir = mkdtempSync(join(tmpdir(), "unexplained-"));
  cpSync(join(repo, "data"), join(dir, "data"), { recursive: true });
  cpSync(join(repo, "eval/gold"), join(dir, "eval/gold"), { recursive: true });
  return dir;
}
const gold = <T>(f: string) => parseJsonl<T>(readFileSync(join(repo, "eval/gold", f), "utf8"));
const cards = gold<DecisionCard>("gold_cards.jsonl");
const edges = gold<RelationEdge>("gold_edges.jsonl");
const questions = gold<GoldQuestion>("gold_questions.jsonl");

// Model card ids look like m.<record>.<round>.<n>; the fake numbers a record's gold cards in order.
const goldOf = (modelId: string) => {
  const [, rec, , n] = modelId.match(/^m\.(rec-\d+)\.(\d+)\.(\d+)$/) ?? [];
  return cards.filter((c) => c.record_id === rec)[Number(n)];
};

function perfect(req: ChatRequest): string {
  const sys = req.system ?? "";
  if (sys.startsWith("You extract")) {
    const rec = req.user.match(/^Record (rec-\d+)/)![1];
    const out = cards.filter((c) => c.record_id === rec).map(({ card_id: _i, record_id: _r, ...c }) => c);
    return JSON.stringify({ cards: out });
  }
  if (sys.startsWith("You check extracted")) {
    const ids = [...req.user.matchAll(/"id":"([^"]+)"/g)].map((m) => m[1]);
    return JSON.stringify({ verdicts: ids.map((id) => ({ id, supported: true })) });
  }
  if (sys.startsWith("You compare")) {
    const [a, b] = [...req.user.matchAll(/^(m\.rec-\d+\.\d+\.\d+) decided/gm)].map((m) => goldOf(m[1])?.card_id);
    const e = edges.find((x) => x.old_card === a && x.new_card === b);
    return JSON.stringify({ relation: e?.relation ?? "UNRELATED", reason: "fake" });
  }
  if (sys.startsWith("You route")) {
    const text = req.user.match(/^Question: (.*)$/m)![1];
    const q = questions.find((x) => x.question === text);
    const card = cards.find((c) => c.card_id === (q?.expected_current_card ?? q?.expected_in_effect_card));
    return JSON.stringify({ question_type: "other", seats: q?.seats ?? [], topic: card?.topic ?? null, facets: card?.facets ?? [], as_of: null });
  }
  if (sys.startsWith("You check whether")) return JSON.stringify({ lines: [] });
  if (sys.startsWith("You write")) return JSON.stringify({ sentences: [{ text: "The records show the warnings listed.", cites: [] }] });
  if (sys.startsWith("You check a short answer")) return JSON.stringify({ verdicts: [{ id: "1", supported: true }] });
  throw new Error(`fake has no reply for: ${sys.slice(0, 40)}`);
}

describe("pipeline with a fake provider", () => {
  it("ingests every record, matches the gold cards and relations, and answers the dev subset", async () => {
    const root = tempRoot();
    const rt = await makeRuntime(root, { maxCalls: 1000, sampleMode: false, provider: new FakeProvider(perfect) });
    const report = await runIngest(root, rt);
    expect(report.complete).toBe(true);
    expect(report.cards_gate_rejected).toEqual([]);
    const live = await runLive(root, rt, "dev");
    expect(live.answered).toBe(12);
    expect(live.route).toBe("fake"); // the results name the provider route that answered
    expect(live.extraction.recall).toBe(1);
    expect(live.extraction.precision).toBe(1);
    expect(live.relations.accuracy).toBe(1);
    expect(live.summary.ctrl_false_alarms).toBe(0);
    expect(rt.events.every((e) => e.model_answered === "fake/model")).toBe(true);
  }, 60_000);

  it("stops at the budget and still writes what it has", async () => {
    const root = tempRoot();
    const rt = await makeRuntime(root, { maxCalls: 5, sampleMode: false, provider: new FakeProvider(perfect) });
    const report = await runIngest(root, rt);
    expect(report.complete).toBe(false);
    expect(report.stopped_reason).toMatch(/call budget of 5/);
    expect(rt.client.budget.used).toBe(5);
    expect(loadIngested(root).cards.length).toBeGreaterThan(0);
  }, 60_000);

  it("SAMPLE_MODE replays a recorded sample with no provider, and refuses anything else", async () => {
    const root = tempRoot();
    const sample = questions.find((q) => q.question_id === "q-p5-nl04-why")!;
    const input = { question_id: sample.question_id, question: sample.question, as_of: sample.as_of };
    const live = await makeRuntime(root, { maxCalls: 1000, sampleMode: false, teeSamples: true, provider: new FakeProvider(perfect) });
    await runIngest(root, live);
    const e1 = buildEngine(root, loadIngested(root).cards, loadIngested(root).edges);
    const recorded = await runAsk(e1, agentContext(root, e1.data, e1.vocab), live, input);

    const replay = await makeRuntime(root, { maxCalls: 0, sampleMode: true });
    await runIngest(root, replay);
    const e2 = buildEngine(root, loadIngested(root).cards, loadIngested(root).edges);
    const replayed = await runAsk(e2, agentContext(root, e2.data, e2.vocab), replay, input);
    expect(replayed.answer.flags.map((f) => f.pattern)).toEqual(recorded.answer.flags.map((f) => f.pattern));
    expect(replayed.prose).toBe(recorded.prose);
    expect(replay.events.every((e) => e.cache === "hit")).toBe(true);

    const other = questions.find((q) => q.question_id === "q-p1-nl02-send-v3")!;
    await expect(runAsk(e2, agentContext(root, e2.data, e2.vocab), replay, { question_id: other.question_id, question: other.question, as_of: other.as_of })).rejects.toThrow(/needs model credentials/);
  }, 60_000);
});
