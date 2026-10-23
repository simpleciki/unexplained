// The Researcher's worked examples must be invented: extraction is scored on data/records/, so a prompt
// that shares wording with a record would leak the answer.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseJsonl } from "../engine/data.ts";
import type { SourceRecord } from "../engine/types.ts";
import { SYSTEM } from "./researcher.ts";
import { RULES } from "./shared.ts";

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9$ ]/g, " ").split(/\s+/).filter(Boolean);

describe("Researcher prompt", () => {
  it("shares no four-word run with any record", () => {
    const records = parseJsonl<SourceRecord>(readFileSync(join(import.meta.dirname, "../../data/records/records.jsonl"), "utf8"));
    const texts = records.map((r) => ` ${words(r.text).join(" ")} `);
    const w = words(SYSTEM.replace(RULES, ""));
    const shared: string[] = [];
    for (let i = 0; i + 4 <= w.length; i++) {
      const run = ` ${w.slice(i, i + 4).join(" ")} `;
      if (texts.some((t) => t.includes(run))) shared.push(run.trim());
    }
    expect(shared).toEqual([]);
  });

  it("states the card granularity and the four modes", () => {
    expect(SYSTEM.startsWith("You extract")).toBe(true); // the cache probe and fakes key on this
    expect(SYSTEM).toMatch(/one decision, reason, proposal or report/);
    for (const m of ["decides:", "gives_reason:", "proposes:", "mentions:"]) expect(SYSTEM).toContain(`- ${m}`);
  });
});
