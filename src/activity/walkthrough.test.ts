import { describe, expect, it } from "vitest";
import { citedIds, joinSteps, parseTrace, redact, renderStep, sha } from "./walkthrough.ts";
import type { ReplayCall } from "./walkthrough.ts";

// Two calls as ModelClient would hash them: GroupA (invalid once, then a usable retry) and Router (cache hit).
const call = (agent: string, stage: string, model: string, system: string, user: string): ReplayCall => ({
  stage,
  agent,
  prompt_hash: sha(`${model}\n${system}\n${user}`),
  invalid_hash: sha(user),
  cache_key: sha(JSON.stringify([model, system, user, 0])),
  role: system.split("\n")[0],
});
const a = call("GroupA", "compare", "meterless/auto", "You are the gatekeeper.\nRules…", "Question about WO-PW-05");
const r = call("Router", "answer", "meterless/auto", "You route a question.", "Question: can we invoice?");
const never = call("Explainer", "answer", "meterless/auto", "You write a short answer.", "never sent");

const line = (agent: string, input_ref: string, outcome: string, retry_count = 0, latency_ms = 0, action = "model_call") =>
  JSON.stringify({ timestamp: "2026-10-24T21:44:49.435Z", run_id: "fixture", phase: agent === "GroupA" ? "compare" : "answer", agent, action, input_ref, output_ref: "", outcome, retry_count, latency_ms });

const TRACE = [
  line("GroupA", sha("unrelated"), "ok;cache=miss;route=nvidia-direct;requested=nv/lightning;model=nv/lightning", 0, 900),
  line("GroupA", a.prompt_hash, "ok;cache=miss;route=nvidia-direct;requested=nv/lightning;model=nv/lightning", 0, 45000),
  line("GroupA", a.invalid_hash, "invalid;cache=miss;route=nvidia-direct;requested=nv/lightning;model=nv/lightning", 0, 0),
  line("GroupA", sha("retry prompt quoting the error"), "ok;cache=miss;route=nvidia-direct;requested=nv/lightning;model=nv/lightning", 1, 30000),
  line("Router", r.prompt_hash, "ok;cache=hit;route=cache;requested=meterless/auto;model=nv/super"),
  line("Router", r.prompt_hash, "requested=meterless/deep;dead=x (dead);used=meterless/auto;model=nv/super", 0, 0, "route_fallback"),
  line("Explainer", sha("someone else"), "ok;cache=miss;model=nv/lightning", 0, 100),
].join("\n");

describe("activity walkthrough builder", () => {
  it("parses the current and the older outcome formats", () => {
    const t = parseTrace(TRACE);
    expect(t[1]).toMatchObject({ line: 2, status: "ok", fields: { cache: "miss", route: "nvidia-direct", model: "nv/lightning" } });
    expect(t[5].status).toBe("route_fallback");
    expect(t[6].fields).toEqual({ cache: "miss", model: "nv/lightning" }); // 10-23 format: no route, no requested
  });

  it("joins each rebuilt prompt to its own trace lines, retries and fallbacks included, and never guesses", () => {
    const { steps, unmatched } = joinSteps(parseTrace(TRACE), [a, r, never]);
    expect(steps.map((s) => [s.call.agent, s.lines.map((l) => l.line)])).toEqual([
      ["GroupA", [2, 3, 4]], // the unrelated GroupA line 1 is not taken
      ["Router", [5, 6]],
    ]);
    expect(unmatched.map((u) => u.agent)).toEqual(["Explainer"]); // line 7 has another prompt: left out
  });

  it("renders the trace values as recorded and the reply the step used, with what it cited", () => {
    const { steps } = joinSteps(parseTrace(TRACE), [a]);
    const md = renderStep(1, steps[0], { model: "nv/lightning", parsed: { verdict: "warn", reasons: [{ record_id: "rec-0270" }, { record_id: "rec-0265" }], current_card: "card.pw05.reject.v3" } });
    expect(md).toContain("| 2 | compare | GroupA | nvidia-direct | nv/lightning | nv/lightning | miss | ok | 45000 | 0 |");
    expect(md).toContain("| 4 | compare | GroupA | nvidia-direct | nv/lightning | nv/lightning | miss | ok | 30000 | 1 |");
    expect(md).toContain('"verdict": "warn"');
    expect(md).toContain("Reply cited: rec-0270, rec-0265, card.pw05.reject.v3");
    const none = renderStep(2, { call: a, lines: parseTrace(TRACE).slice(1, 3) }, null);
    expect(none).toContain("No reply used: every attempt came back unusable");
  });

  it("cuts a long reply and says where the rest is", () => {
    const { steps } = joinSteps(parseTrace(TRACE), [a]);
    const md = renderStep(1, steps[0], { parsed: { text: "x".repeat(5000) } }, 200);
    expect(md).toMatch(/more characters, cut here; the whole reply is in cache\//);
  });

  it("reads ids out of a reply", () => {
    expect(citedIds({ cites: ["rec-0260", "rec-0260"], card: "m.rec-0270.0.0", h: "h.rec-0254.1" })).toEqual({ records: ["rec-0260", "rec-0270", "rec-0254"], cards: ["m.rec-0270.0.0", "h.rec-0254.1"] });
  });

  it("redacts keys, tokens, account ids and local paths, and lists them without echoing them", () => {
    const dirty = [
      '{"outcome":"error: Function id abc: not found for account acct-1234567"}',
      '{"h":"Authorization: Bearer abc.def.ghi","k":"nvapi-SECRETSECRET"}',
      '{"p":"/Users/someone/hackathon/unexplained/cache/x.json"}',
      '{"clean":true}',
    ].join("\n");
    const { text, findings } = redact(dirty);
    expect(text).not.toMatch(/acct-1234567|abc\.def\.ghi|SECRETSECRET|\/Users\//);
    expect(findings.map((f) => [f.line, f.kind])).toEqual([[1, "account id"], [2, "nvidia key"], [2, "bearer token"], [3, "local path"]]);
    expect(JSON.stringify(findings)).not.toMatch(/SECRET|acct-/);
    expect(redact('{"clean":true}').findings).toEqual([]);
  });
});
