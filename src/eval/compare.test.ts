// The A-vs-C rules of docs/eval-protocol-011.md (no network; a fake provider where a model would answer).
import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadDataset, parseJsonl } from "../engine/data.ts";
import type { Answer } from "../engine/answer.ts";
import type { DecisionCard } from "../engine/types.ts";
import { loadVocab } from "../engine/vocab.ts";
import { FakeProvider } from "../llm/fake.ts";
import type { ChatRequest } from "../llm/provider.ts";
import { makeRuntime } from "../pipeline/runtime.ts";
import { classifyA, classifyC, runGroupA, tallyGroup } from "./compare.ts";
import { aAnswer, aInputs, aPrompt } from "./group-a.ts";
import type { AReply } from "./group-a.ts";
import { subsetQuestions } from "./live.ts";
import type { GoldQuestion } from "./scoring.ts";

const repo = join(import.meta.dirname, "../..");
const data = loadDataset(repo);
const vocab = loadVocab(repo);
const gold = parseJsonl<DecisionCard>(readFileSync(join(repo, "eval/gold/gold_cards.jsonl"), "utf8"));
const dev = subsetQuestions(repo, "dev");
const q = (id: string) => dev.find((x) => x.question_id === id)!;
const ctrl = q("q-ctrl-oc01-inv"); // expects no flags
const p7 = q("q-p7-pw03-inv"); // expects P7
const reply = (over: Partial<AReply>): AReply => ({ verdict: "warn", flags: [], current: null, in_effect: null, reasons: [], cannot_tell_because: null, ...over });
// A reply that passes a question: its expected cards quoted exactly from gold, its expected flags raised.
function passing(gq: GoldQuestion, verdict: AReply["verdict"]): AReply {
  const ref = (id: string | null) => {
    const c = gold.find((g) => g.card_id === id);
    return c ? { record_id: c.record_id, quote: c.quote, mode: c.mode } : null;
  };
  return reply({
    verdict, flags: gq.expected_flags, current: ref(gq.expected_current_card), in_effect: ref(gq.expected_in_effect_card),
    reasons: gq.expected_reasons.filter((r) => r !== "not_recorded").map((r) => ref(r)!), cannot_tell_because: verdict === "cannot_tell" ? "unclear" : null,
  });
}

describe("group A inputs", () => {
  it("A's prompt holds no record written after as_of; the document in hand is added and labelled", () => {
    const send = q("q-p1-nl02-send-v3"); // v3 is sent 15 minutes after as_of
    const inputs = aInputs(data, vocab, send);
    const at = Date.parse(send.as_of!);
    expect(inputs.records.every((r) => Date.parse(r.source_recorded_at) <= at)).toBe(true);
    expect(inputs.inHand?.text).toMatch(/Q-NL-02-v3/);
    const prompt = aPrompt(send, inputs);
    const later = data.records.filter((r) => Date.parse(r.source_recorded_at) > at && r.record_id !== inputs.inHand!.record_id);
    expect(later.length).toBeGreaterThan(0);
    for (const r of later) expect(prompt).not.toContain(`[${r.record_id}]`);
    expect(prompt).toContain(`The document in hand (not sent yet):\n[${inputs.inHand!.record_id}]`);
  });

  it("no extra document when the one in hand was already written by as_of", () => {
    expect(aInputs(data, vocab, p7).inHand).toBeNull();
  });
});

