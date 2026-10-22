import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const WINDOW_START = Date.parse("2026-03-02T00:00:00-06:00");
const WINDOW_END = Date.parse("2026-06-26T23:59:59-05:00");

const OFFSET_RE = /[+-]\d{2}:\d{2}$/;
const REQUIRED_PATTERNS: Record<string, number> = {
  P1: 8,
  P2: 8,
  P3: 8,
  P4: 8,
  P5: 8,
  P6: 6,
  P7: 6,
  T2: 4,
  T6: 4,
  T10: 4,
  CTRL: 10,
};

type SourceRecord = {
  record_id: string;
  source_type: string;
  source_version: string;
  text: string;
  author: string;
  source_recorded_at: string;
  thread_id?: string;
  row_key?: string;
};

type GoldCard = {
  card_id: string;
  record_id: string;
  quote: string;
  mode: string;
  topic: string;
  facets: string[];
  scope: string;
  decided_at: string;
  effective: string;
  decided_by: string;
};

type GoldEdge = {
  old_card: string;
  new_card: string;
  relation: string;
};

type GoldQuestion = {
  question_id: string;
  pattern: string;
  question: string;
  as_of: string | null;
  seats: string[];
  expected_state: Record<string, string>;
  expected_current_card: string | null;
  expected_in_effect_card: string | null;
  expected_reasons: string[];
  expected_flags: string[];
  must_not_say: string[];
  expected_candidate_causes?: { cause: string; evidence: string[]; inference: boolean }[];
  expected_internal_reasons?: string[];
  expected_client_explanation?: string;
  expected_norm_sources?: string[];
};

type CsvRow = Record<string, string>;

const errors: string[] = [];
function fail(msg: string) {
  errors.push(msg);
}

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function parseJsonl<T>(rel: string): T[] {
  return read(rel)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, i) => {
      try {
        return JSON.parse(line) as T;
      } catch {
        fail(`${rel}:${i + 1} is not JSON`);
        return null as unknown as T;
      }
    })
    .filter(Boolean);
}

function parseCsv(rel: string): CsvRow[] {
  const text = read(rel).replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      if (row.some((c) => c.length)) rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    if (row.some((c) => c.length)) rows.push(row);
  }
  if (!rows.length) return [];
  const header = rows[0];
  return rows.slice(1).map((cols) => {
    const obj: CsvRow = {};
    header.forEach((h, i) => {
      obj[h] = cols[i] ?? "";
    });
    return obj;
  });
}

function parseYaml(text: string): Record<string, unknown> {
  const lines = text.split("\n");
  const rootObj: Record<string, unknown> = {};
  type Frame = { indent: number; obj: Record<string, unknown>; parent?: Record<string, unknown>; key?: string };
  const stack: Frame[] = [{ indent: -1, obj: rootObj }];
  for (const raw of lines) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    const indent = raw.match(/^ */)?.[0].length ?? 0;
    const trimmed = raw.trim();
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }
    const frame = stack[stack.length - 1];
    const parent = frame.obj;
    if (trimmed.startsWith("- ")) {
      // A "key:" line opened a child object; list items under it turn that key into a list.
      if (!frame.parent || !frame.key) continue;
      if (!Array.isArray(frame.parent[frame.key])) frame.parent[frame.key] = [];
      (frame.parent[frame.key] as unknown[]).push(coerce(trimmed.slice(2)));
      continue;
    }
    let key: string;
    let rest: string;
    if (trimmed.startsWith('"')) {
      const end = trimmed.indexOf('"', 1);
      if (end < 0) continue;
      key = trimmed.slice(1, end);
      rest = trimmed.slice(end + 1).replace(/^:\s*/, "");
    } else {
      const colon = trimmed.indexOf(":");
      if (colon < 0) continue;
      key = trimmed.slice(0, colon);
      rest = trimmed.slice(colon + 1).trim();
    }
    if (rest === "" || rest === "|" || rest === ">") {
      const child: Record<string, unknown> = {};
      parent[key] = child;
      stack.push({ indent, obj: child, parent, key });
    } else if (rest.startsWith("[") && rest.endsWith("]")) {
      const inner = rest.slice(1, -1).trim();
      parent[key] = inner
        ? inner.split(",").map((s) => coerce(s.trim()))
        : [];
    } else {
      parent[key] = coerce(rest);
    }
  }
  return rootObj;
}

