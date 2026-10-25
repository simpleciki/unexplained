// npm run value:metrics
// The three value metrics pre-registered in docs/value-metrics.md (commit 36483de), computed with no model
// calls: the check page's own verdict (src/ui/api.ts check()) on every quote version and invoice, built from
// data/, the ingested cards in state/ and the real review/judgments.jsonl. Never .demo/. Writes
// eval/results/value-metrics.json and prints the three outputs.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadData } from "../src/adapters/zetaris.ts";
import { check, designedLists, loadCtx, meta } from "../src/ui/api.ts";
import { SAMPLE_SEED, sampleDay } from "../src/ui/sample.ts";
import { ms } from "../src/engine/docs.ts";
import { classify, designedInvoice, designedQuote, median, OUTCOMES, recordsToRead, tally } from "../src/eval/value-metrics.ts";
import type { Designed, DocResult } from "../src/eval/value-metrics.ts";

const root = join(import.meta.dirname, "..");
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" } }).trim();
const localNow = () => {
  const d = new Date();
  const off = -d.getTimezoneOffset();
  const sign = off < 0 ? "-" : "+";
  const hh = String(Math.floor(Math.abs(off) / 60)).padStart(2, "0");
  const mm = String(Math.abs(off) % 60).padStart(2, "0");
  return new Date(d.getTime() + off * 60_000).toISOString().slice(0, 19) + `${sign}${hh}:${mm}`;
};

const data = await loadData(root, "files");
const ctx = loadCtx(root, data);
const t = data.tables;
const judgmentLines = readFileSync(join(root, "review/judgments.jsonl"), "utf8").split("\n").filter((l) => l.trim()).length;
const names = new Map(meta(ctx).people.map((p) => [p.id, p.name]));
const nameOf = (id: string) => names.get(id) ?? id;
const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ---- 1. Documents and money -------------------------------------------------------------------------
const noteKind = (n: string) =>
  n.startsWith("No messages") ? "no records before it" : / not judged yet/.test(n) ? "unjudged records" : / read as empty/.test(n) ? "empty reads not spot-checked" : n.startsWith("Open question") ? "open question" : n.startsWith("P2 ") ? "P2 needs Judge" : "other";
const quoteStatus = new Map(t.quotes.map((q) => [q.quote_id, q.status]));
const designed: { id: string; kind: "quote" | "invoice"; job: string; d: Designed }[] = [
  ...t.quotes.map((q) => ({ id: q.quote_id, kind: "quote" as const, job: q.work_order_id, d: designedQuote(q) })),
  ...t.invoices.map((i) => ({ id: i.invoice_id, kind: "invoice" as const, job: i.work_order_id, d: designedInvoice(i, quoteStatus) })),
];
// A "submitted, never approved" version is either superseded by a later version of its job or the job's last
// version still waiting at the end of the window; both count as problem documents by the definition.
const lastVersion = new Map<string, number>();
for (const q of t.quotes) lastVersion.set(q.work_order_id, Math.max(lastVersion.get(q.work_order_id) ?? 0, Number(q.version)));

const docs = designed.map((x) => {
  const c = check(ctx, x.id)!;
  const fired = c.warnings.filter((w) => w.fired);
  const p2Open = c.warnings.some((w) => w.pattern === "P2" && w.open);
  const q = x.kind === "quote" ? t.quotes.find((r) => r.quote_id === x.id)! : null;
  return {
    id: x.id,
    kind: x.kind,
    job: x.job,
    client: c.doc.client,
    at: c.doc.at,
    total: c.doc.total,
    designed: x.d.outcome,
    designed_why: x.d.why,
    still_waiting_at_end: q?.status === "submitted" ? Number(q.version) === lastVersion.get(q.work_order_id) : undefined,
    state: c.verdict.state,
    outcome: classify(x.d.outcome, c.verdict.state),
    fired: fired.map((w) => w.pattern),
    p2_open: p2Open,
    // Not cleared only because P2 needs the Judge step: every note on the verdict is the P2 note.
    p2_only_blocker: c.verdict.state === "not_cleared" && c.verdict.notes.length > 0 && c.verdict.notes.every((n) => n.startsWith("P2 ")),
    notes: c.verdict.notes,
    // Why a verdict is not clear, by the kind of note the page gives (one document can have several).
    not_cleared_reasons: c.verdict.state === "not_cleared" ? [...new Set(c.verdict.notes.map(noteKind))] : [],
    records: c.records,
    check: c,
  };
});
const t1 = tally(docs.map((d): DocResult => ({ id: d.id, outcome: d.outcome, designed: d.designed, total: d.total })));
const p2 = {
  documents_with_p2_open: docs.filter((d) => d.p2_open).map((d) => d.id),
  not_cleared_only_because_of_p2: docs.filter((d) => d.p2_only_blocker).map((d) => d.id),
  p2_open_by_outcome: Object.fromEntries(OUTCOMES.map((o) => [o, docs.filter((d) => d.p2_open && d.outcome === o).length])),
};

