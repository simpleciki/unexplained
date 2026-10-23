// What every agent shares: the answering rules, and the context (people, jobs, vocab) built from data/.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Dataset } from "../engine/types.ts";
import type { Vocab } from "../engine/vocab.ts";

export const MODELS = { auto: "meterless/auto", deep: "meterless/deep" } as const;
export type ModelIds = { researcher: string; router: string; keeper: string; judge: string; skeptic: string; explainer: string };

// The rules every prompt states and the Skeptic checks.
export const RULES = [
  "A reason for a rejection or a change may only come from a record where someone gives that reason. Do not infer one.",
  'If the records do not say something, say "the records do not say". Never guess.',
  'Never conclude that a client rejected something because it was "too expensive" unless the client said so.',
  "The status columns of quotes and invoices are end-of-period state. Never use them to say what was true on an earlier date.",
  "Quote words exactly as written. Do not paraphrase inside a quote.",
  // Keep this text stable: it is part of every cache key. (A "first character must be {" rule was tried
  // on 2026-10-22 and reverted: it would have invalidated all 114 good cached replies. The strict reply
  // parser in src/llm/json.ts handles prose replies instead.)
].map((r, i) => `${i + 1}. ${r}`).join("\n");

export type Person = { id: string; name: string; role: string };
export type AgentContext = {
  vocab: Vocab;
  people: Person[];
  jobs: { id: string; client: string; title: string; trade: string }[];
  clients: { id: string; name: string }[];
};

// People are listed in data/README.md as "| p.xx.name | role | Name |" or inside the client table.
export function loadPeople(root: string): Person[] {
  const text = readFileSync(join(root, "data/README.md"), "utf8");
  const out = new Map<string, Person>();
  for (const line of text.split("\n")) {
    const staff = line.match(/^\|\s*(p\.[a-z]{2}\.[a-z_]+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/);
    if (staff) out.set(staff[1], { id: staff[1], role: staff[2], name: staff[3] });
    for (const m of line.matchAll(/(p\.[a-z]{2}\.[a-z_]+)\s+([A-Z][a-z]+ [A-Z][a-z]+)(?:\s*\(([^)]*)\))?/g)) {
      if (!out.has(m[1])) out.set(m[1], { id: m[1], name: m[2], role: m[3] ? `client reviewer (${m[3]})` : "client reviewer" });
    }
  }
  return [...out.values()];
}

export function agentContext(root: string, data: Dataset, vocab: Vocab): AgentContext {
  return {
    vocab,
    people: loadPeople(root),
    jobs: data.tables.workOrders.map((w) => ({ id: w.work_order_id, client: w.client_id, title: w.job_title, trade: w.trade })),
    clients: data.tables.clients.map((c) => ({ id: c.client_id, name: c.name })),
  };
}

export const vocabText = (v: Vocab) =>
  [
    `topics: ${[...v.topics].join(", ")}`,
    `facets: ${[...v.facets].join(", ")}`,
    `deciders (who may decide each topic): ${Object.entries(v.deciders).map(([t, ids]) => `${t} = ${ids.join(" ")}`).join("; ")}`,
  ].join("\n");

export const peopleText = (ps: Person[]) => ps.map((p) => `${p.id}: ${p.name}, ${p.role}`).join("\n");