function coerce(value: string): unknown {
  if (value === "[]") return [];
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  if (value === "null") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

function money(s: string): number {
  const n = Number(s);
  if (!Number.isFinite(n)) fail(`not a number: ${s}`);
  return Math.round(n * 100) / 100;
}

function checkTs(label: string, ts: string) {
  if (!OFFSET_RE.test(ts)) fail(`${label} missing offset: ${ts}`);
  const ms = Date.parse(ts);
  if (Number.isNaN(ms)) fail(`${label} unparseable: ${ts}`);
  if (ms < WINDOW_START || ms > WINDOW_END) fail(`${label} outside window: ${ts}`);
}

const readme = read("data/README.md");
if (!readme.includes("FICTIONAL")) fail("data/README.md must contain FICTIONAL");

const vocab = parseYaml(read("data/vocab.yaml"));
const scopes = (vocab.scopes ?? {}) as Record<string, unknown>;
const scopeKeys = new Set(Object.keys(scopes));
if (!scopeKeys.has("global")) fail("vocab.yaml missing scopes.global");

const records = parseJsonl<SourceRecord>("data/records/records.jsonl");
const cards = parseJsonl<GoldCard>("eval/gold/gold_cards.jsonl");
const edges = parseJsonl<GoldEdge>("eval/gold/gold_edges.jsonl");
const questions = parseJsonl<GoldQuestion>("eval/gold/gold_questions.jsonl");
const samples = JSON.parse(read("eval/gold/samples.json")) as { question_ids?: string[] };

const workOrders = parseCsv("data/tables/work_orders.csv");
const quoteVersions = parseCsv("data/tables/quote_versions.csv");
const quoteLines = parseCsv("data/tables/quote_lines.csv");
const submissionEvents = parseCsv("data/tables/submission_events.csv");
const invoices = parseCsv("data/tables/invoices.csv");
const invoiceLines = parseCsv("data/tables/invoice_lines.csv");
const clients = parseCsv("data/tables/clients.csv");

const recordById = new Map<string, SourceRecord>();
for (const rec of records) {
  if (!rec.record_id) fail("record missing record_id");
  if (recordById.has(rec.record_id)) fail(`duplicate record_id ${rec.record_id}`);
  recordById.set(rec.record_id, rec);
  checkTs(`record ${rec.record_id}`, rec.source_recorded_at);
}

const cardById = new Map<string, GoldCard>();
for (const card of cards) {
  if (!card.card_id) fail("gold card missing card_id");
  if (cardById.has(card.card_id)) fail(`duplicate card_id ${card.card_id}`);
  cardById.set(card.card_id, card);
  const rec = recordById.get(card.record_id);
  if (!rec) {
    fail(`card ${card.card_id} unknown record ${card.record_id}`);
    continue;
  }
  if (!rec.text.includes(card.quote)) {
    fail(`card ${card.card_id} quote not found in ${card.record_id}`);
  }
  checkTs(`card ${card.card_id} decided_at`, card.decided_at);
  checkTs(`card ${card.card_id} effective`, card.effective);
}

for (const edge of edges) {
  if (!cardById.has(edge.old_card)) fail(`edge old_card missing ${edge.old_card}`);
  if (!cardById.has(edge.new_card)) fail(`edge new_card missing ${edge.new_card}`);
  if (!["REPLACES", "SAME", "REFINES", "UNRELATED"].includes(edge.relation)) {
    fail(`edge bad relation ${edge.relation}`);
  }
}

const questionIds = new Set<string>();
const patternCounts: Record<string, number> = {};
for (const q of questions) {
  if (!q.question_id) fail("question missing question_id");
  if (questionIds.has(q.question_id)) fail(`duplicate question_id ${q.question_id}`);
  questionIds.add(q.question_id);
  patternCounts[q.pattern] = (patternCounts[q.pattern] ?? 0) + 1;
  for (const seat of q.seats ?? []) {
    if (!scopeKeys.has(seat)) fail(`question ${q.question_id} unknown seat ${seat}`);
  }
  for (const seat of Object.keys(q.expected_state ?? {})) {
    if (!scopeKeys.has(seat)) fail(`question ${q.question_id} expected_state seat ${seat} not in vocab`);
  }
  for (const field of ["expected_current_card", "expected_in_effect_card"] as const) {
    const id = q[field];
    if (id && !cardById.has(id)) fail(`question ${q.question_id} ${field} missing ${id}`);
  }
  for (const reason of q.expected_reasons ?? []) {
    if (reason !== "not_recorded" && !cardById.has(reason)) {
      fail(`question ${q.question_id} expected_reasons missing ${reason}`);
    }
  }
}

for (const [pattern, min] of Object.entries(REQUIRED_PATTERNS)) {
  const n = patternCounts[pattern] ?? 0;
  if (n < min) fail(`pattern ${pattern} has ${n}, need >= ${min}`);
}
const totalQ = questions.length;
if (totalQ < 72) fail(`only ${totalQ} questions, need >= 72`);

for (const id of samples.question_ids ?? []) {
  if (!questionIds.has(id)) fail(`samples.json unknown question ${id}`);
}
if ((samples.question_ids ?? []).length !== 3) fail("samples.json must list exactly 3 question ids");

function recordsFor(type: string, key: string): SourceRecord[] {
  return records.filter((r) => r.source_type === type && r.row_key === key);
}

function requireOne(type: string, key: string, tableTs: string, extras: string[]) {
  const found = recordsFor(type, key);
  if (found.length !== 1) fail(`${type} ${key} has ${found.length} records, expected 1`);
  const rec = found[0];
  if (!rec) return;
  if (rec.source_recorded_at !== tableTs) {
    fail(`${type} ${key} timestamp ${rec.source_recorded_at} != table ${tableTs}`);
  }
  for (const extra of extras) {
    if (!rec.text.includes(extra)) fail(`${type} ${key} record missing ${extra}`);
  }
}

const quoteById = new Map<string, CsvRow>();
const versionKeys = new Set<string>();
for (const q of quoteVersions) {
  if (quoteById.has(q.quote_id)) fail(`duplicate quote_id ${q.quote_id}`);
  quoteById.set(q.quote_id, q);
  const key = `${q.work_order_id}#${q.version}`;
  if (versionKeys.has(key)) fail(`two quote rows for ${key}`);
  versionKeys.add(key);
}

const quoteLineByQuote = new Map<string, CsvRow[]>();
for (const line of quoteLines) {
  const list = quoteLineByQuote.get(line.quote_id) ?? [];
  list.push(line);
  quoteLineByQuote.set(line.quote_id, list);
}

for (const q of quoteVersions) {
  const lines = quoteLineByQuote.get(q.quote_id) ?? [];
  let labor = 0;
  let material = 0;
  for (const line of lines) {
    const amount = money(line.amount);
    const expected = Math.round(Number(line.qty) * Number(line.unit_price) * 100) / 100;
    if (Math.abs(amount - expected) > 0.009) {
      fail(`quote line ${q.quote_id}#${line.line_no} amount ${amount} != qty*unit ${expected}`);
    }
    if (line.kind === "labor") labor += amount;
    else if (line.kind === "material") material += amount;
    else fail(`quote line ${q.quote_id}#${line.line_no} bad kind ${line.kind}`);
  }
  labor = Math.round(labor * 100) / 100;
  material = Math.round(material * 100) / 100;
  if (Math.abs(labor - money(q.total_labor)) > 0.009) fail(`quote ${q.quote_id} labor ${q.total_labor} != ${labor}`);
  if (Math.abs(material - money(q.total_material)) > 0.009) {
    fail(`quote ${q.quote_id} material ${q.total_material} != ${material}`);
  }
  const total = Math.round((labor + material) * 100) / 100;
  if (Math.abs(total - money(q.total)) > 0.009) fail(`quote ${q.quote_id} total ${q.total} != ${total}`);
  if (!["draft", "submitted", "voided", "approved", "rejected"].includes(q.status)) {
    fail(`quote ${q.quote_id} bad status ${q.status}`);
  }
  checkTs(`quote ${q.quote_id}`, q.submitted_at);
  requireOne("quote_version", q.quote_id, q.submitted_at, [
    q.quote_id,
    q.work_order_id,
    q.total_labor,
    q.total_material,
    q.total,
  ]);
}

const invoiceLineByInv = new Map<string, CsvRow[]>();
for (const line of invoiceLines) {
  const list = invoiceLineByInv.get(line.invoice_id) ?? [];
  list.push(line);
  invoiceLineByInv.set(line.invoice_id, list);
}

for (const inv of invoices) {
  const lines = invoiceLineByInv.get(inv.invoice_id) ?? [];
  let labor = 0;
  let material = 0;
  for (const line of lines) {
    const amount = money(line.amount);
    const expected = Math.round(Number(line.qty) * Number(line.unit_price) * 100) / 100;
    if (Math.abs(amount - expected) > 0.009) {
      fail(`invoice line ${inv.invoice_id}#${line.line_no} amount mismatch`);
    }
    if (line.kind === "labor") labor += amount;
    else if (line.kind === "material") material += amount;
    else fail(`invoice line ${inv.invoice_id} bad kind ${line.kind}`);
  }
  labor = Math.round(labor * 100) / 100;
  material = Math.round(material * 100) / 100;
  if (Math.abs(labor - money(inv.total_labor)) > 0.009) fail(`invoice ${inv.invoice_id} labor mismatch`);
  if (Math.abs(material - money(inv.total_material)) > 0.009) fail(`invoice ${inv.invoice_id} material mismatch`);
  const total = Math.round((labor + material) * 100) / 100;
  if (Math.abs(total - money(inv.total)) > 0.009) fail(`invoice ${inv.invoice_id} total mismatch`);
  if (!["draft", "sent", "disputed", "paid"].includes(inv.status)) fail(`invoice ${inv.invoice_id} bad status`);
  checkTs(`invoice ${inv.invoice_id}`, inv.issued_at);
  requireOne("invoice", inv.invoice_id, inv.issued_at, [
    inv.invoice_id,
    inv.work_order_id,
    inv.quote_id,
    inv.total_labor,
    inv.total_material,
    inv.total,
  ]);
  const billed = quoteById.get(inv.quote_id);
  if (!billed) fail(`invoice ${inv.invoice_id} bills unknown quote ${inv.quote_id}`);
  else {
    if (billed.version !== inv.quote_version) fail(`invoice ${inv.invoice_id} quote_version ${inv.quote_version} != ${billed.version}`);
    if (billed.work_order_id !== inv.work_order_id) fail(`invoice ${inv.invoice_id} work order differs from its quote`);
  }
}

for (const ev of submissionEvents) {
  if (!["created", "voided", "resubmitted", "notified"].includes(ev.event)) {
    fail(`submission ${ev.event_id} bad event ${ev.event}`);
  }
  checkTs(`submission ${ev.event_id}`, ev.at);
  requireOne("submission_event", ev.event_id, ev.at, [
    ev.event_id,
    ev.quote_id,
    ev.work_order_id,
    ev.event,
    ev.recipients_count,
  ]);
}

for (const wo of workOrders) {
  checkTs(`work_order ${wo.work_order_id}`, wo.opened_at);
}

// --- Consistency checks added on top of the task card's list ---

const workOrderById = new Map(workOrders.map((w) => [w.work_order_id, w]));
const TRADES = new Set(["electrical", "plumbing", "hvac", "roofing", "general"]);

// Cost categories: the only five a client portal accepts. kind (labor | material) feeds the totals columns.
const CATEGORIES = new Set(["labor", "travel", "material", "freight", "management"]);
const KIND_OF: Record<string, string> = { labor: "labor", travel: "labor", management: "labor", material: "material", freight: "material" };
const portalOf = new Map<string, Set<string>>();
for (const c of clients) {
  const cats = c.portal_categories.split(";").filter(Boolean);
  for (const cat of cats) if (!CATEGORIES.has(cat)) fail(`client ${c.client_id} portal category "${cat}" is not a known category`);
  portalOf.set(c.client_id, new Set(cats));
}
for (const w of workOrders) if (!portalOf.has(w.client_id)) fail(`work order ${w.work_order_id} client ${w.client_id} missing from clients.csv`);
for (const [table, rows] of [["quote_lines", quoteLines], ["invoice_lines", invoiceLines]] as const) {
  for (const l of rows) {
    const id = l.quote_id ?? l.invoice_id;
    if (!CATEGORIES.has(l.category)) fail(`${table} ${id}#${l.line_no} category "${l.category}" unknown`);
    else if (KIND_OF[l.category] !== l.kind) fail(`${table} ${id}#${l.line_no} category ${l.category} does not fit kind ${l.kind}`);
  }
}
// An approved quote was entered on the client portal, so every one of its lines is in a category that portal accepts.
// (End-of-window status is fine here: this is a data check, not an as-of answer.)
for (const q of quoteVersions.filter((x) => x.status === "approved")) {
  const portal = portalOf.get(workOrderById.get(q.work_order_id)?.client_id ?? "");
  for (const l of quoteLines.filter((x) => x.quote_id === q.quote_id)) {
    if (portal && !portal.has(l.category)) fail(`approved quote ${q.quote_id} has a ${l.category} line its client portal does not accept`);
  }
}
for (const w of workOrders) if (!TRADES.has(w.trade)) fail(`work order ${w.work_order_id} has trade "${w.trade}"`);
const peopleIds = new Set(readme.match(/p\.[a-z]{2}\.[a-z_]+/g) ?? []);
for (const rec of records) {
  if (!peopleIds.has(rec.author)) fail(`record ${rec.record_id} author ${rec.author} not listed in data/README.md`);
  if (rec.thread_id && !workOrderById.has(rec.thread_id)) fail(`record ${rec.record_id} thread ${rec.thread_id} is not a work order`);
}

// Table-derived records render a row as it looked when it was written. Words that judge the row
// (its later status, or whether it matches an approval) would hand the agent the answer.
const LEAK_RE = /\b(approved|rejected|voided|disputed|unexplained|silent(ly)?|instead of|not from|never)\b/i;
for (const rec of records) {
  if (rec.source_type !== "quote_version" && rec.source_type !== "invoice") continue;
  const hit = rec.text.match(LEAK_RE);
  if (hit) fail(`${rec.source_type} record ${rec.record_id} contains judging word "${hit[0]}"`);
}

const topics = new Set(Object.keys((vocab.topics ?? {}) as object));
const facets = new Set(Object.keys((vocab.facets ?? {}) as object));
const deciders = (vocab.deciders ?? {}) as Record<string, string[]>;
for (const card of cards) {
  if (!topics.has(card.topic)) fail(`card ${card.card_id} topic ${card.topic} not in vocab`);
  for (const f of card.facets) if (!facets.has(f)) fail(`card ${card.card_id} facet ${f} not in vocab`);
  if (!scopeKeys.has(card.scope)) fail(`card ${card.card_id} scope ${card.scope} not in vocab`);
  if (!["decides", "mentions", "gives_reason", "proposes"].includes(card.mode)) fail(`card ${card.card_id} bad mode ${card.mode}`);
  if (Date.parse(card.effective) < Date.parse(card.decided_at)) fail(`card ${card.card_id} effective before decided_at`);
  // A contractor can only propose; a decision on a client-owned topic must come from that topic's deciders.
  const allowed = deciders[card.topic];
  if (card.mode === "decides" && allowed && !allowed.includes(card.decided_by)) {
    fail(`card ${card.card_id} decides ${card.topic} but ${card.decided_by} is not a decider`);
  }
}

const KNOWN_PATTERNS = new Set(Object.keys(REQUIRED_PATTERNS).filter((p) => p !== "CTRL"));
// Warnings are alarms; time tags only name the time trap a question tests.
const WARNINGS = new Set(["P1", "P2", "P3", "P4", "P5", "P6", "P7"]);
for (const q of questions) {
  if (!(q.pattern in REQUIRED_PATTERNS)) fail(`question ${q.question_id} unknown pattern ${q.pattern}`);
  for (const f of q.expected_flags) if (!KNOWN_PATTERNS.has(f)) fail(`question ${q.question_id} unknown flag ${f}`);
  if (q.pattern === "CTRL" && q.expected_flags.some((f) => WARNINGS.has(f))) fail(`CTRL question ${q.question_id} must expect no warnings`);
  for (const id of q.expected_norm_sources ?? []) {
    const c = cardById.get(id);
    if (!c) fail(`question ${q.question_id} norm source ${id} is not a card`);
    else if (c.topic !== "approval") fail(`question ${q.question_id} norm source ${id} is not an approval`);
  }
  if (!q.as_of) continue;
  checkTs(`question ${q.question_id} as_of`, q.as_of);
  // as_of answers may only rest on decisions made by then (decided_at, not when they were written down).
  const refs = [q.expected_current_card, q.expected_in_effect_card, ...q.expected_reasons, ...(q.expected_norm_sources ?? [])];
  for (const id of refs) {
    const card = id ? cardById.get(id) : undefined;
    if (card && Date.parse(card.decided_at) > Date.parse(q.as_of)) {
      fail(`question ${q.question_id} cites ${id} decided after as_of`);
    }
  }
}

// P6 norms come only from approved quotes, so every client needs enough approved history.
const approvedByClient = new Map<string, number>();
for (const q of quoteVersions) {
  if (q.status !== "approved") continue;
  const client = workOrderById.get(q.work_order_id)?.client_id ?? "?";
  approvedByClient.set(client, (approvedByClient.get(client) ?? 0) + 1);
}
for (const client of new Set(workOrders.map((w) => w.client_id))) {
  const n = approvedByClient.get(client) ?? 0;
  if (n < 3) fail(`client ${client} has ${n} approved quotes, need >= 3 for P6 norms`);
}

// P2 split: internal reason vs. what the client-facing quote says.
for (const q of questions) {
  const touchesP2 = q.pattern === "P2" || q.expected_flags.includes("P2");
  const hasSplit = q.expected_client_explanation !== undefined || q.expected_internal_reasons !== undefined;
  if (touchesP2 && !hasSplit) fail(`question ${q.question_id} needs expected_internal_reasons and expected_client_explanation`);
  if (!hasSplit) continue;
  if (!Array.isArray(q.expected_internal_reasons)) fail(`question ${q.question_id} expected_internal_reasons must be a list`);
  if (!["present", "absent"].includes(q.expected_client_explanation ?? "")) {
    fail(`question ${q.question_id} expected_client_explanation must be present|absent`);
  }
  // P2 fires on what the client can read, even when an internal note has the reason.
  if (q.expected_flags.includes("P2") && q.expected_client_explanation !== "absent") {
    fail(`question ${q.question_id} flags P2 but says the client explanation is present`);
  }
  if (q.pattern === "CTRL" && q.expected_client_explanation !== "present") {
    fail(`CTRL question ${q.question_id} must have the client explanation present`);
  }
  for (const id of q.expected_internal_reasons ?? []) {
    if (!cardById.has(id) && !recordById.has(id)) fail(`question ${q.question_id} internal reason ${id} is neither a card nor a record`);
  }
}

// P5 without a stated reason: every candidate cause must point at real records, and at least two causes compete.
for (const q of questions) {
  const causes = q.expected_candidate_causes;
  if (!causes) continue;
  if (!q.expected_reasons.includes("not_recorded")) fail(`question ${q.question_id} lists candidate causes but has a stated reason`);
  if (causes.length < 2) fail(`question ${q.question_id} needs at least 2 candidate causes`);
  for (const c of causes) {
    if (!c.inference) fail(`question ${q.question_id} cause "${c.cause}" must be marked inference`);
    if (!c.evidence.length) fail(`question ${q.question_id} cause "${c.cause}" has no evidence`);
    for (const id of c.evidence) if (!recordById.has(id)) fail(`question ${q.question_id} evidence ${id} is not a record`);
  }
}

// P5 must not lean on one job, and must include incidents where the client gave no reason.
const p5PerJob = new Map<string, number>();
let p5NoReason = 0;
for (const q of questions.filter((x) => x.pattern === "P5")) {
  const job = q.seats.find((x) => x.startsWith("job:")) ?? "?";
  p5PerJob.set(job, (p5PerJob.get(job) ?? 0) + 1);
  if (q.expected_candidate_causes) p5NoReason++;
}
for (const [job, n] of p5PerJob) if (n > 3) fail(`P5 has ${n} questions on ${job}, max 3`);
if (p5NoReason < 2) fail(`P5 needs at least 2 questions on rejections with no stated reason, has ${p5NoReason}`);

// P1 must not be guessable from wording: no word pair may appear in every open-promise quote.
const p1Promises = new Set<string>();
for (const q of questions.filter((x) => x.pattern === "P1")) {
  for (const id of [q.expected_current_card, ...q.expected_reasons]) {
    const card = id ? cardById.get(id) : undefined;
    if (card && card.topic === "open_item" && card.mode === "proposes") p1Promises.add(card.card_id);
  }
}
const bigrams = (t: string) => {
  const w = t.toLowerCase().replace(/[^a-z' ]/g, " ").split(/\s+/).filter(Boolean);
  return new Set(w.slice(1).map((x, i) => `${w[i]} ${x}`));
};
const promiseQuotes = [...p1Promises].map((id) => cardById.get(id)!.quote);
if (promiseQuotes.length >= 2) {
  const shared = [...bigrams(promiseQuotes[0])].filter((b) => promiseQuotes.every((q) => bigrams(q).has(b)));
  if (shared.length) fail(`every P1 promise shares the phrase(s): ${shared.join(", ")}`);
}
// Closed promises (a later result REPLACES them) are the decoys; there must be some.
const closedPromises = edges.filter((e) => e.relation === "REPLACES" && cardById.get(e.old_card)?.topic === "open_item");
if (closedPromises.length < 3) fail(`need >= 3 closed promises as P1 decoys, have ${closedPromises.length}`);

// Card completeness: every client message and internal note has a card or is declared decision-free.
const noDecision = new Set((JSON.parse(read("eval/gold/no_decision_records.json")) as { record_ids: string[] }).record_ids);
const cardedRecords = new Set(cards.map((c) => c.record_id));
for (const id of noDecision) {
  if (!recordById.has(id)) fail(`no_decision_records lists unknown record ${id}`);
  if (cardedRecords.has(id)) fail(`no_decision_records lists ${id} but it has a card`);
}
for (const rec of records) {
  if (rec.source_type !== "client_message" && rec.source_type !== "internal_note") continue;
  if (!cardedRecords.has(rec.record_id) && !noDecision.has(rec.record_id)) {
    fail(`${rec.source_type} ${rec.record_id} has no gold card and is not in no_decision_records`);
  }
}

const patternRows = Object.keys({ ...REQUIRED_PATTERNS, ...patternCounts })
  .sort()
  .map((k) => `${k.padEnd(6)} ${String(patternCounts[k] ?? 0).padStart(3)}  (min ${REQUIRED_PATTERNS[k] ?? 0})`);

console.log("Pattern counts");
console.log(patternRows.join("\n"));
console.log(`Questions: ${totalQ}`);
console.log(`Records: ${records.length}`);
console.log(`Cards: ${cards.length}`);
console.log(`Work orders: ${workOrders.length}`);
console.log(`Quote versions: ${quoteVersions.length}`);
console.log(`Submission events: ${submissionEvents.length}`);
console.log(`Invoices: ${invoices.length}`);

if (errors.length) {
  console.error(`\n${errors.length} validation error(s):`);
  for (const err of errors.slice(0, 80)) console.error(`- ${err}`);
  if (errors.length > 80) console.error(`- … ${errors.length - 80} more`);
  process.exit(1);
}

console.log("\nvalidate-data: ok");