// ---- 2. How much a person has to read ---------------------------------------------------------------
const caught = docs.filter((d) => d.outcome === "caught");
const reading = caught.map((d) => {
  const at = d.kind === "invoice" ? t.invoices.find((i) => i.invoice_id === d.id)!.issued_at : ctx.engine.docs.versions.find((v) => v.quote_id === d.id)!.record.source_recorded_at;
  const asOf = ms(at) - 1;
  const read = recordsToRead(data.records, t.workOrders, d.job, asOf);
  const cited = new Set<string>();
  let citedWithoutSource = 0;
  for (const w of d.check.warnings.filter((x) => x.fired)) {
    for (const e of w.evidence) {
      if (e.source) cited.add(e.source.record_id);
      else citedWithoutSource++;
    }
  }
  return { id: d.id, job: d.job, fired: d.fired, to_read_client_and_job: read.client_and_job, to_read_job_only: read.job_only, cited: cited.size, cited_records: [...cited].sort(), cited_without_source: citedWithoutSource };
});
const nums = (k: "to_read_client_and_job" | "to_read_job_only" | "cited") => reading.map((r) => r[k]);
const stat = (xs: number[]) => ({ median: median(xs), min: xs.length ? Math.min(...xs) : null, max: xs.length ? Math.max(...xs) : null, sum: xs.reduce((a, b) => a + b, 0) });
const s2 = { to_read_client_and_job: stat(nums("to_read_client_and_job")), to_read_job_only: stat(nums("to_read_job_only")), cited: stat(nums("cited")) };
const ratioOfMedians = s2.cited.median ? Math.round((s2.to_read_client_and_job.median! / s2.cited.median) * 10) / 10 : null;
const perDocRatios = reading.filter((r) => r.cited).map((r) => r.to_read_client_and_job / r.cited);
const medianPerDocRatio = perDocRatios.length ? Math.round(median(perDocRatios)! * 10) / 10 : null;

// ---- 3. WO-PW-05 told forward -----------------------------------------------------------------------
const hero = JSON.parse(readFileSync(join(root, "eval/demo/hero_case.json"), "utf8"));
const recById = new Map(data.records.map((r) => [r.record_id, r]));
const heroVersions = t.quotes.filter((q) => q.work_order_id === "WO-PW-05").sort((a, b) => Number(a.version) - Number(b.version));
const forward = heroVersions.map((q, i) => {
  const d = docs.find((x) => x.id === q.quote_id)!;
  const c = d.check;
  const rejection = recById.get(hero[`d${i + 1}`]?.sources?.[0]);
  const warnings = c.warnings.filter((w) => w.fired).map((w) => {
    const ev = w.evidence as { kind: string; decided_by?: string; source: { record_id: string; author: string; type: string } | null }[];
    // Who to ask: the people the cited evidence names as deciding (card decided_by), else the cited records'
    // authors. Derived here from what the page cites; the page itself has no "next step" field.
    const deciders = [...new Set(ev.filter((e) => e.kind === "card" && e.decided_by).map((e) => nameOf(e.decided_by!)))];
    return {
      pattern: w.pattern,
      title: w.title,
      finding: (w as { finding?: string[] }).finding ?? [],
      cited_records: [...new Set(ev.map((e) => e.source?.record_id).filter(Boolean))],
      who_to_ask_derived: deciders,
    };
  });
  return {
    quote: q.quote_id,
    submitted_at: c.doc.at,
    total: c.doc.total,
    state: c.verdict.state,
    verdict: c.verdict.text,
    notes: c.verdict.notes,
    warnings,
    open: c.warnings.filter((w) => w.open).map((w) => `${w.pattern}: ${w.status}`),
    what_happened: rejection ? { record: rejection.record_id, at: rejection.source_recorded_at.slice(0, 16).replace("T", " "), by: nameOf(rejection.author), text: rejection.text, reason_given: hero.reasons_written?.value === 0 ? false : null } : null,
  };
});

