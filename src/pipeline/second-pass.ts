// Extraction run 3 (docs/extraction-run-3.md): a second, targeted read of the records that produced no card in a
// first-pass ingest. Only those records are read, with their own prompt; first-pass cards are kept as they are; new
// cards go through the same gate and Skeptic step as first-pass cards. The merged result goes to its own folder
// (never state/ or snapshot/). Keeper is not run: first-pass relations are copied, new cards have none.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkCards } from "../agents/skeptic.ts";
import { parseCards, toCard } from "../agents/researcher.ts";
import { agentContext, peopleText, RULES, vocabText } from "../agents/shared.ts";
import type { AgentContext } from "../agents/shared.ts";
import { buildEngine, saveState } from "../engine/engine.ts";
import type { Dataset, DecisionCard, RelationEdge, SourceRecord } from "../engine/types.ts";
import { verifyCards } from "../engine/verify.ts";
import { loadVocab } from "../engine/vocab.ts";
import { AllRoutesDead, BudgetExhausted } from "../llm/client.ts";
import type { ModelClient } from "../llm/client.ts";
import { redactAccount } from "../llm/http.ts";
import { isProseError } from "../llm/json.ts";
import { ProviderError } from "../llm/provider.ts";
import { extractableRecords, sampleOutDir, type IngestReport } from "./ingest.ts";
import type { Runtime } from "./runtime.ts";

// Its own cache folder (git-ignored by cache-*/) and key namespace: no reply from another run can match.
export const SECOND_PASS = "second-pass";
export const SECOND_PASS_CACHE = "cache-second-pass";

// Written before the run (docs/extraction-run-3.md): re-read the record and list every promise, price, date,
// approval, rejection, client rule and open item it contains, each with the exact words, or say there is none.
// Same card format and modes as the first pass.
export const SECOND_PASS_SYSTEM = `You re-read one record of a repair contractor's job file. An earlier read found nothing in it; read it
again, slowly, sentence by sentence. List every promise, price, date, approval, rejection, client rule and open item the
record contains, each as one card whose quote is the exact words of the record that state it. If the record really
contains none of these, say so with {"cards":[]}.
What to look for:
- a promise or plan about the future (we will, I'll, once ... we'll, next week): mode proposes;
- a price, rate, hours or amount that someone agrees, offers or states: the card for the decision or proposal it is part of;
- a date or deadline that something must happen by or starts from: keep the date words inside the quote;
- an approval or a rejection by a client reviewer, also when someone else reports it: mode decides, decided_by = the client;
- a client rule (always, never, do not, only, anything over): mode decides;
- an open item: something asked, promised or left to check that has no result yet: mode proposes, or mentions when the
  writer only refers to it;
- a reason why something was rejected, changed or is needed: mode gives_reason.
A contractor's quote is only a proposal; only a client reviewer can decide. Do not invent words that are not in the
record. Do not split one decision into several cards, and do not merge two different decisions into one card.
Modes: decides, gives_reason, proposes, mentions (as defined by the rules below).
Rules:
${RULES}
Return JSON only: {"cards":[{"mode":"decides|mentions|gives_reason|proposes","topic":"...","facets":["..."],"scope":"job:<id>|client:<id>|global",
"decided_at":"the time phrase as written in the text, or record_time","effective":"the start phrase as written, or record_time",
"decided_by":"person id","quote":"exact words copied from the record"}]}`;

