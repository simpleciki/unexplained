// One step to fix each fired warning (task 027), checked word for word on real documents with the gold cards as the
// ingested state (so every pattern that fires in the data is exercised; no network, no model). P2 needs the Judge
// step and never fires here, so it is checked on a constructed flag.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadDataset } from "../engine/data.ts";
import { extractableRecords } from "../pipeline/ingest.ts";
import { check, loadCtx } from "./api.ts";
import { clientSigner, fixSentences, openItemOnly } from "./fixes.ts";

const repo = join(import.meta.dirname, "../..");

function goldRoot() {
  const root = mkdtempSync(join(tmpdir(), "unexplained-fixes-"));
  cpSync(join(repo, "data"), join(root, "data"), { recursive: true });
  mkdirSync(join(root, "state"));
  const jsonl = (f: string) => readFileSync(join(repo, "eval/gold", f), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  writeFileSync(join(root, "state/cards.json"), JSON.stringify(jsonl("gold_cards.jsonl")));
  writeFileSync(join(root, "state/edges.json"), JSON.stringify(jsonl("gold_edges.jsonl")));
  const n = extractableRecords(loadDataset(root).records).length;
  writeFileSync(join(root, "state/ingest-report.json"), JSON.stringify({ records_total: n, records_done: n, records_rejected: [], records_prose_reply: [], records_failed_upstream: [], cards_gate_rejected: [], cards_dropped_by_skeptic: [] }));
  return root;
}
const ctx = loadCtx(goldRoot(), loadDataset(repo));
const fixOf = (doc: string, pattern: string) => {
  const w = check(ctx, doc)!.warnings.find((x) => x.pattern === pattern) as unknown as { fired: boolean; fix: string[] } | undefined;
  expect(w?.fired, `${pattern} fires on ${doc}`).toBe(true);
  return w!.fix;
};

describe("one step to fix, per pattern, on real documents", () => {
  it("P1 on Q-PW-05-v2: send the client the result of the open promise, or say in the cover note it is pending", () => {
    expect(fixOf("Q-PW-05-v2", "P1")).toEqual([
      "Before sending: send Otto Gell the result of “before we commit to replacing the leader we want to run a scope down it to the first cleanout. We'll check that first and tell you what we find” that Mira Kell promised on 30 Apr, or add one line to the cover note saying it is still pending and when it will be done.",
    ]);
  });

  it("P5 on Q-PW-05-v2: don't cut the price; ask the client which of the inferred causes it was", () => {
    expect(fixOf("Q-PW-05-v2", "P5")).toEqual([
      "Don't cut the price yet. Ask Otto Gell which it was: a version was voided and resent within 30 minutes, the cover note names a different quote id, the same quote was announced 3 times or a promised check or requested finding had no recorded result.",
    ]);
  });

  it("P3 on Q-NL-03-v2: close the open item, quoted from the version itself", () => {
    expect(fixOf("Q-NL-03-v2", "P3")).toEqual(["Don't send another version yet. Close the open item first: “Need to determine the cause before naming parts”."]);
  });

  it("P4 on Q-NL-04-v3 (the cap rule, Ciki's example sentence) and on Q-RM-01-v2 (the rule's own words)", () => {
    expect(fixOf("Q-NL-04-v3", "P4")).toEqual(["This quote is over $2,500: attach the one-line note Ria Moth asked for on 10 Mar before you submit."]);
    expect(fixOf("Q-RM-01-v2", "P4")).toEqual(["Follow the rule Yvette Sarn set on 9 Mar before you submit: “All Red Mill quotes go through the client portal. Do not email PDFs.”"]);
  });

  it("P6 on Q-NL-03-v1: the client's usual shape, and the price-list reminder", () => {
    expect(fixOf("Q-NL-03-v1", "P6")).toEqual([
      "Restructure to this client's usual shape: labor, material and freight lines, at least 4 of them, as in Q-NL-01-v1, Q-NL-01-v2, Q-NL-01-v3 and Q-NL-02-v1. Check unit prices against the company's standard price list.",
    ]);
  });

  it("P7 on INV-RM-02: written approval for the difference first (invoice $558 against the approved $264)", () => {
    expect(fixOf("INV-RM-02", "P7")).toEqual(["Get written approval from Yvette Sarn for the difference ($294) before invoicing."]);
  });

  it("P7 on INV-NL-04, no version approved before the invoice: written approval for the whole invoice total", () => {
    expect(fixOf("INV-NL-04", "P7")).toEqual(["No version was approved before this invoice. Get written approval from Ria Moth for $1,830 before invoicing."]);
  });

  it("P1 on Q-PW-02-v2, a request the client made: answer it (not the promise sentence)", () => {
    expect(fixOf("Q-PW-02-v2", "P1")).toEqual(["Before sending: answer what Otto Gell asked for on 6 Apr (“Snake it. I will wait on a later note for the cause.”), or say in the cover note when the answer will come."]);
  });

  it("P3 on Q-PW-02-v2: the open item is cut before the line's quantity x price; the finding keeps its quote", () => {
    expect(fixOf("Q-PW-02-v2", "P3")).toEqual(["Don't send another version yet. Close the open item first: “Need to determine the cause of the odor”."]);
    const w = check(ctx, "Q-PW-02-v2")!.warnings.find((x) => x.pattern === "P3") as unknown as { finding: string[] };
    expect(w.finding.join(" ")).toContain("“Need to determine the cause of the odor, 2 x 86”");
    expect(openItemOnly("Need to determine the cause of the refill hiss")).toBe("Need to determine the cause of the refill hiss");
  });

  it("no fix line when the flag lacks a detail the fix needs: a P1 promise or P7 with no single signer, P5 with no inferred causes", () => {
    const promise = { pattern: "P1", details: { open_items: [{ card: "c1", kind: "contractor_promise", quote: "We'll check it.", decided_at: "2026-04-30T10:20:00-05:00" }] }, evidence: [{ id: "c1", kind: "card" as const, decided_by: "p.hw.mira_kell", source: null }] };
    const base = { nameOf: (x: string) => x, docKind: "quote" as const };
    expect(fixSentences(promise, { ...base, clientPerson: null })).toEqual([]);
    expect(fixSentences({ pattern: "P5", details: { rejections: [{ card: "c1", reason_stated: false }], candidate_causes: [] }, evidence: promise.evidence }, base)).toEqual([]);
    // P7 with no approved version and no single signer for the client: no fix line (the warning still shows).
    expect(fixSentences({ pattern: "P7", details: { approved_version: null, mismatches: ["no approved version as of the invoice date"] }, evidence: [] }, { ...base, docKind: "invoice", clientPerson: null, invoiceTotal: 1830 })).toEqual([]);
  });

  it("P2 (only after the Judge step fired it): a change note with the total change and lines added and removed", () => {
    const input = { pattern: "P2", details: { from: "Q-NL-04-v1", to: "Q-NL-04-v2", total_delta: 400, changes: [{ change: "added" }, { change: "changed" }, { change: "removed" }] }, evidence: [] };
    expect(fixSentences(input, { nameOf: (x) => x, docKind: "quote" })).toEqual(["Add a change note: what changed since Q-NL-04-v1 and why (+$400, 1 line added, 1 removed)."]);
  });

  it("reads the client's signer from the client table", () => {
    const readme = readFileSync(join(repo, "data/README.md"), "utf8");
    expect(["cl.pike_water", "cl.oak_circle", "cl.red_mill", "cl.north_loft", "cl.nope"].map((c) => clientSigner(readme, c))).toEqual(["p.pw.otto_gell", "p.oc.helen_bray", "p.rm.yvette_sarn", "p.nl.ria_moth", null]);
  });
});