// ---- 4. What a person has to confirm (amendment 1) ---------------------------------------------------
const items4 = docs.map((d) => ({ id: d.id, designed: d.designed, state: d.state, items: d.check.to_confirm.length, kinds: d.check.to_confirm.map((x) => x.kind), p2_open: d.check.judge_open.includes("P2") }));
const nc = items4.filter((d) => d.state === "not_cleared");
const kindCounts = (ds: typeof items4) => ds.flatMap((d) => d.kinds).reduce<Record<string, number>>((a, k) => ({ ...a, [k]: (a[k] ?? 0) + 1 }), {});
const dist = (ds: typeof items4) => {
  const n = ds.map((d) => d.items);
  return { documents: ds.length, items: n.reduce((a, b) => a + b, 0), median: median(n), min: n.length ? Math.min(...n) : null, max: n.length ? Math.max(...n) : null, need_1: n.filter((x) => x === 1).length, need_2: n.filter((x) => x === 2).length, need_3: n.filter((x) => x === 3).length, need_more: n.filter((x) => x > 3).length, need_0: n.filter((x) => x === 0).length, by_kind: kindCounts(ds) };
};
const s4 = {
  total_items_all_documents: items4.reduce((a, d) => a + d.items, 0),
  total_items_designed_clean: items4.filter((d) => d.designed === "clean").reduce((a, d) => a + d.items, 0),
  not_cleared: dist(nc),
  not_cleared_by_designed: { problem: dist(nc.filter((d) => d.designed === "problem")), clean: dist(nc.filter((d) => d.designed === "clean")) },
  warnings_need_a_fix: { documents: items4.filter((d) => d.state === "warnings").length, ids: items4.filter((d) => d.state === "warnings").map((d) => d.id) },
  p2_needs_judge_not_a_persons_item: { not_cleared_documents_with_p2_open: nc.filter((d) => d.p2_open).map((d) => d.id) },
  per_document: items4.filter((d) => d.state === "not_cleared"),
  clicks_note: "Clicks in the interface are measured separately in the demo and reported as observed, not part of this count.",
};
const { problem: problemIds, clean: cleanIds } = designedLists(ctx);
const day = sampleDay(problemIds, cleanIds);
const sample = [...day.problems, ...day.clean].map((id) => {
  const d = docs.find((x) => x.id === id)!;
  return { id, designed: d.designed, state: d.state, outcome: d.outcome, total: d.total, fired: d.fired, to_confirm: d.check.to_confirm.length, judge_open: d.check.judge_open };
});

// ---- Write and print --------------------------------------------------------------------------------
const head = git("rev-parse", "HEAD");
const dirty = git("status", "--porcelain").split("\n").filter(Boolean);
const out = {
  definitions: "docs/value-metrics.md (pre-registered 2026-10-25, commit 36483de)",
  code_commit: head,
  working_tree_uncommitted: dirty,
  computed_at: localNow(),
  inputs: { data: "data/ (files)", state_cards: ctx.engine.cards.length, judgments_lines: judgmentLines, demo_copy_used: false, model_calls: 0 },
  documents: { total: docs.length, problem: docs.filter((d) => d.designed === "problem").map((d) => ({ id: d.id, why: d.designed_why, still_waiting_at_end: d.still_waiting_at_end })), clean: docs.filter((d) => d.designed === "clean").map((d) => ({ id: d.id, why: d.designed_why })) },
  metric_1_documents_and_money: { ...t1, p2_needs_judge: p2 },
  per_document: docs.map(({ check: _c, ...d }) => d),
  metric_2_records_to_read: { caught_documents: caught.length, ...s2, ratio_of_medians: ratioOfMedians, median_of_per_document_ratios: medianPerDocRatio, per_document: reading, estimate_note: "Time per investigation is the builder's own estimate from real work (1.5–2 hours, about 15–20 disputed quotes a month reaching the last check); not measured here." },
  metric_3_wo_pw_05: { held_usd: hero.held_usd, versions: forward },
  amendment_1: "docs/value-metrics-amendment-1.md (commit e309034)",
  metric_4_items_to_confirm: s4,
  metric_5_sample_day: { seed: SAMPLE_SEED, rule: "2 of the designed-problem and 8 of the designed-clean documents, uniform without replacement, each list sorted by id, mulberry32 (src/ui/sample.ts)", documents: sample },
  cannot_say: "The data is fictional and the problem documents were planted on purpose (about 57% problem documents). No real user has used the tool; time saved is not measured.",
};
writeFileSync(join(root, "eval/results/value-metrics.json"), JSON.stringify(out, null, 2) + "\n");