export function secondPassPrompt(rec: SourceRecord, ctx: AgentContext, hint?: string): string {
  const job = ctx.jobs.find((j) => j.id === rec.thread_id);
  return [
    `Record ${rec.record_id} (${rec.source_type}), written ${rec.source_recorded_at} by ${rec.author}.`,
    job ? `Job ${job.id} "${job.title}" for client ${job.client}. Allowed scopes: job:${job.id}, client:${job.client}, global.` : "Allowed scopes: global.",
    `Text:\n"""${rec.text}"""`,
    `Vocabulary:\n${vocabText(ctx.vocab)}`,
    `People:\n${peopleText(ctx.people)}`,
    hint ? `A checker rejected earlier cards from this record: ${hint}. Read it again, more carefully.` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

type FirstReport = Pick<IngestReport, "records_failed_upstream" | "records_prose_reply" | "records_rejected" | "cards_gate_rejected" | "cards_dropped_by_skeptic" | "records_done">;
export type NoCardRecord = { record_id: string; reason: string };

// The extractable records that ended the first pass with no card, whatever the reason, in id order.
export function noCardRecords(records: SourceRecord[], firstCards: DecisionCard[], first: FirstReport): NoCardRecord[] {
  const withCards = new Set(firstCards.map((c) => c.record_id));
  const all = extractableRecords(records);
  const reached = first.records_done + first.records_failed_upstream.length;
  const recOf = (cardId: string) => cardId.match(/^m\.(rec-\d+)\./)?.[1];
  return all
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => !withCards.has(r.record_id))
    .map(({ r, i }) => {
      const id = r.record_id;
      const reason = first.records_failed_upstream.some((f) => f.record_id === id)
        ? "failed upstream"
        : first.records_prose_reply.includes(id)
          ? "answered in prose"
          : first.records_rejected.some((x) => x.record_id === id)
            ? "no valid reply"
            : first.cards_dropped_by_skeptic.some((c) => recOf(c.card_id) === id)
              ? "cards dropped by the checker"
              : first.cards_gate_rejected.some((c) => recOf(c.card_id) === id)
                ? "cards rejected by the quote gate"
                : i >= reached
                  ? "not reached"
                  : "read as empty";
      return { record_id: id, reason };
    });
}

// Second-pass card ids: m.<record>.s<round>.<n>, so they never collide with first-pass ids and the ledger still
// finds their record.
const secondId = (c: DecisionCard, rec: string, round: number, n: number): DecisionCard => ({ ...c, card_id: `m.${rec}.s${round}.${n}` });

export type SecondPassReport = IngestReport & {
  second_pass: {
    of: string;
    records_read: number;
    reasons: Record<string, number>;
    cards_proposed: number;
    cards_gate_rejected: number;
    cards_dropped_by_skeptic: number;
    cards_kept: number;
    records_with_new_cards: string[];
    records_prose_reply: string[];
    records_rejected: { record_id: string; why: string }[];
    records_failed_upstream: { record_id: string; error: string }[];
  };
};

export async function runSecondPass(root: string, rt: Runtime, data: Dataset, firstDir: string, out: string): Promise<SecondPassReport> {
  const outDir = sampleOutDir(root, out);
  const vocab = loadVocab(root);
  const ctx = agentContext(root, data, vocab);
  const read = (f: string) => JSON.parse(readFileSync(join(firstDir, f), "utf8"));
  const firstCards = read("cards.json") as DecisionCard[];
  const firstEdges = (existsSync(join(firstDir, "edges.json")) ? read("edges.json") : []) as RelationEdge[];
  const first = read("ingest-report.json") as IngestReport;
  const targets = noCardRecords(data.records, firstCards, first);
  const byId = new Map(data.records.map((r) => [r.record_id, r]));
  const sp: SecondPassReport["second_pass"] = {
    of: firstDir, records_read: 0, reasons: {}, cards_proposed: 0, cards_gate_rejected: 0, cards_dropped_by_skeptic: 0, cards_kept: 0,
    records_with_new_cards: [], records_prose_reply: [], records_rejected: [], records_failed_upstream: [],
  };
  for (const t of targets) sp.reasons[t.reason] = (sp.reasons[t.reason] ?? 0) + 1;
  const gate = (cards: DecisionCard[]) => {
    const checked = verifyCards(cards, data.records, vocab);
    sp.cards_gate_rejected += checked.filter((c) => c.result !== "PASS").length;
    return checked.filter((c) => c.result === "PASS").map(({ result: _r, reason: _x, ...c }) => c as DecisionCard);
  };
  const extract2 = async (client: ModelClient, rec: SourceRecord, round: number, hint?: string) => {
    const r = await client.json({ stage: "ingest", agent: "Researcher.second", model: rt.models.researcher, system: SECOND_PASS_SYSTEM, user: secondPassPrompt(rec, ctx, hint) }, parseCards, 2);
    if (!r.value) return { cards: [] as DecisionCard[], rejected: true, error: r.error };
    return { cards: r.value.map((c, i) => secondId(toCard(c, rec, i, round), rec.record_id, round, i)), rejected: false as const };
  };

  const kept: DecisionCard[] = [];
  let stopped: string | undefined;
  for (const t of targets) {
    const rec = byId.get(t.record_id)!;
    try {
      sp.records_read++;
      const firstRead = await extract2(rt.client, rec, 0);
      if (firstRead.rejected) {
        if (isProseError(firstRead.error)) sp.records_prose_reply.push(rec.record_id);
        sp.records_rejected.push({ record_id: rec.record_id, why: firstRead.error ?? "no valid reply" });
        continue;
      }
      sp.cards_proposed += firstRead.cards.length;
      let cards = gate(firstRead.cards);
      // The same Skeptic step as the first pass (runIngest): at most two re-reads; what is still unsupported is dropped.
      for (let round = 1; cards.length && round <= 3; round++) {
        const verdicts = await checkCards(rt.client, rt.models.skeptic, rec, cards);
        if (!verdicts) break;
        const bad = cards.filter((c) => verdicts.find((v) => v.id === c.card_id)?.supported === false);
        if (!bad.length) break;
        if (round === 3) {
          sp.cards_dropped_by_skeptic += bad.length;
          cards = cards.filter((c) => !bad.includes(c));
          break;
        }
        const hint = bad.map((c) => `"${c.quote}" (${verdicts.find((v) => v.id === c.card_id)?.why})`).join("; ");
        const again = await extract2(rt.client, rec, round, hint);
        if (!again.rejected) {
          sp.cards_proposed += again.cards.length;
          cards = gate(again.cards);
        } else if (isProseError(again.error) && !sp.records_prose_reply.includes(rec.record_id)) sp.records_prose_reply.push(rec.record_id);
      }
      kept.push(...cards);
      if (cards.length) sp.records_with_new_cards.push(rec.record_id);
    } catch (e) {
      if (e instanceof BudgetExhausted) { stopped = e.message; break; }
      if (!(e instanceof AllRoutesDead || e instanceof ProviderError)) throw e; // e.g. response_format rejected: stop
      sp.records_failed_upstream.push({ record_id: rec.record_id, error: redactAccount(e.message).slice(0, 300) });
    }
  }
  sp.cards_kept = kept.length;

  // Merged: the first-pass cards unchanged, then the kept second-pass cards. The report starts from the first pass's,
  // with records that now have a card taken off its prose / failed / rejected lists.
  const merged = [...firstCards, ...kept];
  const now = new Set(sp.records_with_new_cards);
  const report: SecondPassReport = {
    ...first,
    records_prose_reply: first.records_prose_reply.filter((id) => !now.has(id)),
    records_failed_upstream: first.records_failed_upstream.filter((f) => !now.has(f.record_id)),
    records_rejected: first.records_rejected.filter((x) => !now.has(x.record_id)),
    cards: merged.length,
    // complete: this run (the second pass) finished with no record failed upstream and no budget stop.
    complete: !stopped && !sp.records_failed_upstream.length,
    ...(stopped ? { stopped_reason: `second pass stopped: ${stopped}` } : {}),
    second_pass: sp,
  };
  report.records_failed_upstream_count = report.records_failed_upstream.length;
  delete report.ledger;
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "cards.json"), JSON.stringify(merged, null, 2) + "\n");
  writeFileSync(join(outDir, "edges.json"), JSON.stringify(firstEdges, null, 2) + "\n");
  writeFileSync(join(outDir, "ingest-report.json"), JSON.stringify(report, null, 2) + "\n");
  saveState(buildEngine(root, merged, firstEdges, undefined, data), root, outDir);
  return report;
}
