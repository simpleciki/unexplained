// Guard rails from the task card, checked on the source itself.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") && !p.includes(".test") ? [p] : [];
  });
}
const engineFiles = files(join(import.meta.dirname, "."));
// Code only: comments may name the rule they follow.
const code = (f: string) => readFileSync(f, "utf8").replace(/\/\/.*$/gm, "");

describe("engine source rules", () => {
  it("never opens eval/gold/ (engine, agents and pipeline)", () => {
    const answering = [...engineFiles, ...files(join(import.meta.dirname, "../agents")), ...files(join(import.meta.dirname, "../pipeline"))];
    for (const f of answering) expect(code(f), f).not.toMatch(/eval\/gold|gold_cards|gold_edges|gold_questions/);
  });
  it("never reads the end-of-window status column of quotes or invoices", () => {
    // Seat links have their own .status (ok | conflict); any other .status read would be a table column.
    for (const f of engineFiles) {
      const reads = [...code(f).matchAll(/(\w+)\.status\b|(?<!Link)\["status"\]/g)].filter((m) => m[1] !== "l" && m[1] !== "approval"); // "approval.status" is a facet name
      expect(reads.map((m) => m[0]), f).toEqual([]);
    }
  });

  // Fixes must be general: no question, card, work order, client or person from the dataset may appear
  // in engine code (comments included, so a special case cannot hide behind one).
  it("never names a question, card, job, client or person from the dataset", () => {
    const names =
      /\bq-(p\d|t\d+|ctrl)-|["'`]card\.[a-z0-9]|\b(WO|Q|INV)-(NL|OC|PW|RM)-\d|\bcl\.[a-z_]+|\bp\.[a-z]{2}\.[a-z_]+|North Loft|Oak Circle|Pike Water|Red Mill|Heron|Tallow Creek|Harbor & Wick|\b(Ria|Helen|Tomas|Otto|Yvette|Paul|Mira|Jonah|Delia|Cal|Nora|Wes)\b/;
    for (const f of engineFiles) expect(readFileSync(f, "utf8"), f).not.toMatch(names);
  });
});