const pct = (x: number | null) => (x === null ? "n/a" : `${x}%`);
console.log(`value metrics · code ${head.slice(0, 7)}${dirty.length ? ` (+${dirty.length} uncommitted paths)` : ""} · computed ${out.computed_at} · ${ctx.engine.cards.length} cards · ${judgmentLines} judgments · no model calls`);
console.log(`fictional data; problem documents planted on purpose (${out.documents.problem.length} problem / ${out.documents.clean.length} clean); no real user; time not measured\n`);
console.log(`designed problem (${out.documents.problem.length}): ${out.documents.problem.map((d) => `${d.id} [${d.why}${d.still_waiting_at_end ? ", last version, still waiting" : ""}]`).join(", ")}`);
console.log(`designed clean (${out.documents.clean.length}): ${out.documents.clean.map((d) => d.id).join(", ")}\n`);
console.log("1. Documents and money");
const label: Record<string, string> = { caught: "caught", held: "held", missed: "missed", false_alarm: "false alarm", needs_person: "needs a person", cleared: "cleared" };
for (const o of OUTCOMES) {
  const b = t1.by_outcome[o];
  console.log(`   ${label[o].padEnd(15)} ${String(b.n).padStart(3)}  ${money(b.total).padStart(12)}   ${docs.filter((d) => d.outcome === o).map((d) => (d.fired.length ? `${d.id}[${d.fired.join(",")}]` : d.id)).join(" ")}`);
}
const notCleared = docs.filter((d) => d.state === "not_cleared");
const reasonCounts = (ds: typeof docs) => Object.entries(ds.flatMap((d) => d.not_cleared_reasons).reduce<Record<string, number>>((a, k) => ({ ...a, [k]: (a[k] ?? 0) + 1 }), {})).map(([k, n]) => `${k} ${n}`).join(", ");
console.log(`   why not cleared (held + needs a person, ${notCleared.length} docs; a doc can have several): ${reasonCounts(notCleared)}`);
console.log(`     needs a person only (${docs.filter((d) => d.outcome === "needs_person").length}): ${reasonCounts(docs.filter((d) => d.outcome === "needs_person"))}`);
console.log(`   stopped before sending: ${t1.stopped_before_sending.n}/${t1.problem.n} = ${pct(t1.stopped_before_sending.pct_by_count)} by count; ${money(t1.stopped_before_sending.total)}/${money(t1.problem.total)} = ${pct(t1.stopped_before_sending.pct_by_money)} by money`);
console.log(`   missed: ${t1.missed.n} (${pct(t1.missed.pct_by_count)}), ${money(t1.missed.total)} (${pct(t1.missed.pct_by_money)})`);
console.log(`   false alarms: ${t1.false_alarms.n}/${t1.clean.n} (${pct(t1.false_alarms.pct_by_count)}), ${money(t1.false_alarms.total)}/${money(t1.clean.total)} (${pct(t1.false_alarms.pct_by_money)})`);
console.log(`   P2 open (needs the Judge model step): ${p2.documents_with_p2_open.length} documents [${p2.documents_with_p2_open.join(" ")}]; not cleared only because of P2: ${p2.not_cleared_only_because_of_p2.length} [${p2.not_cleared_only_because_of_p2.join(" ")}]\n`);
console.log("2. Records a person would read, per caught problem document (work order + its client, both systems, up to the cut-off) vs distinct records the check cites");
for (const r of reading) console.log(`   ${r.id.padEnd(12)} ${r.fired.join(",").padEnd(12)} read ${String(r.to_read_client_and_job).padStart(3)} (job only ${String(r.to_read_job_only).padStart(2)})  cited ${String(r.cited).padStart(2)}`);
console.log(`   to read: median ${s2.to_read_client_and_job.median}, range ${s2.to_read_client_and_job.min}–${s2.to_read_client_and_job.max} (job only: median ${s2.to_read_job_only.median}, ${s2.to_read_job_only.min}–${s2.to_read_job_only.max})`);
console.log(`   cited:   median ${s2.cited.median}, range ${s2.cited.min}–${s2.cited.max}`);
console.log(`   ratio of medians ${ratioOfMedians}x; median of per-document ratios ${medianPerDocRatio}x`);
console.log(`   time: builder's estimate only, 1.5–2 h per investigation, ~15–20 disputed quotes a month (not measured)\n`);
console.log(`3. WO-PW-05 told forward · money at stake ${money(hero.held_usd.value)} (${hero.held_usd.method})`);
for (const v of forward) {
  console.log(`   ${v.quote} submitted ${v.submitted_at}, ${money(v.total)} → ${v.state}: ${v.verdict}`);
  for (const w of v.warnings) {
    console.log(`     ${w.pattern} ${w.title} · cites ${w.cited_records.join(" ")}${w.who_to_ask_derived.length ? ` · ask (derived): ${w.who_to_ask_derived.join(", ")}` : ""}`);
    for (const f of w.finding) console.log(`       - ${f}`);
  }
  for (const n of v.notes) console.log(`     note: ${n}`);
  if (v.what_happened) console.log(`     what happened: ${v.what_happened.at} ${v.what_happened.by} (${v.what_happened.record}): "${v.what_happened.text}" · reason given: ${v.what_happened.reason_given === false ? "no" : "unknown"}`);
}
const d4 = (x: ReturnType<typeof dist>) => `${x.documents} docs, ${x.items} items, median ${x.median}, range ${x.min}–${x.max}; need 1: ${x.need_1}, 2: ${x.need_2}, 3: ${x.need_3}, more: ${x.need_more}${x.need_0 ? `, 0: ${x.need_0}` : ""} · ${Object.entries(x.by_kind).map(([k, n]) => `${k} ${n}`).join(", ")}`;
console.log(`\n4. What a person has to confirm (amendment 1)`);
console.log(`   items over all ${docs.length} documents: ${s4.total_items_all_documents}; over the ${out.documents.clean.length} designed-clean: ${s4.total_items_designed_clean}`);
console.log(`   not cleared: ${d4(s4.not_cleared)}`);
console.log(`     designed problem: ${d4(s4.not_cleared_by_designed.problem)}`);
console.log(`     designed clean:   ${d4(s4.not_cleared_by_designed.clean)}`);
for (const d of s4.per_document) console.log(`     ${d.id.padEnd(12)} ${d.designed.padEnd(8)} ${d.items} item${d.items === 1 ? "" : "s"}: ${d.kinds.join(", ")}${d.p2_open ? " · and P2 needs the Judge step" : ""}`);
console.log(`   warnings (need a fix, not a confirmation): ${s4.warnings_need_a_fix.documents}`);
console.log(`   P2 needs the Judge step (not a person's item), not-cleared documents: ${s4.p2_needs_judge_not_a_persons_item.not_cleared_documents_with_p2_open.length} [${s4.p2_needs_judge_not_a_persons_item.not_cleared_documents_with_p2_open.join(" ")}]`);
console.log(`\n5. The sample day (seed ${SAMPLE_SEED})`);
for (const d of sample) console.log(`   ${d.id.padEnd(12)} ${d.designed.padEnd(8)} ${d.state.padEnd(12)} ${money(d.total).padStart(10)}  ${d.fired.length ? `fix: ${d.fired.join(",")}` : d.to_confirm ? `${d.to_confirm} left to confirm` : "ready"}${d.judge_open.length ? ` · ${d.judge_open.join(",")} needs the Judge step` : ""}`);
console.log(`\nwrote eval/results/value-metrics.json`);
