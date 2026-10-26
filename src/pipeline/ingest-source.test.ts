// A fresh clone has no state/: the check page and value:metrics read the committed snapshot, say so, never write
// into it, and value:metrics gives exactly the committed numbers (only the time and commit fields differ).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadDataset } from "../engine/data.ts";
import { loadCtx, summary } from "../ui/api.ts";
import { ingestSource, SNAPSHOT } from "./ingest-source.ts";

const repo = join(import.meta.dirname, "../..");
const hashes = (dir: string) => Object.fromEntries(readdirSync(dir).map((f) => [f, createHash("sha256").update(readFileSync(join(dir, f))).digest("hex")]));

function cloneLike() {
  const root = mkdtempSync(join(tmpdir(), "unexplained-clone-"));
  for (const d of ["data", "eval", SNAPSHOT]) cpSync(join(repo, d), join(root, d), { recursive: true });
  mkdirSync(join(root, "review"));
  cpSync(join(repo, "review/judgments.jsonl"), join(root, "review/judgments.jsonl"));
  return root;
}

describe("ingest source", () => {
  it("uses state/ when there is a local ingest, else the snapshot, else fails loudly", () => {
    expect(ingestSource(repo).kind).toBe(existsState() ? "state" : "snapshot");
    const root = cloneLike();
    expect(ingestSource(root)).toMatchObject({ kind: "snapshot", line: `reading cards from ${SNAPSHOT} (no local ingest found)` });
    expect(() => ingestSource(mkdtempSync(join(tmpdir(), "unexplained-empty-")))).toThrow(/no ingested cards/);
  });

  it("opens the check page's data from the snapshot: 58 documents, the ledger complete", () => {
    const root = cloneLike();
    const ctx = loadCtx(root, loadDataset(root));
    const s = summary(ctx, "all");
    expect(s.documents).toBe(58);
    expect(ctx.view.ledger.complete).toBe(true);
  });

  it("reproduces the committed value metrics from the snapshot and leaves the snapshot unchanged", () => {
    const root = cloneLike();
    const before = hashes(join(root, SNAPSHOT));
    const out = join(root, "vm.json");
    const stdout = execFileSync(process.execPath, ["--import", "tsx", join(repo, "scripts/value-metrics.ts"), "--root", root, "--out", out], { cwd: repo, encoding: "utf8" });
    expect(stdout.split("\n")[0]).toBe(`reading cards from ${SNAPSHOT} (no local ingest found)`);
    const skip = new Set(["computed_at", "code_commit", "working_tree_uncommitted"]);
    const strip = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([k]) => !skip.has(k)));
    const committed = JSON.parse(readFileSync(join(repo, "eval/results/value-metrics.json"), "utf8"));
    expect(strip(JSON.parse(readFileSync(out, "utf8")))).toEqual(strip(committed));
    expect(hashes(join(root, SNAPSHOT))).toEqual(before);
  }, 60_000);
});

function existsState() {
  try {
    readFileSync(join(repo, "state/cards.json"));
    return true;
  } catch {
    return false;
  }
}
