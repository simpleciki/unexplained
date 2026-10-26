// Agent activity walkthroughs (task 024): turn a trace from logs/ plus the replies in cache/ into a readable,
// step-by-step page a judge can follow. Pure functions only; scripts/activity-log.ts does the replay and the I/O.
//
// How a trace line is joined to its reply: the trace stores input_ref = sha256(model \n system \n user) of the first
// attempt (sha256(user) on an "invalid" line), the cache stores the reply under sha256(JSON [model, system, user,
// temperature]). The two hashes differ, so the CLI replays the same code with no model behind it, rebuilds each
// prompt, and computes both. A step is only joined when the rebuilt prompt hash equals the trace's input_ref.
import { createHash } from "node:crypto";
import type { TraceEvent } from "../trace.ts";

export const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

// One trace line with its outcome string split into fields. The current format is
// "ok;cache=miss;route=nvidia-direct;requested=<mode>;model=<id>"; the 10-23 format has no route/requested;
// a route_fallback line is "requested=<mode>;dead=<model>;used=<mode>;model=<id>".
export type TraceLine = TraceEvent & { line: number; status: string; fields: Record<string, string> };

export function parseTrace(text: string): TraceLine[] {
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((l, i) => {
      const e = JSON.parse(l) as TraceEvent;
      const parts = e.outcome.split(";");
      const fields: Record<string, string> = {};
      let status = "";
      for (const p of parts) {
        const at = p.indexOf("=");
        if (at < 0) status = p;
        else fields[p.slice(0, at)] = p.slice(at + 1);
      }
      if (e.action === "route_fallback") status = "route_fallback";
      return { ...e, line: i + 1, status, fields };
    });
}

// A call the replay rebuilt: what the trace would have recorded for its first attempt.
export type ReplayCall = {
  stage: string;
  agent: string;
  prompt_hash: string; // sha256(model \n system \n user): input_ref of the attempt-0 lines
  invalid_hash: string; // sha256(user): input_ref of an attempt-0 "invalid" line
  cache_key: string; // file name in cache/ (without .json)
  role: string; // first line of the system prompt: what the agent was asked to do
  inputs?: { records: string[]; cards: string[] }; // ids named in the prompt (the prompt text itself is never written)
};

export type Step = { call: ReplayCall; lines: TraceLine[] };

// Joins replayed calls to trace lines, in order. A step = the line whose input_ref equals the rebuilt hash, plus
// the lines right after it that belong to the same attempt chain: same agent, and either the same input_ref (an
// upstream error, a route fallback), the attempt-0 "invalid" line, or a retry (retry_count > 0; a retry's prompt
// quotes the error back, so its hash cannot be rebuilt). Calls never found in the trace are returned as unmatched.
export function joinSteps(trace: TraceLine[], calls: ReplayCall[]): { steps: Step[]; unmatched: ReplayCall[] } {
  const used = new Set<number>();
  const steps: Step[] = [];
  const unmatched: ReplayCall[] = [];
  let cursor = 0;
  for (const call of calls) {
    const find = (from: number) => trace.findIndex((t, i) => i >= from && !used.has(i) && t.agent === call.agent && t.input_ref === call.prompt_hash);
    let at = find(cursor);
    if (at < 0) at = find(0);
    if (at < 0) {
      unmatched.push(call);
      continue;
    }
    const lines = [trace[at]];
    used.add(at);
    let j = at + 1;
    for (; j < trace.length; j++) {
      const t = trace[j];
      if (used.has(j) || t.agent !== call.agent) break;
      const sameChain = t.input_ref === call.prompt_hash || t.input_ref === call.invalid_hash || t.retry_count > 0 || t.action === "route_fallback";
      if (!sameChain) break;
      lines.push(t);
      used.add(j);
    }
    cursor = j;
    steps.push({ call, lines });
  }
  return { steps, unmatched };
}

