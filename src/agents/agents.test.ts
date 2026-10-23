import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { loadDataset } from "../engine/data.ts";
import { verifyCards } from "../engine/verify.ts";
import { loadVocab } from "../engine/vocab.ts";
import { MemoryCache } from "../llm/cache.ts";
import { CallBudget, ModelClient } from "../llm/client.ts";
import { FakeProvider } from "../llm/fake.ts";
import { extract } from "./researcher.ts";
import { checkAnswer } from "./skeptic.ts";
import { judgeExplained } from "./judge.ts";
import { route } from "./router.ts";
import { seatPairs } from "./keeper.ts";
import { agentContext } from "./shared.ts";

const root = join(import.meta.dirname, "../..");
const data = loadDataset(root);
const vocab = loadVocab(root);
const ctx = agentContext(root, data, vocab);
const client = (reply: (user: string) => string) => new ModelClient(new FakeProvider((r) => reply(r.user)), new MemoryCache(), new CallBudget(20));
const rec = data.records.find((r) => r.text.startsWith("Anything over $2500 needs a one-line note"))!;

describe("Researcher + gate", () => {
  it("turns phrases into times in code and keeps a verbatim card", async () => {
    const reply = () =>
      JSON.stringify({ cards: [{ mode: "decides", topic: "client_rule", facets: ["client_rule.cap"], scope: "client:cl.north_loft", decided_at: "record_time", effective: "record_time", decided_by: "p.nl.ria_moth", quote: "Anything over $2500 needs a one-line note from me before you submit" }] });
    const r = await extract(client(reply), "meterless/auto", rec, ctx);
    expect(r.cards[0].decided_at).toBe(rec.source_recorded_at);
    expect(verifyCards(r.cards, data.records, vocab)[0].result).toBe("PASS");
  });

  it("a hallucinated quote is rejected by the verbatim check", async () => {
    const reply = () =>
      JSON.stringify({ cards: [{ mode: "decides", topic: "client_rule", facets: ["client_rule.cap"], scope: "client:cl.north_loft", decided_at: "record_time", effective: "record_time", decided_by: "p.nl.ria_moth", quote: "Anything over $5000 is fine without a note" }] });
    const r = await extract(client(reply), "meterless/auto", rec, ctx);
    const [checked] = verifyCards(r.cards, data.records, vocab);
    expect(checked.result).toBe("REJECTED");
    expect(checked.reason).toMatch(/quote not found/);
  });

  it("a record whose replies stay invalid after 2 retries is rejected, not guessed", async () => {
    const r = await extract(client(() => "I think there is a cap rule."), "meterless/auto", rec, ctx);
    expect(r.rejected).toBe(true);
  });
});

describe("Skeptic stage 2", () => {
  it("removes an unsupported sentence and lists it under unresolved", async () => {
    const sentences = [
      { text: "Otto rejected v3 without giving a reason.", cites: ["rec-0270"] },
      { text: "Otto rejected it because it was too expensive.", cites: ["rec-0270"] },
    ];
    const reply = () => JSON.stringify({ verdicts: [{ id: "1", supported: true }, { id: "2", supported: false, why: "the client never mentions price" }] });
    const r = await checkAnswer(client(reply), "meterless/auto", { rejections: ["Rejected."] }, sentences);
    expect(r.kept.map((s) => s.text)).toEqual(["Otto rejected v3 without giving a reason."]);
    expect(r.removed[0].why).toMatch(/never mentions price/);
  });

  it("when the check itself fails, nothing is vouched for", async () => {
    const r = await checkAnswer(client(() => "no"), "meterless/auto", {}, [{ text: "x", cites: [] }]);
    expect(r.kept).toEqual([]);
    expect(r.removed).toHaveLength(1);
  });
});

describe("Judge, Router, Keeper gates", () => {
  it("an 'explained' line whose quote is not in the quote text counts as not explained", async () => {
    const reply = () => JSON.stringify({ lines: [{ description: "40gal electric water heater", explained: true, quote: "price rose because of a new supplier" }] });
    const r = await judgeExplained(client(reply), "m", [{ change: "changed", kind: "material", description: "40gal electric water heater", delta: 170 }], "Quote Q-X. Scope: Swap heater.");
    expect(r!.lines[0]).toMatchObject({ explained: false, rejected_quote: true });
    expect(r!.clientExplanation).toBe("absent");
  });

  it("Router drops unknown seats and facets; with nothing valid left it is NOT_FOUND", async () => {
    const good = await route(client(() => JSON.stringify({ question_type: "rule_check", seats: ["job:WO-NL-04", "job:WO-ZZ-99"], topic: "client_rule", facets: ["client_rule.cap", "made.up"], as_of: null })), "m", "q", ctx, null);
    expect(good).toMatchObject({ seats: ["job:WO-NL-04"], facets: ["client_rule.cap"], dropped: ["job:WO-ZZ-99", "made.up"], status: "OK" });
    const bad = await route(client(() => JSON.stringify({ question_type: "other", seats: ["job:nope"], topic: "x", facets: [], as_of: null })), "m", "q", ctx, null);
    expect(bad.status).toBe("NOT_FOUND");
  });

  it("Keeper pairs only client decisions that share a seat, older first", () => {
    const base = { record_id: "r", quote: "q", topic: "price", scope: "client:c", effective: "2026-03-01T00:00:00-06:00", decided_by: "p" };
    const pairs = seatPairs([
      { ...base, card_id: "new", mode: "decides", facets: ["price.labor"], decided_at: "2026-05-01T00:00:00-05:00" },
      { ...base, card_id: "old", mode: "decides", facets: ["price.labor"], decided_at: "2026-03-01T00:00:00-06:00" },
      { ...base, card_id: "mat", mode: "decides", facets: ["price.material"], decided_at: "2026-04-01T00:00:00-05:00" },
      { ...base, card_id: "note", mode: "mentions", facets: ["price.labor"], decided_at: "2026-04-01T00:00:00-05:00" },
    ]);
    expect(pairs.map(([a, b]) => `${a.card_id}>${b.card_id}`)).toEqual(["old>new"]);
  });
});
