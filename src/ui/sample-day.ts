// `npm run demo:sample-day`: Today's outbox (seed 20261027) with every confirmation a person can make in the
// page, replayed through the same judgment path the page uses, on a throwaway copy of review/judgments.jsonl in a
// temp directory. Never the real review/ file and never .demo/. No model calls.
// What it confirms: one-click "Looks fine" on a record the model read as empty or routed to a person, and
// "Checked against this client's history — OK to send" on a first quote. What it leaves: open questions (they
// need a person's answer) and rec-0007, whose text is a real finding, not an empty record.
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Dataset } from "../engine/types.ts";
import { check, loadCtx, postJudgment, sampleIds, summary } from "./api.ts";
import type { Ctx } from "./api.ts";

export const NOT_CONFIRMED: Record<string, string> = {
  "rec-0007": "a real finding (\"Studio riser does need an isolated ground. About two hours of labor\"), not an empty record",
};
// The same reason text the page sends (src/ui/index.html).
export const QUICK_REASON = "Quick check from the outbox: read the record, nothing to keep.";
export const REVIEWER = "sample-day script";
const firstQuoteReason = (n: number) => (n ? `Checked against what this client told us before (${n} item${n === 1 ? "" : "s"}).` : "No earlier word from this client on file; checked the quote by hand.");

type DocState = { id: string; state: "warnings" | "not_cleared" | "clear"; left: number; text: string };
export type SampleDayResult = {
  ids: string[];
  before: DocState[];
  after: DocState[];
  // Per document, in outbox order: the clicks a person makes (1 to open it, 1 per confirmation) and what is left.
  steps: { id: string; clicks: number; confirmed: string[]; left_open: { item: string; why: string }[] }[];
  totals: { before: Record<string, number>; after: Record<string, number> };
  judgments_written: number;
};

// A temp root: data/, state/ and snapshot/ linked read-only to the real ones, review/ a copy.
export function tempRoot(root: string): string {
  const dir = mkdtempSync(join(tmpdir(), "unexplained-sample-day-"));
  for (const d of ["data", "state", "snapshot"]) if (existsSync(join(root, d))) symlinkSync(join(root, d), join(dir, d), "dir");
  mkdirSync(join(dir, "review"));
  if (existsSync(join(root, "review/judgments.jsonl"))) cpSync(join(root, "review/judgments.jsonl"), join(dir, "review/judgments.jsonl"));
  return dir;
}

const stateOf = (ctx: Ctx, id: string): DocState => {
  const c = check(ctx, id)!;
  return { id, state: c.verdict.state, left: c.to_confirm.length, text: c.verdict.text };
};
const count = (xs: DocState[]) => ({ warnings: xs.filter((x) => x.state === "warnings").length, not_cleared: xs.filter((x) => x.state === "not_cleared").length, clear: xs.filter((x) => x.state === "clear").length });

export function runSampleDay(root: string, data: Dataset): SampleDayResult {
  const dir = tempRoot(root);
  try {
    let ctx = loadCtx(dir, data);
    const ids = sampleIds(ctx);
    const before = ids.map((id) => stateOf(ctx, id));
    const steps: SampleDayResult["steps"] = [];
    let written = 0;
    for (const id of ids) {
      let clicks = 1; // open the document
      const confirmed: string[] = [];
      const skipped = new Set<string>();
      // Confirm one item at a time and re-check, as the page does after each click.
      for (;;) {
        const c = check(ctx, id)!;
        const tag = (x: (typeof c.to_confirm)[number]) => `${x.kind}:${"record_id" in x && x.record_id ? x.record_id : id}`;
        const item = c.to_confirm.find((x) => !skipped.has(tag(x)));
        if (!item) break;
        const key = "record_id" in item && item.record_id ? item.record_id : item.kind;
        if (item.kind === "open_question" || NOT_CONFIRMED[key]) { skipped.add(tag(item)); continue; }
        const body = item.kind === "first_quote"
          ? { doc_id: id, verdict: "document_ok", reason: firstQuoteReason(c.client_memory.items.length), reviewer: REVIEWER, memory_items: c.client_memory.items.length }
          : { record_id: key, verdict: "no_decision", cards: [], reason: QUICK_REASON, reviewer: REVIEWER };
        const r = postJudgment(ctx, body);
        if (r.status !== 201) throw new Error(`${id}: ${key} was not accepted: ${r.errors.join("; ")}`);
        written++;
        clicks++;
        confirmed.push(key);
        ctx = loadCtx(dir, data); // the page reloads the context after every judgment
      }
      const left = check(ctx, id)!.to_confirm.map((x) => {
        const k = "record_id" in x && x.record_id ? x.record_id : x.kind;
        return { item: k, why: NOT_CONFIRMED[k] ?? (x.kind === "open_question" ? `open question: needs a person's answer (${x.why.replace(/^Open question \([^)]*\): /, "")})` : x.why) };
      });
      steps.push({ id, clicks, confirmed, left_open: left });
    }
    const after = ids.map((id) => stateOf(ctx, id));
    // The page's own totals for the view, so the printout and the header agree.
    const s = summary(ctx, "sample");
    const totals = { before: count(before), after: { warnings: s.by_state.warnings.n, not_cleared: s.by_state.not_cleared.n, clear: s.by_state.clear.n, items_left: s.to_confirm.items } };
    return { ids, before, after, steps, totals, judgments_written: written };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
