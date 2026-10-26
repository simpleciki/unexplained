// The sample day is pinned: Today's outbox with every confirmation a person can make in the page gives 3 to fix,
// 6 ready and 1 left (rec-0007 and two open questions), and the real review/judgments.jsonl is not touched.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadData } from "../adapters/zetaris.ts";
import { runSampleDay } from "./sample-day.ts";

const repo = join(import.meta.dirname, "../..");
const sha = (f: string) => (existsSync(f) ? createHash("sha256").update(readFileSync(f)).digest("hex") : null);

describe("demo:sample-day", () => {
  it("confirms what a person can and pins the result, on a temp copy only", async () => {
    const real = join(repo, "review/judgments.jsonl");
    const demo = join(repo, ".demo/review/judgments.jsonl");
    const [realBefore, demoBefore] = [sha(real), sha(demo)];
    const r = runSampleDay(repo, await loadData(repo, "files"));
    expect(r.totals.before).toEqual({ warnings: 3, not_cleared: 7, clear: 0 });
    expect(r.totals.after).toEqual({ warnings: 3, not_cleared: 1, clear: 6, items_left: 3 });
    expect(Object.fromEntries(r.after.map((x) => [x.id, x.state]))).toEqual({
      "Q-NL-04-v3": "warnings", "Q-PW-05-v2": "warnings", "Q-NL-03-v1": "warnings",
      "Q-OC-02-v1": "clear", "Q-RM-02-v1": "clear", "Q-PW-04-v1": "clear", "Q-NL-02-v1": "clear", "INV-PW-01": "clear", "Q-PW-01-v1": "clear",
      "Q-NL-01-v2": "not_cleared",
    });
    expect(r.steps.find((s) => s.id === "Q-NL-01-v2")!.left_open.map((x) => x.item)).toEqual(["rec-0007", "rec-0006", "rec-0284"]);
    expect(r.after.find((x) => x.id === "Q-OC-02-v1")!.text).toMatch(/by hand \(no earlier word from this client on file\)/);
    expect(r.judgments_written).toBe(8);
    expect([sha(real), sha(demo)]).toEqual([realBefore, demoBefore]);
  }, 60_000);
});