describe("outcome rules", () => {
  it("A cannot_tell + failing -> handed_to_person; cannot_tell + passing -> correct, passed while abstaining", () => {
    const failing = classifyA(p7, reply({ verdict: "cannot_tell", cannot_tell_because: "the approved version is not recorded" }), undefined, gold);
    expect(failing.outcome).toBe("handed_to_person");
    const empty = classifyA(p7, reply({ verdict: "cannot_tell", cannot_tell_because: null }), undefined, gold);
    expect(empty.outcome).toBe("confidently_wrong"); // no reason given: not a hand-over
    const passed = classifyA(p7, passing(p7, "cannot_tell"), undefined, gold);
    expect(passed).toMatchObject({ outcome: "correct", abstained: true });
    expect(classifyA(p7, passing(p7, "warn"), undefined, gold)).toMatchObject({ outcome: "correct", abstained: false });
    expect(classifyA(p7, reply({ verdict: "clear" }), undefined, gold).outcome).toBe("confidently_wrong");
    const t = tallyGroup([{ ...passed, question_id: "x", group: "a", records_given: 1, model: null }]);
    expect(t).toMatchObject({ passed_while_abstaining: 1, counts: { correct: 1 } });
  });

  it("A with no usable reply -> unscorable", () => {
    expect(classifyA(ctrl, null, "reply was prose, not JSON", gold).outcome).toBe("unscorable");
  });

  it("C with open items + failing -> handed_to_person; without -> confidently_wrong; Router without a reply -> unscorable", () => {
    const wrong = { flags: [], current_card: null, in_effect_card: null, reasons: [] } as unknown as Answer;
    const open = [{ kind: "needs_human" as const, record_id: "rec-0170", text: "the model service failed" }];
    expect(classifyC(p7, wrong, undefined, open)).toMatchObject({ outcome: "handed_to_person", abstained: true });
    expect(classifyC(p7, wrong, undefined, []).outcome).toBe("confidently_wrong");
    expect(classifyC(p7, null, "reply was prose, not JSON", open).outcome).toBe("unscorable");
    const right = { flags: [{ pattern: "P7" }], current_card: p7.expected_current_card, in_effect_card: p7.expected_in_effect_card, reasons: p7.expected_reasons } as unknown as Answer;
    expect(classifyC(p7, right, undefined, open)).toMatchObject({ outcome: "correct", abstained: true });
  });

  it("A's quotes go through matchCards with the unchanged rule: same record, same mode, overlap >= 0.8", () => {
    const g = gold.find((c) => c.card_id === p7.expected_current_card)!;
    const words = g.quote.split(" ");
    const at = (quote: string, mode = g.mode) => aAnswer(reply({ current: { record_id: g.record_id, quote, mode } }), gold).current_card;
    expect(at(g.quote)).toBe(g.card_id);
    expect(at(g.quote, g.mode === "decides" ? "mentions" : "decides")).toBe("a.current"); // other mode: no match
    expect(at(words.slice(0, Math.floor(words.length / 2)).join(" "))).toBe("a.current"); // half the words: below 0.8
  });
});

describe("group A run", () => {
  it("prose after retries is unscorable; a valid reply is scored with one call", async () => {
    const root = mkdtempSync(join(tmpdir(), "unexplained-compare-"));
    cpSync(join(repo, "data"), join(root, "data"), { recursive: true });
    cpSync(join(repo, "eval/gold"), join(root, "eval/gold"), { recursive: true });
    const answers = (req: ChatRequest) => (req.user.includes(ctrl.question) ? JSON.stringify(passing(ctrl, "clear")) : "1. First I would read the records. 2. Then decide.");
    const rt = await makeRuntime(root, { maxCalls: 50, sampleMode: false, provider: new FakeProvider(answers) });
    const run = await runGroupA({ root, rt, data, gold, questions: [ctrl, p7] });
    expect(run.results.map((r) => [r.question_id, r.outcome])).toEqual([[ctrl.question_id, "correct"], [p7.question_id, "unscorable"]]);
    expect(run.results[1].why).toMatch(/prose/);
    expect(rt.client.budget.used).toBe(1 + 3); // one call for the valid reply; the prose one is asked 1 + 2 retries
    expect(run.results[0].records_given).toBe(data.records.filter((r) => Date.parse(r.source_recorded_at) <= Date.parse(ctrl.as_of!)).length);
  });
});

describe("protocol", () => {
  it("is pre-registered and says the rules apply unchanged to the full set and group B", () => {
    const p = readFileSync(join(repo, "docs/eval-protocol-011.md"), "utf8");
    expect(p).toMatch(/committed before the first A\/C run; they are not changed after seeing results/);
    expect(p).toMatch(/apply unchanged to `--subset full`/);
    expect(p).not.toMatch(/PENDING RULING/);
    expect(readFileSync(join(repo, "docs/eval-protocol-011-amendment-1.md"), "utf8")).toMatch(/before any A\/C run/);
  });
});