// Record and card ids a reply names, in first-seen order.
export function citedIds(reply: unknown): { records: string[]; cards: string[] } {
  const text = typeof reply === "string" ? reply : JSON.stringify(reply ?? "");
  const uniq = (re: RegExp) => [...new Set([...text.matchAll(re)].map((m) => m[0]))];
  return { records: uniq(/\brec-\d{4}\b/g), cards: uniq(/\b(?:card\.[a-z0-9_.-]*[a-z0-9]|h\.[a-z0-9_.-]*[a-z0-9]|m\.rec-\d{4}(?:\.\d+)+)\b/g) };
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}\n… (${s.length - max} more characters, cut here; the whole reply is in cache/)`;
}

const cell = (s: string | number | undefined) => String(s ?? "").replace(/\|/g, "\\|") || "—";

// The table row for one trace line, every value as the run recorded it.
export function lineRow(t: TraceLine): string {
  const f = t.fields;
  const outcome = t.action === "route_fallback" ? `route fallback: asked ${f.requested ?? "?"}, dead ${f.dead ?? "?"}, used ${f.used ?? "?"}` : t.status;
  return `| ${t.line} | ${cell(t.phase)} | ${cell(t.agent)} | ${cell(f.route)} | ${cell(f.requested)} | ${cell(f.model)} | ${cell(f.cache)} | ${cell(outcome)} | ${t.latency_ms} | ${t.retry_count} |`;
}

export const TABLE_HEAD = [
  "| trace line | phase | agent | route | requested mode | model that answered | cache | outcome | latency ms | retry |",
  "|---:|---|---|---|---|---|---|---|---:|---:|",
];

// "rec-0270, m.rec-0270.0.0" or, for a prompt that carries the whole file, a count.
export function idList(ids: { records: string[]; cards: string[] }, max = 12): string {
  const all = [...ids.records, ...ids.cards];
  if (!all.length) return "no record or card ids";
  if (all.length > max) return `${ids.records.length} records and ${ids.cards.length} cards`;
  return all.join(", ");
}

export type StepReply = { model?: string; mode?: string; parsed: unknown | null; raw?: string } | null;

// One step of the walkthrough: the trace lines, then the reply the step used (if any) and what it cited.
export function renderStep(n: number, step: Step, reply: StepReply, maxReply = 1500): string {
  const last = step.lines[step.lines.length - 1];
  const out = [
    `### Step ${n}: ${step.call.agent} (${step.call.stage})`,
    "",
    `Asked to: ${step.call.role || "(no system prompt)"}`,
    ...(step.call.inputs ? [`Prompt named: ${idList(step.call.inputs)}`] : []),
    `Prompt hash (trace input_ref): \`${step.call.prompt_hash.slice(0, 16)}…\` · reply file: \`cache/${step.call.cache_key.slice(0, 16)}….json\``,
    "",
    ...TABLE_HEAD,
    ...step.lines.map(lineRow),
    "",
  ];
  if (!reply) {
    const why = last.status === "invalid" ? "every attempt came back unusable (see the invalid lines above)" : last.status === "error" ? "the call failed upstream" : "no reply was kept for this prompt";
    out.push(`No reply used: ${why}. Nothing from this step reached the answer.`, "");
    return out.join("\n");
  }
  const body = reply.parsed !== null ? JSON.stringify(reply.parsed, null, 2) : (reply.raw ?? "");
  const ids = citedIds(reply.parsed ?? reply.raw);
  out.push(
    `Reply the step used (from the cache; answered by \`${reply.model ?? "?"}\`${reply.mode ? `, mode \`${reply.mode}\`` : ""}):`,
    "",
    "```json",
    truncate(body, maxReply),
    "```",
    "",
    `Reply cited: ${ids.records.length + ids.cards.length ? idList(ids, 40) : "no record or card ids"}`,
    "",
  );
  return out.join("\n");
}

// --- redaction of a trace before it is copied into the repo ---

export type Finding = { line: number; kind: string; sample: string };

const PATTERNS: { kind: string; re: RegExp; replace: string }[] = [
  { kind: "nvidia key", re: /nvapi-[A-Za-z0-9_-]+/g, replace: "nvapi-[REDACTED]" },
  { kind: "bearer token", re: /Bearer\s+[A-Za-z0-9._~+/=-]+/g, replace: "Bearer [REDACTED]" },
  { kind: "account id", re: /for account\s+[^\s"';,]+/gi, replace: "for account [REDACTED]" },
  { kind: "local path", re: /\/Users\/[^\s"';,]+/g, replace: "[LOCAL PATH]" },
  { kind: "api key", re: /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/g, replace: "[REDACTED KEY]" },
];

// Scans every line for keys, tokens, account ids and local paths; returns the cleaned text and what was found.
export function redact(text: string): { text: string; findings: Finding[] } {
  const findings: Finding[] = [];
  const lines = text.split("\n").map((l, i) => {
    let out = l;
    for (const p of PATTERNS) {
      out = out.replace(p.re, (m) => {
        findings.push({ line: i + 1, kind: p.kind, sample: `${m.length} characters` }); // never echo the secret itself
        return p.replace;
      });
    }
    return out;
  });
  return { text: lines.join("\n"), findings };
}
