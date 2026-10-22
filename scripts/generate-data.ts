import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function chicago(local: string): string {
  const day = local.slice(0, 10);
  if (day < "2026-03-02" || day > "2026-06-26") throw new Error(`out of window ${local}`);
  const offset = day < "2026-03-08" ? "-06:00" : "-05:00";
  return `${local}${offset}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function money(n: number): string {
  return round2(n).toFixed(2);
}

function csvEscape(value: string | number): string {
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(headers: string[], rows: Record<string, string | number>[]): string {
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h] ?? "")).join(","));
  }
  return lines.join("\n") + "\n";
}

function yamlList(items: string[], indent: number): string {
  const pad = " ".repeat(indent);
  if (!items.length) return " []\n";
  return "\n" + items.map((i) => `${pad}- ${i}`).join("\n") + "\n";
}

// category = the cost category a line rolls up into on the client portal. Every client portal
// accepts only these five, whatever the trade; kind (labor | material) is kept for the totals columns.
type Category = "labor" | "travel" | "material" | "freight" | "management";
type Line = {
  kind: "labor" | "material";
  category: Category;
  description: string;
  qty: number;
  unit_price: number;
  amount: number;
};

function L(kind: Line["kind"], description: string, qty: number, unit_price: number, category?: Category): Line {
  const cat = category ?? (/trip|mobiliz|travel/i.test(description) ? "travel" : kind);
  return { kind, category: cat, description, qty, unit_price, amount: round2(qty * unit_price) };
}

type RecordRow = {
  record_id: string;
  source_type:
    | "client_message"
    | "internal_note"
    | "field_note"
    | "quote_version"
    | "work_order"
    | "submission_event"
    | "invoice";
  source_version: string;
  text: string;
  author: string;
  source_recorded_at: string;
  thread_id?: string;
  row_key?: string;
};

type Card = {
  card_id: string;
  record_id: string;
  quote: string;
  mode: "decides" | "mentions" | "gives_reason" | "proposes";
  topic: string;
  facets: string[];
  scope: string;
  decided_at: string;
  effective: string;
  decided_by: string;
};

type Edge = { old_card: string; new_card: string; relation: "REPLACES" | "SAME" | "REFINES" | "UNRELATED" };

type Question = {
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
  // P5 without a stated reason: every candidate cause with its evidence records; none may be picked as the cause.
  expected_candidate_causes?: { cause: string; evidence: string[]; inference: true }[];
  // P2 split: why we changed the price internally vs. whether the client-facing quote says so.
  expected_internal_reasons?: string[];
  expected_client_explanation?: "present" | "absent";
  // P6: approved quotes the client's normal structure is read from (not the current decision on the seat).
  expected_norm_sources?: string[];
};

const records: RecordRow[] = [];
const cards: Card[] = [];
const edges: Edge[] = [];
const questions: Question[] = [];
const workOrders: Record<string, string | number>[] = [];
const quoteVersions: Record<string, string | number>[] = [];
const quoteLines: Record<string, string | number>[] = [];
const submissionEvents: Record<string, string | number>[] = [];
const invoices: Record<string, string | number>[] = [];
const invoiceLines: Record<string, string | number>[] = [];

let recN = 0;
let evN = 0;

function addRecord(row: Omit<RecordRow, "record_id" | "source_version"> & { source_version?: string; record_id?: string }): RecordRow {
  recN += 1;
  const full: RecordRow = {
    record_id: row.record_id ?? `rec-${String(recN).padStart(4, "0")}`,
    source_version: row.source_version ?? "v1",
    source_type: row.source_type,
    text: row.text,
    author: row.author,
    source_recorded_at: row.source_recorded_at,
    ...(row.thread_id ? { thread_id: row.thread_id } : {}),
    ...(row.row_key ? { row_key: row.row_key } : {}),
  };
  records.push(full);
  return full;
}

function addCard(card: Card): string {
  if (!records.some((r) => r.record_id === card.record_id && r.text.includes(card.quote))) {
    throw new Error(`card ${card.card_id} quote not in record ${card.record_id}`);
  }
  cards.push(card);
  return card.card_id;
}

function addEdge(old_card: string, new_card: string, relation: Edge["relation"]) {
  edges.push({ old_card, new_card, relation });
}

function Q(q: Question) {
  questions.push(q);
}

// Cost categories each client's portal accepts. A category outside this list cannot be entered on that
// client portal at all (North Loft's "no trip fees" and Pike Water's "no trip line" are this rule).
const CLIENTS = [
  { client_id: "cl.north_loft", name: "North Loft Holdings", portal_categories: "labor;material;freight;management" },
  { client_id: "cl.oak_circle", name: "Oak Circle Residences", portal_categories: "labor;travel;material;freight;management" },
  { client_id: "cl.pike_water", name: "Pike Water Commons", portal_categories: "labor;material;freight" },
  { client_id: "cl.red_mill", name: "Red Mill Civic Trust", portal_categories: "labor;material;management" },
];

// Trade of each job: P6 amount norms are built per client and trade.
const TRADE: Record<string, "electrical" | "plumbing" | "hvac" | "roofing" | "general"> = {
  "WO-NL-01": "electrical", "WO-NL-02": "plumbing", "WO-NL-03": "hvac", "WO-NL-04": "roofing",
  "WO-OC-01": "electrical", "WO-OC-02": "plumbing", "WO-OC-03": "hvac", "WO-OC-04": "general", "WO-OC-05": "hvac",
  "WO-PW-01": "electrical", "WO-PW-02": "plumbing", "WO-PW-03": "roofing", "WO-PW-04": "hvac", "WO-PW-05": "roofing",
  "WO-RM-01": "electrical", "WO-RM-02": "plumbing", "WO-RM-03": "hvac", "WO-RM-04": "general",
};

function addWO(work_order_id: string, client_id: string, job_title: string, opened_at: string, status: string, author: string, text: string) {
  const trade = TRADE[work_order_id];
  if (!trade) throw new Error(`no trade for ${work_order_id}`);
  workOrders.push({ work_order_id, client_id, job_title, trade, opened_at, status });
  addRecord({
    source_type: "work_order",
    author,
    source_recorded_at: opened_at,
    thread_id: work_order_id,
    row_key: work_order_id,
    text,
  });
}

function addQuote(opts: {
  quote_id: string;
  work_order_id: string;
  version: number;
  submitted_at: string;
  submitted_by: string;
  status: "draft" | "submitted" | "voided" | "approved" | "rejected";
  scope_summary: string;
  lines: Line[];
  extraText?: string;
}) {
  const labor = round2(opts.lines.filter((l) => l.kind === "labor").reduce((s, l) => s + l.amount, 0));
  const material = round2(opts.lines.filter((l) => l.kind === "material").reduce((s, l) => s + l.amount, 0));
  const total = round2(labor + material);
  quoteVersions.push({
    quote_id: opts.quote_id,
    work_order_id: opts.work_order_id,
    version: opts.version,
    submitted_at: opts.submitted_at,
    submitted_by: opts.submitted_by,
    status: opts.status,
    total_labor: money(labor),
    total_material: money(material),
    total: money(total),
    scope_summary: opts.scope_summary,
  });
  opts.lines.forEach((line, i) => {
    quoteLines.push({
      quote_id: opts.quote_id,
      line_no: i + 1,
      kind: line.kind,
      category: line.category,
      description: line.description,
      qty: line.qty,
      unit_price: money(line.unit_price),
      amount: money(line.amount),
    });
  });
  // The record renders the row as the client would read it at submission time.
  // Status is deliberately left out: it is only known later, from client messages and events.
  addRecord({
    source_type: "quote_version",
    author: opts.submitted_by,
    source_recorded_at: opts.submitted_at,
    thread_id: opts.work_order_id,
    row_key: opts.quote_id,
    text: `Quote ${opts.quote_id} (version ${opts.version}) for ${opts.work_order_id}, sent ${opts.submitted_at} by ${NAME[opts.submitted_by]}. Labor ${money(labor)}, material ${money(material)}, total ${money(total)}. Scope: ${opts.scope_summary} Lines: ${lineText(opts.lines)}${opts.extraText ? ` Cover note: "${opts.extraText}"` : ""}`,
  });
  return { labor, material, total, record_id: records[records.length - 1].record_id };
}

function lineText(lines: Line[]): string {
  return lines
    .map((l, i) => `${i + 1}. ${l.category}: ${l.description}, ${l.qty} x ${money(l.unit_price)} = ${money(l.amount)}`)
    .join("; ");
}

function addEvent(quote_id: string, work_order_id: string, event: string, at: string, recipients_count: number, author: string) {
  evN += 1;
  const event_id = `ev-${String(evN).padStart(3, "0")}`;
  submissionEvents.push({ event_id, quote_id, work_order_id, event, at, recipients_count });
  return addRecord({
    source_type: "submission_event",
    author,
    source_recorded_at: at,
    thread_id: work_order_id,
    row_key: event_id,
    text: `Submission log ${event_id}: ${quote_id} (${work_order_id}) ${event} at ${at}, recipients ${recipients_count}.`,
  });
}

function addInvoice(opts: {
  invoice_id: string;
  work_order_id: string;
  quote_id: string;
  quote_version: number;
  issued_at: string;
  status: "draft" | "sent" | "disputed" | "paid";
  lines: Line[];
  author: string;
}) {
  const labor = round2(opts.lines.filter((l) => l.kind === "labor").reduce((s, l) => s + l.amount, 0));
  const material = round2(opts.lines.filter((l) => l.kind === "material").reduce((s, l) => s + l.amount, 0));
  const total = round2(labor + material);
  invoices.push({
    invoice_id: opts.invoice_id,
    work_order_id: opts.work_order_id,
    quote_id: opts.quote_id,
    quote_version: opts.quote_version,
    issued_at: opts.issued_at,
    total_labor: money(labor),
    total_material: money(material),
    total: money(total),
    status: opts.status,
  });
  opts.lines.forEach((line, i) => {
    invoiceLines.push({
      invoice_id: opts.invoice_id,
      line_no: i + 1,
      kind: line.kind,
      category: line.category,
      description: line.description,
      qty: line.qty,
      unit_price: money(line.unit_price),
      amount: money(line.amount),
    });
  });
  addRecord({
    source_type: "invoice",
    author: opts.author,
    source_recorded_at: opts.issued_at,
    thread_id: opts.work_order_id,
    row_key: opts.invoice_id,
    // Like quotes, invoice status (paid / disputed) is left out of the text: it is learned later.
    text: `Invoice ${opts.invoice_id} for ${opts.work_order_id}, issued ${opts.issued_at} by ${NAME[opts.author]}, billed against quote ${opts.quote_id} (version ${opts.quote_version}). Labor ${money(labor)}, material ${money(material)}, total ${money(total)}. Lines: ${lineText(opts.lines)}`,
  });
}

function msg(
  source_type: "client_message" | "internal_note" | "field_note",
  author: string,
  at: string,
  wo: string,
  text: string,
  record_id?: string,
) {
  return addRecord({
    record_id,
    source_type,
    author,
    source_recorded_at: at,
    thread_id: wo,
    text,
  });
}

const J = {
  mira: "p.hw.mira_kell",
  jonah: "p.hw.jonah_prent",
  delia: "p.hw.delia_vorn",
  cal: "p.hw.cal_rhees",
  nora: "p.hw.nora_quinn",
  wes: "p.hw.wes_dalby",
  ria: "p.nl.ria_moth",
  helen: "p.oc.helen_bray",
  tomas: "p.oc.tomas_frey",
  otto: "p.pw.otto_gell",
  yvette: "p.rm.yvette_sarn",
  paul: "p.rm.paul_kett",
};

const NAME: Record<string, string> = {
  [J.mira]: "Mira Kell",
  [J.jonah]: "Jonah Prent",
  [J.delia]: "Delia Vorn",
  [J.cal]: "Cal Rhees",
  [J.nora]: "Nora Quinn",
  [J.wes]: "Wes Dalby",
  [J.ria]: "Ria Moth",
  [J.helen]: "Helen Bray",
  [J.tomas]: "Tomas Frey",
  [J.otto]: "Otto Gell",
  [J.yvette]: "Yvette Sarn",
  [J.paul]: "Paul Kett",
};

const NL = "cl.north_loft";
const OC = "cl.oak_circle";
const PW = "cl.pike_water";
const RM = "cl.red_mill";

const nl01 = "WO-NL-01";
const nl02 = "WO-NL-02";
const nl03 = "WO-NL-03";
const nl04 = "WO-NL-04";
const oc01 = "WO-OC-01";
const oc02 = "WO-OC-02";
const oc03 = "WO-OC-03";
const oc04 = "WO-OC-04";
const pw01 = "WO-PW-01";
const pw02 = "WO-PW-02";
const pw03 = "WO-PW-03";
const pw04 = "WO-PW-04";
const rm01 = "WO-RM-01";
const rm02 = "WO-RM-02";
const rm03 = "WO-RM-03";
const rm04 = "WO-RM-04";
const pw05 = "WO-PW-05";
const oc05 = "WO-OC-05";

const nlElec = [
  L("labor", "Safe-off and disconnect existing 150A panel", 4, 92),
  L("labor", "Install 200A load center and ground bus", 8, 92),
  L("material", "200A 30-space load center", 1, 486),
  L("material", "Breaker kit and ground bar", 1, 214),
];
const nlElecV2 = [
  L("labor", "Safe-off and disconnect existing 150A panel", 4, 92),
  L("labor", "Install 200A load center and ground bus", 8, 92),
  L("labor", "Add isolated ground for studio riser — extra 2 hours as discussed after opening the gutter", 2, 92),
  L("material", "200A 30-space load center", 1, 486),
  L("material", "Breaker kit and ground bar", 1, 214),
];
const nlElecV3 = [
  L("labor", "Safe-off and disconnect existing 150A panel", 4, 92),
  L("labor", "Install 200A load center and ground bus", 8, 92),
  L("labor", "Add isolated ground for studio riser — extra 2 hours as discussed after opening the gutter", 2, 92),
  L("material", "200A 30-space load center", 1, 486),
  L("material", "Breaker kit and ground bar", 1, 214),
  L("material", "Surge device required by city inspector note 3/16", 1, 168),
];

addWO(nl01, NL, "Replace 200A house panel at Loft 1A", chicago("2026-03-03T08:10:00"), "closed", J.delia, "Opened WO-NL-01 for North Loft Holdings: replace the house panel at Loft 1A after the 150A can would not reset.");
addQuote({
  quote_id: "Q-NL-01-v1",
  work_order_id: nl01,
  version: 1,
  submitted_at: chicago("2026-03-04T09:15:00"),
  submitted_by: J.jonah,
  status: "approved",
  scope_summary: "Replace 150A panel with 200A load center; labor and material split as usual.",
  lines: nlElec,
});
addEvent("Q-NL-01-v1", nl01, "created", chicago("2026-03-04T09:15:00"), 1, J.jonah);
addEvent("Q-NL-01-v1", nl01, "notified", chicago("2026-03-04T09:16:00"), 1, J.jonah);
const recRiaApproveV1 = msg("client_message", J.ria, chicago("2026-03-05T07:40:00"), nl01, "Approved as sent at $92 an hour. Do not add trip fees.");
addCard({
  card_id: "card.nl01.approve.v1",
  record_id: recRiaApproveV1.record_id,
  quote: "Approved as sent at $92 an hour. Do not add trip fees.",
  mode: "decides",
  topic: "approval",
  facets: ["approval.status", "scope.structure"],
  scope: `job:${nl01}`,
  decided_at: recRiaApproveV1.source_recorded_at,
  effective: recRiaApproveV1.source_recorded_at,
  decided_by: J.ria,
});

// Closed promise (decoy for P1): the result is recorded and the next quote reflects it.
const nl01GroundPromise = msg("client_message", J.mira, chicago("2026-03-06T16:05:00"), nl01, "Ria, Cal has the panel cover off. Once he opens the gutter we'll see if the studio riser needs its own isolated ground. I'll tell you either way before we requote.");
addCard({
  card_id: "card.nl01Ground.promise",
  record_id: nl01GroundPromise.record_id,
  quote: "Once he opens the gutter we'll see if the studio riser needs its own isolated ground",
  mode: "proposes",
  topic: "open_item",
  facets: ["open_item.inspection"],
  scope: `job:${nl01}`,
  decided_at: nl01GroundPromise.source_recorded_at,
  effective: nl01GroundPromise.source_recorded_at,
  decided_by: J.mira,
});
const nl01GroundResult = msg("field_note", J.cal, chicago("2026-03-11T15:00:00"), nl01, "Opened the gutter at Loft 1A. Studio riser does need an isolated ground. About two hours of labor, no extra parts.");
addCard({
  card_id: "card.nl01Ground.result",
  record_id: nl01GroundResult.record_id,
  quote: "Studio riser does need an isolated ground. About two hours of labor, no extra parts.",
  mode: "gives_reason",
  topic: "open_item",
  facets: ["open_item.inspection", "scope.lines"],
  scope: `job:${nl01}`,
  decided_at: nl01GroundResult.source_recorded_at,
  effective: nl01GroundResult.source_recorded_at,
  decided_by: J.cal,
});
addEdge("card.nl01Ground.promise", "card.nl01Ground.result", "REPLACES");
addQuote({
  quote_id: "Q-NL-01-v2",
  work_order_id: nl01,
  version: 2,
  submitted_at: chicago("2026-03-12T10:05:00"),
  submitted_by: J.jonah,
  status: "approved",
  scope_summary: "Same panel swap plus isolated ground hours found after opening the gutter.",
  extraText: "Price change is the extra 2 hours of isolated-ground labor after we opened the gutter.",
  lines: nlElecV2,
});
addEvent("Q-NL-01-v2", nl01, "created", chicago("2026-03-12T10:05:00"), 1, J.jonah);
addEvent("Q-NL-01-v2", nl01, "notified", chicago("2026-03-12T10:06:00"), 1, J.jonah);
const recRiaApproveV2 = msg("client_message", J.ria, chicago("2026-03-13T08:02:00"), nl01, "Ok on the extra ground hours. Approved.");
addCard({
  card_id: "card.nl01.approve.v2",
  record_id: recRiaApproveV2.record_id,
  quote: "Ok on the extra ground hours. Approved.",
  mode: "decides",
  topic: "approval",
  facets: ["approval.status", "price.labor"],
  scope: `job:${nl01}`,
  decided_at: recRiaApproveV2.source_recorded_at,
  effective: recRiaApproveV2.source_recorded_at,
  decided_by: J.ria,
});
addEdge("card.nl01.approve.v1", "card.nl01.approve.v2", "REPLACES");

const recInspector = msg(
  "field_note",
  J.cal,
  chicago("2026-03-16T11:40:00"),
  nl01,
  "City inspector stopped by the loft. He wants a whole-house surge device on the new panel before he signs the final. His note is dated 3/16.",
);
addCard({
  card_id: "card.nl01.inspector.surge",
  record_id: recInspector.record_id,
  quote: "He wants a whole-house surge device on the new panel before he signs the final",
  mode: "gives_reason",
  topic: "scope",
  facets: ["scope.lines", "price.material"],
  scope: `job:${nl01}`,
  decided_at: recInspector.source_recorded_at,
  effective: recInspector.source_recorded_at,
  decided_by: J.cal,
});
addQuote({
  quote_id: "Q-NL-01-v3",
  work_order_id: nl01,
  version: 3,
  submitted_at: chicago("2026-03-16T16:30:00"),
  submitted_by: J.jonah,
  status: "approved",
  scope_summary: "Panel swap, isolated ground, plus inspector-required surge device.",
  extraText: "Material increase is the surge device required by city inspector note 3/16.",
  lines: nlElecV3,
});
addEvent("Q-NL-01-v3", nl01, "created", chicago("2026-03-16T16:30:00"), 1, J.jonah);
addEvent("Q-NL-01-v3", nl01, "notified", chicago("2026-03-16T16:31:00"), 1, J.jonah);
const recCallApprove = msg(
  "internal_note",
  J.jonah,
  chicago("2026-03-20T11:30:00"),
  nl01,
  "Writing this down three days late: Ria said on the 17th call that Q-NL-01-v3 is approved now that the surge device from the inspector is on the quote. The call was 17 March 2026 at 09:20.",
);
addCard({
  card_id: "card.nl01.approve.v3",
  record_id: recCallApprove.record_id,
  quote: "Ria said on the 17th call that Q-NL-01-v3 is approved now that the surge device from the inspector is on the quote",
  mode: "decides",
  topic: "approval",
  facets: ["approval.status", "price.material"],
  scope: `job:${nl01}`,
  decided_at: chicago("2026-03-17T09:20:00"),
  effective: chicago("2026-03-17T09:20:00"),
  decided_by: J.ria,
});
addEdge("card.nl01.approve.v2", "card.nl01.approve.v3", "REPLACES");

const recNlLabor = msg(
  "client_message",
  J.ria,
  chicago("2026-04-08T07:55:00"),
  nl01,
  "Electrical labor for North Loft is $98 per hour from 1 May 2026. Leave material pricing as already approved.",
);
addCard({
  card_id: "card.nl.labor.old",
  record_id: recRiaApproveV1.record_id,
  quote: "$92 an hour",
  mode: "decides",
  topic: "price",
  facets: ["price.labor"],
  scope: `client:${NL}`,
  decided_at: recRiaApproveV1.source_recorded_at,
  effective: recRiaApproveV1.source_recorded_at,
  decided_by: J.ria,
});
addCard({
  card_id: "card.nl.labor.new",
  record_id: recNlLabor.record_id,
  quote: "Electrical labor for North Loft is $98 per hour from 1 May 2026",
  mode: "decides",
  topic: "price",
  facets: ["price.labor", "approval.effective"],
  scope: `client:${NL}`,
  decided_at: recNlLabor.source_recorded_at,
  effective: chicago("2026-05-01T00:00:00"),
  decided_by: J.ria,
});
addCard({
  card_id: "card.nl.material.keep",
  record_id: recNlLabor.record_id,
  quote: "Leave material pricing as already approved",
  mode: "decides",
  topic: "price",
  facets: ["price.material"],
  scope: `client:${NL}`,
  decided_at: recNlLabor.source_recorded_at,
  effective: recNlLabor.source_recorded_at,
  decided_by: J.ria,
});
addEdge("card.nl.labor.old", "card.nl.labor.new", "REPLACES");

const recNlCap = msg(
  "client_message",
  J.ria,
  chicago("2026-03-10T08:00:00"),
  nl01,
  "Anything over $2500 needs a one-line note from me before you submit. No exceptions.",
);
addCard({
  card_id: "card.nl.cap.inforce",
  record_id: recNlCap.record_id,
  quote: "Anything over $2500 needs a one-line note from me before you submit",
  mode: "decides",
  topic: "client_rule",
  facets: ["client_rule.cap"],
  scope: `client:${NL}`,
  decided_at: recNlCap.source_recorded_at,
  effective: recNlCap.source_recorded_at,
  decided_by: J.ria,
});
const recNlCapLift = msg(
  "client_message",
  J.ria,
  chicago("2026-06-02T08:11:00"),
  nl01,
  "Cap is lifted for the rest of 2026. You do not need the pre-note anymore.",
);
addCard({
  card_id: "card.nl.cap.withdrawn",
  record_id: recNlCapLift.record_id,
  quote: "Cap is lifted for the rest of 2026. You do not need the pre-note anymore.",
  mode: "decides",
  topic: "client_rule",
  facets: ["client_rule.cap"],
  scope: `client:${NL}`,
  decided_at: recNlCapLift.source_recorded_at,
  effective: recNlCapLift.source_recorded_at,
  decided_by: J.ria,
});
addEdge("card.nl.cap.inforce", "card.nl.cap.withdrawn", "REPLACES");

addInvoice({
  invoice_id: "INV-NL-01",
  work_order_id: nl01,
  quote_id: "Q-NL-01-v3",
  quote_version: 3,
  issued_at: chicago("2026-04-03T10:00:00"),
  status: "paid",
  author: J.jonah,
  lines: nlElecV3,
});
msg("field_note", J.cal, chicago("2026-03-06T15:20:00"), nl01, "Panel cover off. Bus is heat-stained. Photos in the job folder.");
msg("field_note", J.cal, chicago("2026-03-18T16:05:00"), nl01, "200A can landed. Surge device installed. Tenant power restored.");
msg("internal_note", J.mira, chicago("2026-03-04T08:50:00"), nl01, "Built v1 on the usual North Loft electrical split: two labor lines then named material.");

const nl02v1 = [
  L("labor", "Drain and disconnect 40gal heater", 3, 88),
  L("labor", "Set new 40gal and recirc connections", 5, 88),
  L("material", "40gal electric water heater", 1, 620),
  L("material", "Supply stops and dielectric unions", 1, 74),
  L("material", "Freight, 40gal heater delivery", 1, 45, "freight"),
];
const nl02v2 = [
  L("labor", "Drain and disconnect 40gal heater", 3, 88),
  L("labor", "Set new 40gal and recirc connections", 5, 88),
  L("material", "40gal electric water heater", 1, 620),
  L("material", "Supply stops and dielectric unions", 1, 74),
  L("material", "Expansion tank if needed after second look", 1, 186),
  L("material", "Freight, 40gal heater delivery", 1, 45, "freight"),
];
const nl02v3 = [
  L("labor", "Drain and disconnect 40gal heater", 3, 88),
  L("labor", "Set new 40gal and recirc connections", 5, 88),
  L("material", "40gal electric water heater", 1, 790),
  L("material", "Supply stops and dielectric unions", 1, 74),
  L("material", "Expansion tank if needed after second look", 1, 186),
  L("material", "Freight, 40gal heater delivery", 1, 45, "freight"),
];

addWO(nl02, NL, "Water heater swap at Loft 2B", chicago("2026-03-12T09:00:00"), "open", J.delia, "Opened WO-NL-02: Loft 2B water heater is leaking at the dip tube.");
addQuote({
  quote_id: "Q-NL-02-v1",
  work_order_id: nl02,
  version: 1,
  submitted_at: chicago("2026-03-13T11:20:00"),
  submitted_by: J.jonah,
  status: "approved",
  scope_summary: "Swap 40gal electric heater; labor then material.",
  lines: nl02v1,
});
addEvent("Q-NL-02-v1", nl02, "created", chicago("2026-03-13T11:20:00"), 1, J.jonah);
addEvent("Q-NL-02-v1", nl02, "notified", chicago("2026-03-13T11:21:00"), 1, J.jonah);
const recNl02Appr = msg("client_message", J.ria, chicago("2026-03-14T07:33:00"), nl02, "Fine. Swap the heater.");
addCard({
  card_id: "card.nl02.approve.v1",
  record_id: recNl02Appr.record_id,
  quote: "Fine. Swap the heater.",
  mode: "decides",
  topic: "approval",
  facets: ["approval.status"],
  scope: `job:${nl02}`,
  decided_at: recNl02Appr.source_recorded_at,
  effective: recNl02Appr.source_recorded_at,
  decided_by: J.ria,
});
const recPromiseTank = msg(
  "internal_note",
  J.mira,
  chicago("2026-03-19T14:12:00"),
  nl02,
  "Phone summary, Ria, 19 Mar: she asked about the expansion tank. Said Nora will open the closet Friday and we would tell her then if the tank has to come out. Carrying it as an allowance for now.",
);
addCard({
  card_id: "card.nl02.promise.tank",
  record_id: recPromiseTank.record_id,
  quote: "Said Nora will open the closet Friday and we would tell her then if the tank has to come out",
  mode: "proposes",
  topic: "open_item",
  facets: ["open_item.inspection"],
  scope: `job:${nl02}`,
  decided_at: recPromiseTank.source_recorded_at,
  effective: recPromiseTank.source_recorded_at,
  decided_by: J.mira,
});
addQuote({
  quote_id: "Q-NL-02-v2",
  work_order_id: nl02,
  version: 2,
  submitted_at: chicago("2026-03-24T09:50:00"),
  submitted_by: J.jonah,
  status: "submitted",
  scope_summary: "Swap 40gal electric heater; labor then material.",
  lines: nl02v2,
});
addEvent("Q-NL-02-v2", nl02, "created", chicago("2026-03-24T09:50:00"), 1, J.jonah);
addEvent("Q-NL-02-v2", nl02, "notified", chicago("2026-03-24T09:51:00"), 1, J.jonah);
addQuote({
  quote_id: "Q-NL-02-v3",
  work_order_id: nl02,
  version: 3,
  submitted_at: chicago("2026-04-07T10:15:00"),
  submitted_by: J.jonah,
  status: "submitted",
  scope_summary: "Swap 40gal electric heater; labor then material.",
  lines: nl02v3,
});
addEvent("Q-NL-02-v3", nl02, "created", chicago("2026-04-07T10:15:00"), 1, J.jonah);
addEvent("Q-NL-02-v3", nl02, "notified", chicago("2026-04-07T10:16:00"), 1, J.jonah);
msg("field_note", J.nora, chicago("2026-03-15T13:40:00"), nl02, "Heater drained. Pan is rusted through at the back corner.");
msg("field_note", J.nora, chicago("2026-04-06T16:10:00"), nl02, "Second visit cancelled by tenant. Closet not opened. No new reading on the tank.");
msg("internal_note", J.jonah, chicago("2026-04-07T09:55:00"), nl02, "Supplier sheet for the 40gal came in this morning. Sending v3 to Ria before lunch.");

const nl03scope = "Find why the condenser will not hold cool. Need to determine the cause before naming parts.";
const nl03v1 = [
  L("labor", "Recover and gauge condenser", 3, 95),
  L("labor", "Need to determine the cause of short cycling", 2, 95),
  L("material", "Gauge manifold consumables", 1, 28),
];
const nl03v2 = [
  L("labor", "Recover and gauge condenser", 3, 95),
  L("labor", "Need to determine the cause of short cycling", 4, 95),
  L("material", "Gauge manifold consumables", 1, 28),
];
const nl03v3 = [
  L("labor", "Recover and gauge condenser", 3, 95),
  L("labor", "Need to determine the cause of short cycling", 4, 95),
  L("material", "Gauge manifold consumables", 1, 28),
  L("material", "Contingency capacitor if that is the cause", 1, 64),
];
const nl03v4 = [
  L("labor", "Recover and gauge condenser", 3, 95),
  L("labor", "Still need to determine the cause of short cycling", 5, 95),
  L("material", "Gauge manifold consumables", 1, 28),
  L("material", "Contingency capacitor if that is the cause", 1, 64),
];

addWO(nl03, NL, "Condenser not cooling at Loft 4C", chicago("2026-03-18T08:30:00"), "open", J.delia, "Opened WO-NL-03: Loft 4C condenser short-cycles and will not hold cool.");
addQuote({
  quote_id: "Q-NL-03-v1",
  work_order_id: nl03,
  version: 1,
  submitted_at: chicago("2026-03-19T10:00:00"),
  submitted_by: J.jonah,
  status: "approved",
  scope_summary: nl03scope,
  extraText: "Diagnostic visit only; cause not yet named.",
  lines: nl03v1,
});
addEvent("Q-NL-03-v1", nl03, "created", chicago("2026-03-19T10:00:00"), 1, J.jonah);
addEvent("Q-NL-03-v1", nl03, "notified", chicago("2026-03-19T10:01:00"), 1, J.jonah);
const recNl03Appr = msg("client_message", J.ria, chicago("2026-03-20T07:18:00"), nl03, "Do the gauges. Then tell me what failed.");
addCard({
  card_id: "card.nl03.approve.v1",
  record_id: recNl03Appr.record_id,
  quote: "Do the gauges. Then tell me what failed.",
  mode: "decides",
  topic: "approval",
  facets: ["approval.status", "open_item.inspection"],
  scope: `job:${nl03}`,
  decided_at: recNl03Appr.source_recorded_at,
  effective: recNl03Appr.source_recorded_at,
  decided_by: J.ria,
});
addQuote({
  quote_id: "Q-NL-03-v2",
  work_order_id: nl03,
  version: 2,
  submitted_at: chicago("2026-04-02T09:30:00"),
  submitted_by: J.jonah,
  status: "submitted",
  scope_summary: nl03scope,
  extraText: "We still need to determine the cause of the short cycling.",
  lines: nl03v2,
});
addEvent("Q-NL-03-v2", nl03, "created", chicago("2026-04-02T09:30:00"), 1, J.jonah);
addEvent("Q-NL-03-v2", nl03, "notified", chicago("2026-04-02T09:31:00"), 1, J.jonah);
addQuote({
  quote_id: "Q-NL-03-v3",
  work_order_id: nl03,
  version: 3,
  submitted_at: chicago("2026-04-21T11:10:00"),
  submitted_by: J.jonah,
  status: "submitted",
  scope_summary: nl03scope,
  extraText: "Included a capacitor in case that turns out to be the cause.",
  lines: nl03v3,
});
addEvent("Q-NL-03-v3", nl03, "created", chicago("2026-04-21T11:10:00"), 1, J.jonah);
addEvent("Q-NL-03-v3", nl03, "notified", chicago("2026-04-21T11:11:00"), 1, J.jonah);
addQuote({
  quote_id: "Q-NL-03-v4",
  work_order_id: nl03,
  version: 4,
  submitted_at: chicago("2026-05-12T09:45:00"),
  submitted_by: J.jonah,
  status: "submitted",
  scope_summary: nl03scope,
  extraText: "Still working to determine the cause of the short cycling.",
  lines: nl03v4,
});
addEvent("Q-NL-03-v4", nl03, "created", chicago("2026-05-12T09:45:00"), 1, J.jonah);
addEvent("Q-NL-03-v4", nl03, "notified", chicago("2026-05-12T09:46:00"), 1, J.jonah);
msg("field_note", J.wes, chicago("2026-03-21T17:00:00"), nl03, "Gauged the unit. Head pressure is high. I am not naming a failed part yet.");
msg("field_note", J.wes, chicago("2026-04-20T16:40:00"), nl03, "Returned. Same short cycle. Still tracing.");
msg("internal_note", J.mira, chicago("2026-05-11T15:22:00"), nl03, "Wes thinks it might be the capacitor but he has not confirmed it. Do not put that in front of Ria yet.");

const roofV1 = [
  L("labor", "Remove damaged step flashing at south wall", 6, 85),
  L("labor", "Install new step flashing and counterflash", 8, 85),
  L("material", "Step flashing and sealant", 1, 240),
];
const roofV2 = [
  L("labor", "Remove damaged step flashing at south wall", 6, 85),
  L("labor", "Install new step flashing and counterflash", 8, 85),
  L("material", "Step flashing and sealant", 1, 240),
  L("material", "Lump-sum weather allowance", 1, 400),
];

addWO(nl04, NL, "South roof step flashing at Loft 1A", chicago("2026-04-02T08:20:00"), "invoiced", J.delia, "Opened WO-NL-04 after rain showed a stain at the south wall flashing.");
addQuote({
  quote_id: "Q-NL-04-v1",
  work_order_id: nl04,
  version: 1,
  submitted_at: chicago("2026-04-03T09:10:00"),
  submitted_by: J.jonah,
  status: "voided",
  scope_summary: "Replace south wall step flashing.",
  lines: roofV1,
});
addEvent("Q-NL-04-v1", nl04, "created", chicago("2026-04-03T09:10:00"), 1, J.jonah);
addEvent("Q-NL-04-v1", nl04, "notified", chicago("2026-04-03T09:11:00"), 1, J.jonah);
addEvent("Q-NL-04-v1", nl04, "voided", chicago("2026-04-03T09:18:00"), 1, J.jonah);
addQuote({
  quote_id: "Q-NL-04-v2",
  work_order_id: nl04,
  version: 2,
  submitted_at: chicago("2026-04-03T09:22:00"),
  submitted_by: J.jonah,
  status: "rejected",
  scope_summary: "Replace south wall step flashing.",
  extraText: "Ria, please see the attached quote Q-NL-04-v1 for the south wall flashing.",
  lines: roofV2,
});
addEvent("Q-NL-04-v2", nl04, "created", chicago("2026-04-03T09:22:00"), 1, J.jonah);
addEvent("Q-NL-04-v2", nl04, "notified", chicago("2026-04-03T09:23:00"), 3, J.jonah);
addEvent("Q-NL-04-v2", nl04, "notified", chicago("2026-04-03T09:31:00"), 3, J.jonah);
addEvent("Q-NL-04-v2", nl04, "notified", chicago("2026-04-03T09:44:00"), 3, J.jonah);
addQuote({
  quote_id: "Q-NL-04-v3",
  work_order_id: nl04,
  version: 3,
  submitted_at: chicago("2026-04-14T09:20:00"),
  submitted_by: J.jonah,
  status: "submitted",
  scope_summary: "Replace south wall step flashing.",
  extraText: "Weather allowance removed. Added a plywood patch at the wet corner Cal found.",
  lines: [
    L("labor", "Remove damaged step flashing at south wall", 12, 85),
    L("labor", "Install new step flashing and counterflash", 14, 85),
    L("material", "Step flashing and sealant", 1, 240),
    L("material", "Plywood patch at wet corner", 1, 190),
  ],
});
addEvent("Q-NL-04-v3", nl04, "created", chicago("2026-04-14T09:20:00"), 1, J.jonah);
addEvent("Q-NL-04-v3", nl04, "notified", chicago("2026-04-14T09:21:00"), 1, J.jonah);
const recNl04Reject = msg(
  "client_message",
  J.ria,
  chicago("2026-04-03T12:05:00"),
  nl04,
  "Stop. I got three copies and two quote numbers. I am not approving this. Send one packet.",
);
addCard({
  card_id: "card.nl04.reject.v2",
  record_id: recNl04Reject.record_id,
  quote: "I got three copies and two quote numbers. I am not approving this. Send one packet.",
  mode: "gives_reason",
  topic: "approval",
  facets: ["approval.status", "client_rule.submission"],
  scope: `job:${nl04}`,
  decided_at: recNl04Reject.source_recorded_at,
  effective: recNl04Reject.source_recorded_at,
  decided_by: J.ria,
});
msg("internal_note", J.jonah, chicago("2026-04-03T09:19:00"), nl04, "Voided v1 because the PDF header still showed last year's logo. Recreating immediately.");
msg("internal_note", J.mira, chicago("2026-04-03T09:40:00"), nl04, "Jonah re-notified Ria twice more after she did not reply in ten minutes.");
addInvoice({
  invoice_id: "INV-NL-04",
  work_order_id: nl04,
  quote_id: "Q-NL-04-v2",
  quote_version: 2,
  issued_at: chicago("2026-05-04T10:30:00"),
  status: "disputed",
  author: J.jonah,
  lines: roofV2,
});
const recNl04Dispute = msg("client_message", J.ria, chicago("2026-05-06T08:02:00"), nl04, "This bill is not what I approved. I never signed the flashing packet.");
addCard({
  card_id: "card.nl04.dispute",
  record_id: recNl04Dispute.record_id,
  quote: "This bill is not what I approved. I never signed the flashing packet.",
  mode: "gives_reason",
  topic: "approval",
  facets: ["approval.status", "price.total"],
  scope: `job:${nl04}`,
  decided_at: recNl04Dispute.source_recorded_at,
  effective: recNl04Dispute.source_recorded_at,
  decided_by: J.ria,
});

const ocLight = [
  L("labor", "Site protect corridor floors", 2, 78),
  L("labor", "Replace corridor fixtures and test", 10, 78),
  L("material", "LED corridor fixtures, 14 each", 14, 42),
  L("material", "Drivers and whips", 1, 96),
];
const ocLightV2 = [
  L("labor", "Site protect corridor floors", 2, 78),
  L("labor", "Replace corridor fixtures and test", 10, 78),
  L("labor", "Add emergency heads at stair 2 after Helen asked for code heads in writing", 3, 78),
  L("material", "LED corridor fixtures, 14 each", 14, 42),
  L("material", "Drivers and whips", 1, 96),
  L("material", "Emergency heads, 2 each", 2, 88),
];
const ocLightV3 = [
  L("labor", "Site protect corridor floors", 2, 78),
  L("labor", "Replace corridor fixtures and test", 10, 78),
  L("labor", "Add emergency heads at stair 2 after Helen asked for code heads in writing", 3, 78),
  L("material", "LED corridor fixtures, 14 each", 14, 42),
  L("material", "Drivers and whips", 1, 96),
  L("material", "Emergency heads, 2 each", 2, 88),
];

addWO(oc01, OC, "Corridor lighting upgrade, west wing", chicago("2026-03-04T09:00:00"), "closed", J.delia, "Opened WO-OC-01: Oak Circle west corridor lights flicker and two lamps are dark.");
addQuote({
  quote_id: "Q-OC-01-v1",
  work_order_id: oc01,
  version: 1,
  submitted_at: chicago("2026-03-05T13:10:00"),
  submitted_by: J.jonah,
  status: "approved",
  scope_summary: "Protect floors, replace corridor fixtures, named drivers.",
  lines: ocLight,
});
addEvent("Q-OC-01-v1", oc01, "created", chicago("2026-03-05T13:10:00"), 1, J.jonah);
addEvent("Q-OC-01-v1", oc01, "notified", chicago("2026-03-05T13:11:00"), 1, J.jonah);
const recHelenV1 = msg(
  "client_message",
  J.helen,
  chicago("2026-03-06T16:40:00"),
  oc01,
  "Approved Q-OC-01-v1. Keep the four-line shape: protect, trade labor, named fixtures, named small material. Please continue to send quotes only to me, not to the board alias.",
);
addCard({
  card_id: "card.oc01.approve.v1",
  record_id: recHelenV1.record_id,
  quote: "Approved Q-OC-01-v1. Keep the four-line shape: protect, trade labor, named fixtures, named small material.",
  mode: "decides",
  topic: "approval",
  facets: ["approval.status", "scope.structure"],
  scope: `job:${oc01}`,
  decided_at: recHelenV1.source_recorded_at,
  effective: recHelenV1.source_recorded_at,
  decided_by: J.helen,
});
addCard({
  card_id: "card.oc.rule.helenonly",
  record_id: recHelenV1.record_id,
  quote: "Please continue to send quotes only to me, not to the board alias.",
  mode: "decides",
  topic: "client_rule",
  facets: ["client_rule.submission"],
  scope: `client:${OC}`,
  decided_at: recHelenV1.source_recorded_at,
  effective: recHelenV1.source_recorded_at,
  decided_by: J.helen,
});
const recHelenHeads = msg(
  "client_message",
  J.helen,
  chicago("2026-03-20T14:25:00"),
  oc01,
  "Our insurer flagged stair 2. Please add code emergency heads there and price them on their own lines, labor and material, so the board can see them.",
);
addCard({
  card_id: "card.oc01.ask.heads",
  record_id: recHelenHeads.record_id,
  quote: "Please add code emergency heads there and price them on their own lines, labor and material",
  mode: "decides",
  topic: "scope",
  facets: ["scope.lines"],
  scope: `job:${oc01}`,
  decided_at: recHelenHeads.source_recorded_at,
  effective: recHelenHeads.source_recorded_at,
  decided_by: J.helen,
});
addQuote({
  quote_id: "Q-OC-01-v2",
  work_order_id: oc01,
  version: 2,
  submitted_at: chicago("2026-03-23T11:00:00"),
  submitted_by: J.jonah,
  status: "approved",
  scope_summary: "Same lighting plus emergency heads Helen requested in writing.",
  extraText: "Added labor and material for emergency heads after Helen asked for code heads in writing.",
  lines: ocLightV2,
});
addEvent("Q-OC-01-v2", oc01, "created", chicago("2026-03-23T11:00:00"), 1, J.jonah);
addEvent("Q-OC-01-v2", oc01, "notified", chicago("2026-03-23T11:01:00"), 1, J.jonah);
const recHelenV2 = msg("client_message", J.helen, chicago("2026-03-24T09:12:00"), oc01, "Thank you for putting the emergency heads on their own lines. Approved v2.");
addCard({
  card_id: "card.oc01.approve.v2",
  record_id: recHelenV2.record_id,
  quote: "Thank you for putting the emergency heads on their own lines. Approved v2.",
  mode: "decides",
  topic: "approval",
  facets: ["approval.status", "scope.lines"],
  scope: `job:${oc01}`,
  decided_at: recHelenV2.source_recorded_at,
  effective: recHelenV2.source_recorded_at,
  decided_by: J.helen,
});
addEdge("card.oc01.approve.v1", "card.oc01.approve.v2", "REPLACES");
addQuote({
  quote_id: "Q-OC-01-v3",
  work_order_id: oc01,
  version: 3,
  submitted_at: chicago("2026-05-06T10:40:00"),
  submitted_by: J.jonah,
  status: "approved",
  scope_summary: "Restated for the closeout file; same lines as v2.",
  lines: ocLightV3,
});
addEvent("Q-OC-01-v3", oc01, "created", chicago("2026-05-06T10:40:00"), 1, J.jonah);
addEvent("Q-OC-01-v3", oc01, "notified", chicago("2026-05-06T10:41:00"), 1, J.jonah);
const recHelenV3 = msg("client_message", J.helen, chicago("2026-05-07T08:50:00"), oc01, "v3 is the same work we already finished; stamp it approved for the file.");
addCard({
  card_id: "card.oc01.approve.v3",
  record_id: recHelenV3.record_id,
  quote: "v3 is the same work we already finished; stamp it approved for the file.",
  mode: "decides",
  topic: "approval",
  facets: ["approval.status"],
  scope: `job:${oc01}`,
  decided_at: recHelenV3.source_recorded_at,
  effective: recHelenV3.source_recorded_at,
  decided_by: J.helen,
});
addEdge("card.oc01.approve.v2", "card.oc01.approve.v3", "SAME");
addInvoice({
  invoice_id: "INV-OC-01",
  work_order_id: oc01,
  quote_id: "Q-OC-01-v2",
  quote_version: 2,
  issued_at: chicago("2026-04-10T11:00:00"),
  status: "paid",
  author: J.jonah,
  lines: ocLightV2,
});
msg("field_note", J.cal, chicago("2026-03-09T15:00:00"), oc01, "West corridor lamps swapped. Stair 2 still has no emergency heads.");
msg("field_note", J.cal, chicago("2026-03-25T16:20:00"), oc01, "Emergency heads installed. Helen walked it with me.");

const recHelenAllowLump = msg(
  "client_message",
  J.helen,
  chicago("2026-05-15T10:00:00"),
  oc01,
  "Starting 1 June 2026 you may send Oak Circle mechanical work as a single lump-sum line if you also attach the backup sheet. Until then keep the four-line shape.",
);
addCard({
  card_id: "card.oc.structure.old",
  record_id: recHelenV1.record_id,
  quote: "Keep the four-line shape: protect, trade labor, named fixtures, named small material",
  mode: "decides",
  topic: "scope",
  facets: ["scope.structure"],
  scope: `client:${OC}`,
  decided_at: recHelenV1.source_recorded_at,
  effective: recHelenV1.source_recorded_at,
  decided_by: J.helen,
});
addCard({
  card_id: "card.oc.structure.new",
  record_id: recHelenAllowLump.record_id,
  quote: "Starting 1 June 2026 you may send Oak Circle mechanical work as a single lump-sum line if you also attach the backup sheet",
  mode: "decides",
  topic: "scope",
  facets: ["scope.structure", "approval.effective"],
  scope: `client:${OC}`,
  decided_at: recHelenAllowLump.source_recorded_at,
  effective: chicago("2026-06-01T00:00:00"),
  decided_by: J.helen,
});
addCard({
  card_id: "card.oc.structure.until",
  record_id: recHelenAllowLump.record_id,
  quote: "Until then keep the four-line shape",
  mode: "decides",
  topic: "scope",
  facets: ["scope.structure"],
  scope: `client:${OC}`,
  decided_at: recHelenAllowLump.source_recorded_at,
  effective: recHelenAllowLump.source_recorded_at,
  decided_by: J.helen,
});
addEdge("card.oc.structure.old", "card.oc.structure.new", "REPLACES");

const recHelenCcTomas = msg(
  "client_message",
  J.helen,
  chicago("2026-05-20T09:30:00"),
  oc02,
  "You may CC Tomas Frey from 20 May 2026. The earlier 'only me' instruction is withdrawn.",
);
addCard({
  card_id: "card.oc.rule.cc.tomas",
  record_id: recHelenCcTomas.record_id,
  quote: "You may CC Tomas Frey from 20 May 2026. The earlier 'only me' instruction is withdrawn.",
  mode: "decides",
  topic: "client_rule",
  facets: ["client_rule.submission"],
  scope: `client:${OC}`,
  decided_at: recHelenCcTomas.source_recorded_at,
  effective: recHelenCcTomas.source_recorded_at,
  decided_by: J.helen,
});
addEdge("card.oc.rule.helenonly", "card.oc.rule.cc.tomas", "REPLACES");

const ocPlumb = [
  L("labor", "Site protect unit 12 floors", 1, 82),
  L("labor", "Open stack and replace failed section", 7, 82),
  L("material", "Cast section and couplings", 1, 310),
  L("material", "Test balls and wrap", 1, 48),
];
const ocPlumbV2 = [
  L("labor", "Site protect unit 12 floors", 1, 82),
  L("labor", "Open stack and replace failed section", 7, 82),
  L("labor", "Camera the rest of the stack to name the next leak", 2, 82),
  L("material", "Cast section and couplings", 1, 310),
  L("material", "Test balls and wrap", 1, 48),
];

addWO(oc02, OC, "Unit 12 stack leak", chicago("2026-03-16T10:15:00"), "open", J.delia, "Opened WO-OC-02: Oak Circle unit 12 has a wet stack behind the kitchen.");
addQuote({
  quote_id: "Q-OC-02-v1",
  work_order_id: oc02,
  version: 1,
  submitted_at: chicago("2026-03-17T14:00:00"),
  submitted_by: J.jonah,
  status: "approved",
  scope_summary: "Protect, open stack, named cast section.",
  lines: ocPlumb,
});
addEvent("Q-OC-02-v1", oc02, "created", chicago("2026-03-17T14:00:00"), 1, J.jonah);
addEvent("Q-OC-02-v1", oc02, "notified", chicago("2026-03-17T14:01:00"), 1, J.jonah);
const recOc02Appr = msg("client_message", J.helen, chicago("2026-03-18T11:05:00"), oc02, "Approved. Please photograph the coupling orientation for my file.");
addCard({
  card_id: "card.oc02.approve.v1",
  record_id: recOc02Appr.record_id,
  quote: "Approved. Please photograph the coupling orientation for my file.",
  mode: "decides",
  topic: "approval",
  facets: ["approval.status"],
  scope: `job:${oc02}`,
  decided_at: recOc02Appr.source_recorded_at,
  effective: recOc02Appr.source_recorded_at,
  decided_by: J.helen,
});
addQuote({
  quote_id: "Q-OC-02-v2",
  work_order_id: oc02,
  version: 2,
  submitted_at: chicago("2026-04-09T09:05:00"),
  submitted_by: J.jonah,
  status: "submitted",
  scope_summary: "Protect, open stack, named cast section.",
  extraText: "Copying the board as well so everyone sees the camera add.",
  lines: ocPlumbV2,
});
addEvent("Q-OC-02-v2", oc02, "created", chicago("2026-04-09T09:05:00"), 1, J.jonah);
addEvent("Q-OC-02-v2", oc02, "notified", chicago("2026-04-09T09:06:00"), 4, J.jonah);
const recOc02Push = msg(
  "client_message",
  J.helen,
  chicago("2026-04-09T15:40:00"),
  oc02,
  "I asked that quotes come only to me. The board alias just received v2. Fix the routing before I read the numbers.",
);
addCard({
  card_id: "card.oc02.route.complaint",
  record_id: recOc02Push.record_id,
  quote: "I asked that quotes come only to me. The board alias just received v2.",
  mode: "gives_reason",
  topic: "client_rule",
  facets: ["client_rule.submission"],
  scope: `job:${oc02}`,
  decided_at: recOc02Push.source_recorded_at,
  effective: recOc02Push.source_recorded_at,
  decided_by: J.helen,
});
addQuote({
  quote_id: "Q-OC-02-v3",
  work_order_id: oc02,
  version: 3,
  submitted_at: chicago("2026-05-22T10:20:00"),
  submitted_by: J.jonah,
  status: "submitted",
  scope_summary: "Protect, open stack, named cast section, plus camera.",
  extraText: "Copying Tomas as Helen allowed on 20 May.",
  lines: ocPlumbV2,
});
addEvent("Q-OC-02-v3", oc02, "created", chicago("2026-05-22T10:20:00"), 1, J.jonah);
addEvent("Q-OC-02-v3", oc02, "notified", chicago("2026-05-22T10:21:00"), 2, J.jonah);
const recPromiseCamera = msg(
  "client_message",
  J.mira,
  chicago("2026-04-08T16:00:00"),
  oc02,
  "Helen, once the coupling is in we'll run a camera up the rest of the stack. Until we see it I can't tell you whether the next floor needs a section too.",
);
addCard({
  card_id: "card.oc02.promise.camera",
  record_id: recPromiseCamera.record_id,
  quote: "once the coupling is in we'll run a camera up the rest of the stack. Until we see it I can't tell you whether the next floor needs a section too",
  mode: "proposes",
  topic: "open_item",
  facets: ["open_item.inspection"],
  scope: `job:${oc02}`,
  decided_at: recPromiseCamera.source_recorded_at,
  effective: recPromiseCamera.source_recorded_at,
  decided_by: J.mira,
});
msg("field_note", J.nora, chicago("2026-03-19T14:30:00"), oc02, "Section replaced. Did not camera past the tee. Access was blocked by a washer.");
msg("internal_note", J.jonah, chicago("2026-05-22T10:10:00"), oc02, "Re-sending unit 12 today so Tomas has a copy.");

const ocHvac = [
  L("labor", "Site protect mechanical room", 1, 90),
  L("labor", "Replace loop pump and flanges", 6, 90),
  L("material", "Circulator pump", 1, 540),
  L("material", "Gaskets and flanges", 1, 86),
];
const ocHvacLump = [L("material", "Boiler loop pump and flanking valves replacement — lump sum", 1, 2200)];

addWO(oc03, OC, "Boiler loop pump replacement", chicago("2026-04-06T08:40:00"), "open", J.delia, "Opened WO-OC-03: Oak Circle boiler loop pump is noisy and dropping pressure.");
addQuote({
  quote_id: "Q-OC-03-v1",
  work_order_id: oc03,
  version: 1,
  submitted_at: chicago("2026-04-07T12:30:00"),
  submitted_by: J.jonah,
  status: "approved",
  scope_summary: "Protect, replace loop pump, named pump and flanges.",
  lines: ocHvac,
});
addEvent("Q-OC-03-v1", oc03, "created", chicago("2026-04-07T12:30:00"), 1, J.jonah);
addEvent("Q-OC-03-v1", oc03, "notified", chicago("2026-04-07T12:31:00"), 1, J.jonah);
const recOc03Appr = msg("client_message", J.helen, chicago("2026-04-08T09:44:00"), oc03, "Approved in the usual four-line shape. Please keep labor and material apart.");
addCard({
  card_id: "card.oc03.approve.v1",
  record_id: recOc03Appr.record_id,
  quote: "Approved in the usual four-line shape. Please keep labor and material apart.",
  mode: "decides",
  topic: "approval",
  facets: ["approval.status", "scope.structure"],
  scope: `job:${oc03}`,
  decided_at: recOc03Appr.source_recorded_at,
  effective: recOc03Appr.source_recorded_at,
  decided_by: J.helen,
});
addQuote({
  quote_id: "Q-OC-03-v2",
  work_order_id: oc03,
  version: 2,
  submitted_at: chicago("2026-05-18T11:15:00"),
  submitted_by: J.jonah,
  status: "submitted",
  scope_summary: "Protect, replace loop pump, named pump and flanges.",
  lines: ocHvacLump,
});
addEvent("Q-OC-03-v2", oc03, "created", chicago("2026-05-18T11:15:00"), 1, J.jonah);
addEvent("Q-OC-03-v2", oc03, "notified", chicago("2026-05-18T11:16:00"), 1, J.jonah);
const recOc03Promise = msg(
  "field_note",
  J.wes,
  chicago("2026-04-16T13:20:00"),
  oc03,
  "Talked with Helen in the boiler room. The flanking valves stay on the list until the pump is out and I can look at the seats. I'll confirm after the pull.",
);
addCard({
  card_id: "card.oc03.promise.valves",
  record_id: recOc03Promise.record_id,
  quote: "The flanking valves stay on the list until the pump is out and I can look at the seats",
  mode: "proposes",
  topic: "open_item",
  facets: ["open_item.inspection"],
  scope: `job:${oc03}`,
  decided_at: recOc03Promise.source_recorded_at,
  effective: recOc03Promise.source_recorded_at,
  decided_by: J.wes,
});
addQuote({
  quote_id: "Q-OC-03-v3",
  work_order_id: oc03,
  version: 3,
  submitted_at: chicago("2026-06-04T09:50:00"),
  submitted_by: J.jonah,
  status: "submitted",
  scope_summary: "Mechanical lump sum with backup sheet attached, per Helen's 1 June instruction.",
  extraText: "Sent as one lump-sum line per Helen's 15 May note; the backup sheet with the same hours and parts as v1 is attached.",
  lines: [L("material", "Boiler loop pump replacement — lump sum, see backup sheet", 1, 1256)],
});
addEvent("Q-OC-03-v3", oc03, "created", chicago("2026-06-04T09:50:00"), 1, J.jonah);
addEvent("Q-OC-03-v3", oc03, "notified", chicago("2026-06-04T09:51:00"), 1, J.jonah);
addInvoice({
  invoice_id: "INV-OC-03",
  work_order_id: oc03,
  quote_id: "Q-OC-03-v2",
  quote_version: 2,
  issued_at: chicago("2026-05-28T14:00:00"),
  status: "draft",
  author: J.jonah,
  lines: ocHvacLump,
});
msg("field_note", J.wes, chicago("2026-04-09T15:10:00"), oc03, "Pump noisy. Did not pull it yet. Isolation valves not inspected.");

const ocDry = [
  L("labor", "Site protect stair 3", 2, 74),
  L("labor", "Cut and replace wet drywall, texture to match", 9, 74),
  L("material", "Drywall, tape, and texture", 1, 132),
  L("material", "Paint to match stair 3", 1, 68),
];

addWO(oc04, OC, "Common stair drywall after leak", chicago("2026-04-20T09:20:00"), "closed", J.delia, "Opened WO-OC-04: Oak Circle stair 3 drywall is stained from a supply leak.");
// Closed promise (decoy for P1): the result is recorded and the next quote reflects it.
const oc04FramingPromise = msg("client_message", J.mira, chicago("2026-04-20T10:30:00"), oc04, "Helen, Cal will cut a small inspection hole at stair 3 this afternoon. After we look behind the stained board we can tell you if any framing got wet, and the quote will say so.");
addCard({
  card_id: "card.oc04Framing.promise",
  record_id: oc04FramingPromise.record_id,
  quote: "After we look behind the stained board we can tell you if any framing got wet",
  mode: "proposes",
  topic: "open_item",
  facets: ["open_item.inspection"],
  scope: `job:${oc04}`,
  decided_at: oc04FramingPromise.source_recorded_at,
  effective: oc04FramingPromise.source_recorded_at,
  decided_by: J.mira,
});
const oc04FramingResult = msg("field_note", J.cal, chicago("2026-04-20T15:45:00"), oc04, "Inspection hole at stair 3: studs and bottom plate are dry. Drywall only, no framing work.");
addCard({
  card_id: "card.oc04Framing.result",
  record_id: oc04FramingResult.record_id,
  quote: "studs and bottom plate are dry. Drywall only, no framing work.",
  mode: "gives_reason",
  topic: "open_item",
  facets: ["open_item.inspection", "scope.lines"],
  scope: `job:${oc04}`,
  decided_at: oc04FramingResult.source_recorded_at,
  effective: oc04FramingResult.source_recorded_at,
  decided_by: J.cal,
});
addEdge("card.oc04Framing.promise", "card.oc04Framing.result", "REPLACES");
addQuote({
  quote_id: "Q-OC-04-v1",
  work_order_id: oc04,
  version: 1,
  submitted_at: chicago("2026-04-21T10:30:00"),
  submitted_by: J.jonah,
  status: "approved",
  scope_summary: "Protect, replace wet drywall, named material.",
  extraText: "Cal's inspection hole on 20 April showed dry studs, so no framing work is included.",
  lines: ocDry,
});
addEvent("Q-OC-04-v1", oc04, "created", chicago("2026-04-21T10:30:00"), 1, J.jonah);
addEvent("Q-OC-04-v1", oc04, "notified", chicago("2026-04-21T10:31:00"), 1, J.jonah);
const recOc04Late = msg(
  "internal_note",
  J.jonah,
  chicago("2026-04-27T08:40:00"),
  oc04,
  "Catching up from last week's call: Helen approved Q-OC-04-v1 on 22 April at 14:10. She said do not invoice until the texture matches. Writing it now because I was on the Tallow Creek inspection circuit.",
);
addCard({
  card_id: "card.oc04.approve.late",
  record_id: recOc04Late.record_id,
  quote: "Helen approved Q-OC-04-v1 on 22 April at 14:10",
  mode: "decides",
  topic: "approval",
  facets: ["approval.status"],
  scope: `job:${oc04}`,
  decided_at: chicago("2026-04-22T14:10:00"),
  effective: chicago("2026-04-22T14:10:00"),
  decided_by: J.helen,
});
addInvoice({
  invoice_id: "INV-OC-04",
  work_order_id: oc04,
  quote_id: "Q-OC-04-v1",
  quote_version: 1,
  issued_at: chicago("2026-05-11T09:15:00"),
  status: "paid",
  author: J.jonah,
  lines: ocDry,
});
msg("field_note", J.cal, chicago("2026-04-23T16:00:00"), oc04, "Drywall replaced. Texture drying. Paint tomorrow.");
msg("client_message", J.helen, chicago("2026-05-12T10:18:00"), oc04, "Invoice matches the approved stair work. Paid.");

const pwElec = [
  L("labor", "Trace and label shop panel circuits", 6, 90),
  L("labor", "Print and apply directory", 2, 90),
  L("material", "Directory card and labels", 1, 42),
  L("material", "Marker and sleeves", 1, 18),
];

addWO(pw01, PW, "Shop panel labeling", chicago("2026-03-05T08:50:00"), "closed", J.delia, "Opened WO-PW-01: Pike Water Commons shop panel has no directory.");
addQuote({
  quote_id: "Q-PW-01-v1",
  work_order_id: pw01,
  version: 1,
  submitted_at: chicago("2026-03-06T11:20:00"),
  submitted_by: J.jonah,
  status: "approved",
  scope_summary: "Trace, label, named directory material.",
  lines: pwElec,
});
addEvent("Q-PW-01-v1", pw01, "created", chicago("2026-03-06T11:20:00"), 1, J.jonah);
addEvent("Q-PW-01-v1", pw01, "notified", chicago("2026-03-06T11:21:00"), 1, J.jonah);
const recOttoLate = msg(
  "internal_note",
  J.jonah,
  chicago("2026-03-23T09:05:00"),
  pw01,
  "Otto approved the shop labeling quote on a 19 March call at 10:45. He asked us not to ping him for ten business days after a send. Logging the approval now.",
);
addCard({
  card_id: "card.pw01.approve.late",
  record_id: recOttoLate.record_id,
  quote: "Otto approved the shop labeling quote on a 19 March call at 10:45",
  mode: "decides",
  topic: "approval",
  facets: ["approval.status"],
  scope: `job:${pw01}`,
  decided_at: chicago("2026-03-19T10:45:00"),
  effective: chicago("2026-03-19T10:45:00"),
  decided_by: J.otto,
});
const recOttoRule = msg(
  "client_message",
  J.otto,
  chicago("2026-03-09T16:10:00"),
  pw01,
  "Do not send reminder emails for ten business days after a quote. I move slowly and I will answer.",
);
addCard({
  card_id: "card.pw.rule.noping",
  record_id: recOttoRule.record_id,
  quote: "Do not send reminder emails for ten business days after a quote",
  mode: "decides",
  topic: "client_rule",
  facets: ["client_rule.submission"],
  scope: `client:${PW}`,
  decided_at: recOttoRule.source_recorded_at,
  effective: recOttoRule.source_recorded_at,
  decided_by: J.otto,
});
addInvoice({
  invoice_id: "INV-PW-01",
  work_order_id: pw01,
  quote_id: "Q-PW-01-v1",
  quote_version: 1,
  issued_at: chicago("2026-04-01T09:00:00"),
  status: "paid",
  author: J.jonah,
  lines: pwElec,
});
msg("field_note", J.cal, chicago("2026-03-10T15:40:00"), pw01, "Traced 18 circuits. Directory printed.");
msg("internal_note", J.mira, chicago("2026-03-06T10:50:00"), pw01, "Used the Pike Water split: hours first, then tiny named material.");

const pwDrainScope = "Basement floor drain odor. Cause still not identified.";
const pwDrain1 = [
  L("labor", "Snake floor drain and run water test", 3, 86),
  L("labor", "Need to determine the cause of the odor", 2, 86),
  L("material", "Snake blades and deodorizer", 1, 36),
];
const pwDrain2 = [
  L("labor", "Snake floor drain and run water test", 3, 86),
  L("labor", "Need to determine the cause of the odor", 4, 86),
  L("material", "Snake blades and deodorizer", 1, 36),
];
const pwDrain3 = [
  L("labor", "Snake floor drain and run water test", 3, 86),
  L("labor", "Need to determine the cause of the odor", 4, 86),
  L("labor", "Camera if we later know we need it", 2, 86),
  L("material", "Snake blades and deodorizer", 1, 36),
];
const pwDrain4 = [
  L("labor", "Snake floor drain and run water test", 3, 86),
  L("labor", "Need to determine the cause of the odor", 5, 86),
  L("labor", "Camera if we later know we need it", 2, 86),
  L("material", "Snake blades and deodorizer", 1, 36),
  L("material", "Trap if that turns out to be missing", 1, 54),
];

addWO(pw02, PW, "Basement floor drain odor", chicago("2026-03-22T09:10:00"), "open", J.delia, "Opened WO-PW-02: Pike Water basement drain odor after a wet week.");
addQuote({
  quote_id: "Q-PW-02-v1",
  work_order_id: pw02,
  version: 1,
  submitted_at: chicago("2026-03-23T13:40:00"),
  submitted_by: J.jonah,
  status: "approved",
  scope_summary: pwDrainScope,
  lines: pwDrain1,
});
addEvent("Q-PW-02-v1", pw02, "created", chicago("2026-03-23T13:40:00"), 1, J.jonah);
addEvent("Q-PW-02-v1", pw02, "notified", chicago("2026-03-23T13:41:00"), 1, J.jonah);
const recPw02Appr = msg("client_message", J.otto, chicago("2026-04-06T17:05:00"), pw02, "Snake it. I will wait on a later note for the cause.");
addCard({
  card_id: "card.pw02.approve.v1",
  record_id: recPw02Appr.record_id,
  quote: "Snake it. I will wait on a later note for the cause.",
  mode: "decides",
  topic: "approval",
  facets: ["approval.status", "open_item.inspection"],
  scope: `job:${pw02}`,
  decided_at: recPw02Appr.source_recorded_at,
  effective: recPw02Appr.source_recorded_at,
  decided_by: J.otto,
});
const recPw02Promise = msg(
  "internal_note",
  J.jonah,
  chicago("2026-04-07T11:00:00"),
  pw02,
  "Otto called. Agreed we'd come back with a camera after the next good rain and confirm then if there is a trap on that drain at all.",
);
addCard({
  card_id: "card.pw02.promise.trap",
  record_id: recPw02Promise.record_id,
  quote: "we'd come back with a camera after the next good rain and confirm then if there is a trap on that drain at all",
  mode: "proposes",
  topic: "open_item",
  facets: ["open_item.inspection"],
  scope: `job:${pw02}`,
  decided_at: recPw02Promise.source_recorded_at,
  effective: recPw02Promise.source_recorded_at,
  decided_by: J.jonah,
});
addQuote({
  quote_id: "Q-PW-02-v2",
  work_order_id: pw02,
  version: 2,
  submitted_at: chicago("2026-04-16T10:00:00"),
  submitted_by: J.jonah,
  status: "submitted",
  scope_summary: pwDrainScope,
  extraText: "We still need to determine the cause of the odor.",
  lines: pwDrain2,
});
addEvent("Q-PW-02-v2", pw02, "created", chicago("2026-04-16T10:00:00"), 1, J.jonah);
addEvent("Q-PW-02-v2", pw02, "notified", chicago("2026-04-16T10:01:00"), 1, J.jonah);
addEvent("Q-PW-02-v2", pw02, "notified", chicago("2026-04-17T10:01:00"), 1, J.jonah);
addQuote({
  quote_id: "Q-PW-02-v3",
  work_order_id: pw02,
  version: 3,
  submitted_at: chicago("2026-05-05T09:20:00"),
  submitted_by: J.jonah,
  status: "submitted",
  scope_summary: pwDrainScope,
  extraText: "We need to determine the cause of the odor. Added camera time in case we need it.",
  lines: pwDrain3,
});
addEvent("Q-PW-02-v3", pw02, "created", chicago("2026-05-05T09:20:00"), 1, J.jonah);
addEvent("Q-PW-02-v3", pw02, "notified", chicago("2026-05-05T09:21:00"), 1, J.jonah);
addQuote({
  quote_id: "Q-PW-02-v4",
  work_order_id: pw02,
  version: 4,
  submitted_at: chicago("2026-05-28T11:40:00"),
  submitted_by: J.jonah,
  status: "submitted",
  scope_summary: pwDrainScope,
  extraText: "Added a trap in case one turns out to be missing.",
  lines: pwDrain4,
});
addEvent("Q-PW-02-v4", pw02, "created", chicago("2026-05-28T11:40:00"), 1, J.jonah);
addEvent("Q-PW-02-v4", pw02, "notified", chicago("2026-05-28T11:41:00"), 1, J.jonah);
msg("field_note", J.nora, chicago("2026-04-08T15:50:00"), pw02, "Snaked 12 feet. Odor remains. No camera today.");
msg("field_note", J.nora, chicago("2026-05-04T16:05:00"), pw02, "Returned after rain. Same smell. Still have not determined the cause.");
msg("internal_note", J.delia, chicago("2026-04-17T09:50:00"), pw02, "Jonah, did Otto open drain v2 yet? Bump it so it stays on his list.");
const recOttoPing = msg("client_message", J.otto, chicago("2026-04-18T18:12:00"), pw02, "I asked you not to nudge me for ten business days. I have not read v2 yet.");
addCard({
  card_id: "card.pw02.ping",
  record_id: recOttoPing.record_id,
  quote: "I asked you not to nudge me for ten business days. I have not read v2 yet.",
  mode: "gives_reason",
  topic: "client_rule",
  facets: ["client_rule.submission"],
  scope: `job:${pw02}`,
  decided_at: recOttoPing.source_recorded_at,
  effective: recOttoPing.source_recorded_at,
  decided_by: J.otto,
});

const pwRoof = [
  L("labor", "Cut failed EPDM at office cricket", 4, 80),
  L("labor", "Patch and seam new EPDM", 6, 80),
  L("material", "EPDM patch kit", 1, 210),
  L("material", "Primer and seam tape", 1, 64),
];
const pwRoofV2 = [
  L("labor", "Cut failed EPDM at office cricket", 4, 80),
  L("labor", "Patch and seam new EPDM", 6, 80),
  L("material", "EPDM patch kit", 1, 210),
  L("material", "Primer and seam tape", 1, 64),
  L("labor", "Trip charge", 1, 175),
];

addWO(pw03, PW, "Office EPDM patch", chicago("2026-04-08T08:15:00"), "invoiced", J.delia, "Opened WO-PW-03: Pike Water office roof cricket is holding water.");
addQuote({
  quote_id: "Q-PW-03-v1",
  work_order_id: pw03,
  version: 1,
  submitted_at: chicago("2026-04-09T10:25:00"),
  submitted_by: J.jonah,
  status: "approved",
  scope_summary: "Cut, patch EPDM, named kit and tape.",
  lines: pwRoof,
});
addEvent("Q-PW-03-v1", pw03, "created", chicago("2026-04-09T10:25:00"), 1, J.jonah);
addEvent("Q-PW-03-v1", pw03, "notified", chicago("2026-04-09T10:26:00"), 1, J.jonah);
const recPw03Appr = msg("client_message", J.otto, chicago("2026-04-22T16:40:00"), pw03, "The EPDM patch is approved. No trip line.");
addCard({
  card_id: "card.pw03.approve.v1",
  record_id: recPw03Appr.record_id,
  quote: "The EPDM patch is approved. No trip line.",
  mode: "decides",
  topic: "approval",
  facets: ["approval.status", "scope.structure"],
  scope: `job:${pw03}`,
  decided_at: recPw03Appr.source_recorded_at,
  effective: recPw03Appr.source_recorded_at,
  decided_by: J.otto,
});
addQuote({
  quote_id: "Q-PW-03-v2",
  work_order_id: pw03,
  version: 2,
  submitted_at: chicago("2026-05-01T09:00:00"),
  submitted_by: J.jonah,
  status: "voided",
  scope_summary: "Cut, patch EPDM, named kit and tape.",
  lines: pwRoofV2,
});
addEvent("Q-PW-03-v2", pw03, "created", chicago("2026-05-01T09:00:00"), 1, J.jonah);
addEvent("Q-PW-03-v2", pw03, "voided", chicago("2026-05-01T09:12:00"), 1, J.jonah);
addInvoice({
  invoice_id: "INV-PW-03",
  work_order_id: pw03,
  quote_id: "Q-PW-03-v2",
  quote_version: 2,
  issued_at: chicago("2026-05-19T10:10:00"),
  status: "disputed",
  author: J.jonah,
  lines: pwRoofV2,
});
msg("field_note", J.wes, chicago("2026-04-24T15:30:00"), pw03, "Patch in. Cricket drains. Photos attached.");
msg("internal_note", J.delia, chicago("2026-05-01T09:11:00"), pw03, "Void EPDM v2, take the trip line off and leave v1 as it was.");
const recPw03Disp = msg("client_message", J.otto, chicago("2026-05-21T17:22:00"), pw03, "This invoice has a travel line I did not approve. Holding payment.");
addCard({
  card_id: "card.pw03.dispute",
  record_id: recPw03Disp.record_id,
  quote: "This invoice has a travel line I did not approve. Holding payment.",
  mode: "gives_reason",
  topic: "approval",
  facets: ["price.total", "scope.structure"],
  scope: `job:${pw03}`,
  decided_at: recPw03Disp.source_recorded_at,
  effective: recPw03Disp.source_recorded_at,
  decided_by: J.otto,
});

const pwRtu = [
  L("labor", "Recover charge and pull compressor", 7, 98),
  L("labor", "Set new compressor and evacuate", 8, 98),
  L("material", "Compressor for RTU-2", 1, 1840),
  L("material", "Drier and oil", 1, 122),
  L("material", "Freight, compressor delivery", 1, 95, "freight"),
];
const pwRtuFold = [
  L("material", "RTU-2 compressor replacement including labor", 1, 3600),
];

addWO(pw04, PW, "RTU-2 compressor", chicago("2026-04-15T08:00:00"), "open", J.delia, "Opened WO-PW-04: Pike Water RTU-2 locked out on compressor heat.");
addQuote({
  quote_id: "Q-PW-04-v1",
  work_order_id: pw04,
  version: 1,
  submitted_at: chicago("2026-04-16T14:20:00"),
  submitted_by: J.jonah,
  status: "approved",
  scope_summary: "Recover, replace compressor, named drier and oil.",
  lines: pwRtu,
});
addEvent("Q-PW-04-v1", pw04, "created", chicago("2026-04-16T14:20:00"), 1, J.jonah);
addEvent("Q-PW-04-v1", pw04, "notified", chicago("2026-04-16T14:21:00"), 1, J.jonah);
const recPw04Appr = msg("client_message", J.otto, chicago("2026-05-01T16:00:00"), pw04, "Compressor swap approved with labor and material shown apart.");
addCard({
  card_id: "card.pw04.approve.v1",
  record_id: recPw04Appr.record_id,
  quote: "Compressor swap approved with labor and material shown apart.",
  mode: "decides",
  topic: "approval",
  facets: ["approval.status", "scope.structure"],
  scope: `job:${pw04}`,
  decided_at: recPw04Appr.source_recorded_at,
  effective: recPw04Appr.source_recorded_at,
  decided_by: J.otto,
});
addQuote({
  quote_id: "Q-PW-04-v2",
  work_order_id: pw04,
  version: 2,
  submitted_at: chicago("2026-05-14T09:35:00"),
  submitted_by: J.jonah,
  status: "submitted",
  scope_summary: "Recover, replace compressor, named drier and oil.",
  lines: pwRtuFold,
});
addEvent("Q-PW-04-v2", pw04, "created", chicago("2026-05-14T09:35:00"), 1, J.jonah);
addEvent("Q-PW-04-v2", pw04, "notified", chicago("2026-05-14T09:36:00"), 1, J.jonah);
addInvoice({
  invoice_id: "INV-PW-04",
  work_order_id: pw04,
  quote_id: "Q-PW-04-v2",
  quote_version: 2,
  issued_at: chicago("2026-06-02T11:20:00"),
  status: "draft",
  author: J.jonah,
  lines: pwRtuFold,
});
msg("field_note", J.wes, chicago("2026-05-02T13:10:00"), pw04, "Compressor still in the unit. Waiting on the approved parts to land.");
msg("internal_note", J.mira, chicago("2026-05-13T16:45:00"), pw04, "Accounting asked for the compressor job as one line this time. Rebuilding v2 that way.");
msg("field_note", J.wes, chicago("2026-05-27T15:30:00"), pw04, "RTU-2 compressor set, evacuated and charged. Unit running, amps logged.");

const recPwLaborFuture = msg(
  "client_message",
  J.otto,
  chicago("2026-05-11T15:30:00"),
  pw01,
  "From 15 June 2026 Pike Water electrical labor is $96 per hour. Until that date keep the $90 rate already used on the shop panel job.",
);
addCard({
  card_id: "card.pw.labor.new",
  record_id: recPwLaborFuture.record_id,
  quote: "From 15 June 2026 Pike Water electrical labor is $96 per hour",
  mode: "decides",
  topic: "price",
  facets: ["price.labor", "approval.effective"],
  scope: `client:${PW}`,
  decided_at: recPwLaborFuture.source_recorded_at,
  effective: chicago("2026-06-15T00:00:00"),
  decided_by: J.otto,
});
addCard({
  card_id: "card.pw.labor.old",
  record_id: recPwLaborFuture.record_id,
  quote: "Until that date keep the $90 rate already used on the shop panel job",
  mode: "decides",
  topic: "price",
  facets: ["price.labor"],
  scope: `client:${PW}`,
  decided_at: recPwLaborFuture.source_recorded_at,
  effective: recPwLaborFuture.source_recorded_at,
  decided_by: J.otto,
});
addEdge("card.pw.labor.old", "card.pw.labor.new", "REPLACES");

const rmElec = [
  L("labor", "EL-labor: pull 3 new 20A receptacles in annex", 5, 88),
  L("labor", "EL-labor: make up and test", 2, 88),
  L("material", "EL-material: 12/2 and boxes", 1, 96),
  L("material", "EL-material: devices and plates", 3, 14),
];
const rmElecV2 = [
  L("labor", "EL-labor: pull 3 new 20A receptacles in annex", 5, 88),
  L("labor", "EL-labor: make up and test", 2, 88),
  L("material", "EL-material: 12/2 and boxes", 1, 96),
  L("material", "EL-material: devices and plates", 3, 14),
  L("labor", "EL-labor: homerun to annex subpanel", 3, 88),
];

addWO(rm01, RM, "Annex receptacle run", chicago("2026-03-09T09:30:00"), "open", J.delia, "Opened WO-RM-01: Red Mill Civic Trust annex needs three receptacles for exhibit lighting.");
const recYvPortal = msg(
  "client_message",
  J.yvette,
  chicago("2026-03-09T11:00:00"),
  rm01,
  "All Red Mill quotes go through the client portal. Do not email PDFs. Paul may read them but I am the signer.",
);
addCard({
  card_id: "card.rm.rule.portal",
  record_id: recYvPortal.record_id,
  quote: "All Red Mill quotes go through the client portal. Do not email PDFs.",
  mode: "decides",
  topic: "client_rule",
  facets: ["client_rule.submission"],
  scope: `client:${RM}`,
  decided_at: recYvPortal.source_recorded_at,
  effective: recYvPortal.source_recorded_at,
  decided_by: J.yvette,
});
// Closed promise (decoy for P1): the result is recorded and the next quote reflects it.
const rm01PanelPromise = msg("internal_note", J.jonah, chicago("2026-03-09T12:10:00"), rm01, "Yvette on the phone: before we price anything she wants to know if the annex subpanel has room for three circuits, or if it needs a homerun. Cal will confirm on his walk this afternoon.");
addCard({
  card_id: "card.rm01Panel.promise",
  record_id: rm01PanelPromise.record_id,
  quote: "she wants to know if the annex subpanel has room for three circuits, or if it needs a homerun",
  mode: "proposes",
  topic: "open_item",
  facets: ["open_item.inspection"],
  scope: `job:${rm01}`,
  decided_at: rm01PanelPromise.source_recorded_at,
  effective: rm01PanelPromise.source_recorded_at,
  decided_by: J.jonah,
});
const rm01PanelResult = msg("field_note", J.cal, chicago("2026-03-09T16:20:00"), rm01, "Annex subpanel has three open spaces. The three receptacles can land there, no homerun needed.");
addCard({
  card_id: "card.rm01Panel.result",
  record_id: rm01PanelResult.record_id,
  quote: "Annex subpanel has three open spaces. The three receptacles can land there, no homerun needed.",
  mode: "gives_reason",
  topic: "open_item",
  facets: ["open_item.inspection", "scope.lines"],
  scope: `job:${rm01}`,
  decided_at: rm01PanelResult.source_recorded_at,
  effective: rm01PanelResult.source_recorded_at,
  decided_by: J.cal,
});
addEdge("card.rm01Panel.promise", "card.rm01Panel.result", "REPLACES");
addQuote({
  quote_id: "Q-RM-01-v1",
  work_order_id: rm01,
  version: 1,
  submitted_at: chicago("2026-03-10T10:10:00"),
  submitted_by: J.jonah,
  status: "approved",
  scope_summary: "EL-labor then EL-material receptacle run.",
  extraText: "Uploaded to the client portal. Cal confirmed the annex subpanel has room, so no homerun is priced.",
  lines: rmElec,
});
addEvent("Q-RM-01-v1", rm01, "created", chicago("2026-03-10T10:10:00"), 1, J.jonah);
addEvent("Q-RM-01-v1", rm01, "notified", chicago("2026-03-10T10:11:00"), 2, J.jonah);
const recRm01Appr = msg("client_message", J.yvette, chicago("2026-03-11T09:20:00"), rm01, "Portal packet is complete. Annex receptacles approved.");
addCard({
  card_id: "card.rm01.approve.v1",
  record_id: recRm01Appr.record_id,
  quote: "Portal packet is complete. Annex receptacles approved.",
  mode: "decides",
  topic: "approval",
  facets: ["approval.status"],
  scope: `job:${rm01}`,
  decided_at: recRm01Appr.source_recorded_at,
  effective: recRm01Appr.source_recorded_at,
  decided_by: J.yvette,
});
addQuote({
  quote_id: "Q-RM-01-v2",
  work_order_id: rm01,
  version: 2,
  submitted_at: chicago("2026-04-13T08:50:00"),
  submitted_by: J.jonah,
  status: "submitted",
  scope_summary: "EL-labor then EL-material receptacle run.",
  extraText: "Yvette, emailing this one as a PDF since the portal will not load for me today.",
  lines: rmElecV2,
});
addEvent("Q-RM-01-v2", rm01, "created", chicago("2026-04-13T08:50:00"), 1, J.jonah);
addEvent("Q-RM-01-v2", rm01, "notified", chicago("2026-04-13T08:51:00"), 1, J.jonah);
const recRm01Email = msg(
  "client_message",
  J.yvette,
  chicago("2026-04-13T14:05:00"),
  rm01,
  "You emailed a PDF. That is not a submission. Put it in the portal or I will not open it.",
);
addCard({
  card_id: "card.rm01.email.refuse",
  record_id: recRm01Email.record_id,
  quote: "You emailed a PDF. That is not a submission. Put it in the portal or I will not open it.",
  mode: "gives_reason",
  topic: "client_rule",
  facets: ["client_rule.submission"],
  scope: `job:${rm01}`,
  decided_at: recRm01Email.source_recorded_at,
  effective: recRm01Email.source_recorded_at,
  decided_by: J.yvette,
});
msg("field_note", J.cal, chicago("2026-03-12T16:10:00"), rm01, "Three receptacles live. Extra homerun not pulled.");
msg("internal_note", J.jonah, chicago("2026-04-13T08:45:00"), rm01, "Portal would not load from my laptop, so I am emailing Yvette the annex PDF.");

const recYvRate = msg(
  "client_message",
  J.yvette,
  chicago("2026-05-12T10:15:00"),
  rm03,
  "From 1 June 2026 Red Mill mechanical labor is $96 per hour. Material prices already approved stay as they are. Until 1 June use the $88 labor on file.",
);
addCard({
  card_id: "card.rm.labor.new",
  record_id: recYvRate.record_id,
  quote: "From 1 June 2026 Red Mill mechanical labor is $96 per hour",
  mode: "decides",
  topic: "price",
  facets: ["price.labor", "approval.effective"],
  scope: `client:${RM}`,
  decided_at: recYvRate.source_recorded_at,
  effective: chicago("2026-06-01T00:00:00"),
  decided_by: J.yvette,
});
addCard({
  card_id: "card.rm.material.keep",
  record_id: recYvRate.record_id,
  quote: "Material prices already approved stay as they are",
  mode: "decides",
  topic: "price",
  facets: ["price.material"],
  scope: `client:${RM}`,
  decided_at: recYvRate.source_recorded_at,
  effective: recYvRate.source_recorded_at,
  decided_by: J.yvette,
});
addCard({
  card_id: "card.rm.labor.old",
  record_id: recYvRate.record_id,
  quote: "Until 1 June use the $88 labor on file",
  mode: "decides",
  topic: "price",
  facets: ["price.labor"],
  scope: `client:${RM}`,
  decided_at: recYvRate.source_recorded_at,
  effective: recYvRate.source_recorded_at,
  decided_by: J.yvette,
});
addEdge("card.rm.labor.old", "card.rm.labor.new", "REPLACES");

const rmPlumb1 = [
  L("labor", "PL-labor: rebuild restroom flush valve", 2, 84),
  L("material", "PL-material: flush valve kit", 1, 96),
];
const rmPlumb2 = [
  L("labor", "PL-labor: rebuild restroom flush valve", 2, 84),
  L("labor", "Need to determine the cause of the refill hiss", 3, 84),
  L("material", "PL-material: flush valve kit", 1, 96),
];
const rmPlumb3 = [
  L("labor", "PL-labor: rebuild restroom flush valve", 2, 84),
  L("labor", "Need to determine the cause of the refill hiss", 3, 84),
  L("material", "PL-material: flush valve kit", 1, 96),
  L("material", "PL-material: possible fill valve", 1, 42),
];

addWO(rm02, RM, "Restroom flush valve", chicago("2026-03-28T09:00:00"), "disputed", J.delia, "Opened WO-RM-02: Red Mill west restroom flush valve runs on.");
addQuote({
  quote_id: "Q-RM-02-v1",
  work_order_id: rm02,
  version: 1,
  submitted_at: chicago("2026-03-30T09:40:00"),
  submitted_by: J.jonah,
  status: "approved",
  scope_summary: "Rebuild flush valve, named kit.",
  extraText: "Uploaded to the client portal.",
  lines: rmPlumb1,
});
addEvent("Q-RM-02-v1", rm02, "created", chicago("2026-03-30T09:40:00"), 1, J.jonah);
addEvent("Q-RM-02-v1", rm02, "notified", chicago("2026-03-30T09:41:00"), 2, J.jonah);
const recRm02Appr = msg("client_message", J.yvette, chicago("2026-03-31T08:55:00"), rm02, "Flush valve rebuild approved in the portal.");
addCard({
  card_id: "card.rm02.approve.v1",
  record_id: recRm02Appr.record_id,
  quote: "Flush valve rebuild approved in the portal.",
  mode: "decides",
  topic: "approval",
  facets: ["approval.status"],
  scope: `job:${rm02}`,
  decided_at: recRm02Appr.source_recorded_at,
  effective: recRm02Appr.source_recorded_at,
  decided_by: J.yvette,
});
addQuote({
  quote_id: "Q-RM-02-v2",
  work_order_id: rm02,
  version: 2,
  submitted_at: chicago("2026-04-27T09:00:00"),
  submitted_by: J.jonah,
  status: "voided",
  scope_summary: "Rebuild flush valve, named kit. Need to determine the cause of the refill hiss.",
  lines: rmPlumb2,
});
addEvent("Q-RM-02-v2", rm02, "created", chicago("2026-04-27T09:00:00"), 1, J.jonah);
addEvent("Q-RM-02-v2", rm02, "notified", chicago("2026-04-27T09:01:00"), 2, J.jonah);
addEvent("Q-RM-02-v2", rm02, "voided", chicago("2026-04-27T09:07:00"), 2, J.jonah);
addQuote({
  quote_id: "Q-RM-02-v3",
  work_order_id: rm02,
  version: 3,
  submitted_at: chicago("2026-04-27T09:09:00"),
  submitted_by: J.jonah,
  status: "rejected",
  scope_summary: "Rebuild flush valve, named kit. Need to determine the cause of the refill hiss.",
  extraText: "Resending Q-RM-02-v2 for the west restroom flush valve.",
  lines: rmPlumb3,
});
addEvent("Q-RM-02-v3", rm02, "created", chicago("2026-04-27T09:09:00"), 1, J.jonah);
addEvent("Q-RM-02-v3", rm02, "notified", chicago("2026-04-27T09:10:00"), 3, J.jonah);
addEvent("Q-RM-02-v3", rm02, "notified", chicago("2026-04-27T09:18:00"), 3, J.jonah);
addEvent("Q-RM-02-v3", rm02, "notified", chicago("2026-04-27T09:27:00"), 3, J.jonah);
const recRm02Rej = msg(
  "client_message",
  J.yvette,
  chicago("2026-04-27T15:30:00"),
  rm02,
  "Rejected. The portal shows a voided number, the email shows another, and Paul was copied three times. I cannot tell what is live. Put one packet in the portal.",
);
addCard({
  card_id: "card.rm02.reject",
  record_id: recRm02Rej.record_id,
  quote: "Rejected. The portal shows a voided number, the email shows another, and Paul was copied three times.",
  mode: "gives_reason",
  topic: "approval",
  facets: ["approval.status", "client_rule.submission"],
  scope: `job:${rm02}`,
  decided_at: recRm02Rej.source_recorded_at,
  effective: recRm02Rej.source_recorded_at,
  decided_by: J.yvette,
});
addQuote({
  quote_id: "Q-RM-02-v4",
  work_order_id: rm02,
  version: 4,
  submitted_at: chicago("2026-05-08T10:00:00"),
  submitted_by: J.jonah,
  status: "submitted",
  scope_summary: "Rebuild flush valve, named kit. Need to determine the cause of the refill hiss.",
  extraText: "Uploaded to the client portal as one packet. We still need to determine the cause of the refill hiss.",
  lines: rmPlumb3,
});
addEvent("Q-RM-02-v4", rm02, "resubmitted", chicago("2026-05-08T10:00:00"), 2, J.jonah);
addEvent("Q-RM-02-v4", rm02, "notified", chicago("2026-05-08T10:01:00"), 2, J.jonah);
addInvoice({
  invoice_id: "INV-RM-02",
  work_order_id: rm02,
  quote_id: "Q-RM-02-v3",
  quote_version: 3,
  issued_at: chicago("2026-05-18T09:40:00"),
  status: "disputed",
  author: J.jonah,
  lines: rmPlumb3,
});
msg("field_note", J.nora, chicago("2026-04-01T14:20:00"), rm02, "Kit installed. Hiss remains. Cause not named.");
msg("field_note", J.nora, chicago("2026-05-07T15:00:00"), rm02, "Second listen. Still cannot say if it is the fill valve.");
msg("internal_note", J.jonah, chicago("2026-04-27T09:08:00"), rm02, "Voided v2 because I used the wrong portal form. Recreating under a new id immediately.");
msg("client_message", J.paul, chicago("2026-04-27T09:30:00"), rm02, "I now have three notices for the same restroom. I am not the signer.");

const rmAhu = [
  L("labor", "HV-labor: replace AHU belts and align", 3, 88),
  L("labor", "HV-labor: test and log amps", 1, 88),
  L("material", "HV-material: belt set", 1, 54),
  L("material", "HV-material: sheave bolts", 1, 12),
  L("labor", "Client portal packet and amp log upload", 1, 40, "management"),
];
const rmAhuV2 = [
  L("labor", "HV-labor: replace AHU belts and align", 3, 96),
  L("labor", "HV-labor: test and log amps", 1, 96),
  L("material", "HV-material: belt set", 1, 54),
  L("material", "HV-material: sheave bolts", 1, 12),
  L("labor", "Client portal packet and amp log upload", 1, 40, "management"),
];

addWO(rm03, RM, "Library AHU belts", chicago("2026-04-01T08:10:00"), "open", J.delia, "Opened WO-RM-03: Red Mill library AHU is squealing on start. Trust wants a second belt change before summer.");
addQuote({
  quote_id: "Q-RM-03-v1",
  work_order_id: rm03,
  version: 1,
  submitted_at: chicago("2026-04-02T09:25:00"),
  submitted_by: J.jonah,
  status: "approved",
  scope_summary: "HV-labor then HV-material belts.",
  extraText: "Uploaded to the client portal.",
  lines: rmAhu,
});
addEvent("Q-RM-03-v1", rm03, "created", chicago("2026-04-02T09:25:00"), 1, J.jonah);
addEvent("Q-RM-03-v1", rm03, "notified", chicago("2026-04-02T09:26:00"), 2, J.jonah);
const recRm03Appr = msg("client_message", J.yvette, chicago("2026-04-03T08:40:00"), rm03, "Belts approved as submitted through the portal.");
addCard({
  card_id: "card.rm03.approve.v1",
  record_id: recRm03Appr.record_id,
  quote: "Belts approved as submitted through the portal.",
  mode: "decides",
  topic: "approval",
  facets: ["approval.status", "price.labor", "price.material"],
  scope: `job:${rm03}`,
  decided_at: recRm03Appr.source_recorded_at,
  effective: recRm03Appr.source_recorded_at,
  decided_by: J.yvette,
});
addQuote({
  quote_id: "Q-RM-03-v2",
  work_order_id: rm03,
  version: 2,
  submitted_at: chicago("2026-06-03T10:05:00"),
  submitted_by: J.jonah,
  status: "approved",
  scope_summary: "Second seasonal belt change. HV-labor then HV-material belts.",
  extraText: "Uploaded to the client portal. Labor is at the $96 rate from 1 June; the belt set and bolts are the same prices as v1.",
  lines: rmAhuV2,
});
addEvent("Q-RM-03-v2", rm03, "created", chicago("2026-06-03T10:05:00"), 1, J.jonah);
addEvent("Q-RM-03-v2", rm03, "notified", chicago("2026-06-03T10:06:00"), 2, J.jonah);
const recRm03Appr2 = msg(
  "client_message",
  J.yvette,
  chicago("2026-06-04T09:10:00"),
  rm03,
  "Second belt change approved at the new labor rate. Material is the same kit I already approved.",
);
addCard({
  card_id: "card.rm03.approve.v2",
  record_id: recRm03Appr2.record_id,
  quote: "Second belt change approved at the new labor rate. Material is the same kit I already approved.",
  mode: "decides",
  topic: "approval",
  facets: ["approval.status", "price.labor", "price.material"],
  scope: `job:${rm03}`,
  decided_at: recRm03Appr2.source_recorded_at,
  effective: recRm03Appr2.source_recorded_at,
  decided_by: J.yvette,
});
// v2 is a second visit on the same work order; it does not replace the v1 approval that INV-RM-03 bills against.
addEdge("card.rm03.approve.v1", "card.rm03.approve.v2", "UNRELATED");
addInvoice({
  invoice_id: "INV-RM-03",
  work_order_id: rm03,
  quote_id: "Q-RM-03-v1",
  quote_version: 1,
  issued_at: chicago("2026-04-20T10:00:00"),
  status: "paid",
  author: J.jonah,
  lines: rmAhu,
});
msg("field_note", J.wes, chicago("2026-04-04T13:50:00"), rm03, "Belts on. Amp log in the job folder.");

const rmGal = [
  L("labor", "GN-labor: open gallery ceiling and dry area", 4, 84),
  L("labor", "GN-labor: patch supply nick and close", 5, 84),
  L("material", "GN-material: copper repair coupling", 1, 38),
  L("material", "GN-material: ceiling tile", 4, 16),
];
const rmGalTrip = [
  L("labor", "GN-labor: open gallery ceiling and dry area", 4, 84),
  L("labor", "GN-labor: patch supply nick and close", 5, 84),
  L("labor", "Mobilization / trip", 1, 225),
  L("labor", "GN-labor: north wall refinish", 4, 84),
  L("material", "GN-material: copper repair coupling", 1, 38),
  L("material", "GN-material: ceiling tile", 4, 16),
  L("material", "GN-material: paint, north wall", 1, 46),
];

addWO(rm04, RM, "Gallery ceiling leak", chicago("2026-04-18T08:45:00"), "open", J.delia, "Opened WO-RM-04: Red Mill gallery ceiling is wet above the north wall.");
addQuote({
  quote_id: "Q-RM-04-v1",
  work_order_id: rm04,
  version: 1,
  submitted_at: chicago("2026-04-20T11:00:00"),
  submitted_by: J.jonah,
  status: "approved",
  scope_summary: "Open ceiling, patch supply nick, named tiles.",
  extraText: "Uploaded to the client portal.",
  lines: rmGal,
});
addEvent("Q-RM-04-v1", rm04, "created", chicago("2026-04-20T11:00:00"), 1, J.jonah);
addEvent("Q-RM-04-v1", rm04, "notified", chicago("2026-04-20T11:01:00"), 2, J.jonah);
const recRm04Late = msg(
  "internal_note",
  J.jonah,
  chicago("2026-04-24T09:20:00"),
  rm04,
  "Yvette approved the gallery leak quote on the 21 April portal call at 15:00. Logging it two days later because I was in the field with Wes.",
);
addCard({
  card_id: "card.rm04.approve.late",
  record_id: recRm04Late.record_id,
  quote: "Yvette approved the gallery leak quote on the 21 April portal call at 15:00",
  mode: "decides",
  topic: "approval",
  facets: ["approval.status"],
  scope: `job:${rm04}`,
  decided_at: chicago("2026-04-21T15:00:00"),
  effective: chicago("2026-04-21T15:00:00"),
  decided_by: J.yvette,
});
const recRm04Promise = msg(
  "client_message",
  J.mira,
  chicago("2026-04-22T12:10:00"),
  rm04,
  "Yvette, once the ceiling has dried out we'll check the north wall paint and let you know if it needs a refinish.",
);
addCard({
  card_id: "card.rm04.promise.paint",
  record_id: recRm04Promise.record_id,
  quote: "once the ceiling has dried out we'll check the north wall paint and let you know if it needs a refinish",
  mode: "proposes",
  topic: "open_item",
  facets: ["open_item.inspection"],
  scope: `job:${rm04}`,
  decided_at: recRm04Promise.source_recorded_at,
  effective: recRm04Promise.source_recorded_at,
  decided_by: J.mira,
});
addQuote({
  quote_id: "Q-RM-04-v2",
  work_order_id: rm04,
  version: 2,
  submitted_at: chicago("2026-05-13T09:30:00"),
  submitted_by: J.jonah,
  status: "submitted",
  scope_summary: "Open ceiling, patch supply nick, named tiles.",
  extraText: "Uploaded to the client portal.",
  lines: rmGalTrip,
});
addEvent("Q-RM-04-v2", rm04, "created", chicago("2026-05-13T09:30:00"), 1, J.jonah);
addEvent("Q-RM-04-v2", rm04, "notified", chicago("2026-05-13T09:31:00"), 2, J.jonah);
addInvoice({
  invoice_id: "INV-RM-04",
  work_order_id: rm04,
  quote_id: "Q-RM-04-v2",
  quote_version: 2,
  issued_at: chicago("2026-06-08T10:45:00"),
  status: "draft",
  author: J.jonah,
  lines: rmGalTrip,
});
msg("field_note", J.wes, chicago("2026-04-22T16:40:00"), rm04, "Nick patched. Ceiling still damp. Did not judge the paint.");
msg("internal_note", J.mira, chicago("2026-05-12T14:00:00"), rm04, "Gallery v2: the trip line covers the truck run from the shop. I also put the north wall refinish on it.");

const recRmLaborPartial = msg(
  "client_message",
  J.yvette,
  chicago("2026-05-21T11:40:00"),
  rm04,
  "For gallery general repair only, labor is $90 per hour starting 21 May. Do not change the copper and tile material numbers.",
);
addCard({
  card_id: "card.rm04.labor.new",
  record_id: recRmLaborPartial.record_id,
  quote: "For gallery general repair only, labor is $90 per hour starting 21 May",
  mode: "decides",
  topic: "price",
  facets: ["price.labor"],
  scope: `job:${rm04}`,
  decided_at: recRmLaborPartial.source_recorded_at,
  effective: recRmLaborPartial.source_recorded_at,
  decided_by: J.yvette,
});
addCard({
  card_id: "card.rm04.material.keep",
  record_id: recRmLaborPartial.record_id,
  quote: "Do not change the copper and tile material numbers",
  mode: "decides",
  topic: "price",
  facets: ["price.material"],
  scope: `job:${rm04}`,
  decided_at: recRmLaborPartial.source_recorded_at,
  effective: recRmLaborPartial.source_recorded_at,
  decided_by: J.yvette,
});
addEdge("card.rm03.approve.v1", "card.rm04.labor.new", "UNRELATED");


// P5 incidents with no stated reason: each rejection says nothing about why, and the records
// hold several candidate causes at once. The gold answer lists them; it must not pick one.
// HERO CASE (demo opener): Heron Court roof drain, Pike Water. Three versions, three rejections,
// no reason ever stated. Competing causes: process noise on v1, price + silent scope growth on v2,
// labor-only rise on v3, a "scope the leader first" promise never closed, and reminders inside
// Otto's quiet period. Money at stake is explicit: unbilled stop-gap work and a held rebuild.
const heronV1 = [
  L("labor", "Remove cracked strainer and clamp ring", 2, 80),
  L("labor", "Reset drain body, flash and seal", 4, 80),
  L("material", "Cast drain strainer and clamp ring", 1, 185),
  L("material", "Flashing membrane and sealant", 1, 96),
];
const heronV2 = [
  L("labor", "Remove cracked strainer and clamp ring", 2, 80),
  L("labor", "Reset drain body, flash and seal", 4, 80),
  L("labor", "Replace leader to first cleanout", 6, 80),
  L("material", "Cast drain strainer and clamp ring", 1, 228),
  L("material", "Flashing membrane and sealant", 1, 96),
  L("material", "4-inch cast leader and couplings", 1, 342),
];
const heronV3 = [
  L("labor", "Remove cracked strainer and clamp ring", 2, 80),
  L("labor", "Reset drain body, flash and seal", 7, 80),
  L("labor", "Replace leader to first cleanout", 8, 80),
  L("material", "Cast drain strainer and clamp ring", 1, 228),
  L("material", "Flashing membrane and sealant", 1, 96),
  L("material", "4-inch cast leader and couplings", 1, 342),
];
const heronScope = "Rebuild the northeast roof drain at Heron Court.";
addWO(pw05, PW, "Heron Court roof drain rebuild", chicago("2026-04-27T08:30:00"), "open", J.delia, "Opened WO-PW-05: Pike Water Heron Court, the northeast roof drain backs up and water sheets over the parapet into the courtyard.");
msg("field_note", J.wes, chicago("2026-04-29T14:10:00"), pw05, "Heron Court: strainer on the northeast inner drain is cracked and the bowl is full of grit. Could not see past the first elbow in the leader.");
const heronPromise = msg(
  "client_message",
  J.mira,
  chicago("2026-04-30T10:20:00"),
  pw05,
  "Otto, before we commit to replacing the leader we want to run a scope down it to the first cleanout. We'll check that first and tell you what we find.",
);
addCard({
  card_id: "card.pw05.promise.scope",
  record_id: heronPromise.record_id,
  quote: "before we commit to replacing the leader we want to run a scope down it to the first cleanout. We'll check that first and tell you what we find",
  mode: "proposes",
  topic: "open_item",
  facets: ["open_item.inspection"],
  scope: `job:${pw05}`,
  decided_at: heronPromise.source_recorded_at,
  effective: heronPromise.source_recorded_at,
  decided_by: J.mira,
});
const heronE1 = addEvent("Q-PW-05-v1", pw05, "created", chicago("2026-05-04T09:02:00"), 1, J.jonah);
const heronE2 = addEvent("Q-PW-05-v1", pw05, "notified", chicago("2026-05-04T09:03:00"), 1, J.jonah);
const heronE3 = addEvent("Q-PW-05-v1", pw05, "voided", chicago("2026-05-04T09:08:00"), 1, J.jonah);
const heronVoid = msg("internal_note", J.jonah, chicago("2026-05-04T09:09:00"), pw05, "Voided Heron Court v1, the strainer line had the wrong bowl size. Re-sending the corrected PDF now.");
const heronQ1 = addQuote({
  quote_id: "Q-PW-05-v1",
  work_order_id: pw05,
  version: 1,
  submitted_at: chicago("2026-05-04T09:11:00"),
  submitted_by: J.jonah,
  status: "rejected",
  scope_summary: heronScope,
  extraText: "Otto, corrected copy attached: Q-PW-04-v2.",
  lines: heronV1,
});
const heronE4 = addEvent("Q-PW-05-v1", pw05, "resubmitted", chicago("2026-05-04T09:11:00"), 1, J.jonah);
const heronE5 = addEvent("Q-PW-05-v1", pw05, "notified", chicago("2026-05-04T09:12:00"), 1, J.jonah);
const heronE6 = addEvent("Q-PW-05-v1", pw05, "notified", chicago("2026-05-05T08:40:00"), 1, J.jonah);
const heronStopGap = msg(
  "field_note",
  J.wes,
  chicago("2026-05-06T16:15:00"),
  pw05,
  "Heron Court stop-gap: cleared the first elbow and set a temporary strainer cover so the parapet stops sheeting. 3 hours plus a $40 cover. Not on any quote.",
);
const heronR1 = msg("client_message", J.otto, chicago("2026-05-19T16:30:00"), pw05, "Not approving this one.");
addCard({
  card_id: "card.pw05.reject.v1",
  record_id: heronR1.record_id,
  quote: "Not approving this one.",
  mode: "decides",
  topic: "approval",
  facets: ["approval.status"],
  scope: `job:${pw05}`,
  decided_at: heronR1.source_recorded_at,
  effective: heronR1.source_recorded_at,
  decided_by: J.otto,
});
const heronAccess = msg("field_note", J.wes, chicago("2026-05-22T11:05:00"), pw05, "Went back to scope the Heron Court leader. Courtyard ladder access closed for an event, did not get the camera in.");
const heronQ2 = addQuote({
  quote_id: "Q-PW-05-v2",
  work_order_id: pw05,
  version: 2,
  submitted_at: chicago("2026-05-27T10:00:00"),
  submitted_by: J.jonah,
  status: "rejected",
  scope_summary: heronScope,
  lines: heronV2,
});
const heronE7 = addEvent("Q-PW-05-v2", pw05, "created", chicago("2026-05-27T10:00:00"), 1, J.jonah);
const heronE8 = addEvent("Q-PW-05-v2", pw05, "notified", chicago("2026-05-27T10:01:00"), 1, J.jonah);
const heronR2 = msg("client_message", J.otto, chicago("2026-06-10T17:45:00"), pw05, "Not this version either.");
addCard({
  card_id: "card.pw05.reject.v2",
  record_id: heronR2.record_id,
  quote: "Not this version either.",
  mode: "decides",
  topic: "approval",
  facets: ["approval.status"],
  scope: `job:${pw05}`,
  decided_at: heronR2.source_recorded_at,
  effective: heronR2.source_recorded_at,
  decided_by: J.otto,
});
addEdge("card.pw05.reject.v1", "card.pw05.reject.v2", "REPLACES");
const heronQ3 = addQuote({
  quote_id: "Q-PW-05-v3",
  work_order_id: pw05,
  version: 3,
  submitted_at: chicago("2026-06-15T09:30:00"),
  submitted_by: J.jonah,
  status: "rejected",
  scope_summary: heronScope,
  lines: heronV3,
});
const heronE9 = addEvent("Q-PW-05-v3", pw05, "created", chicago("2026-06-15T09:30:00"), 1, J.jonah);
const heronE10 = addEvent("Q-PW-05-v3", pw05, "notified", chicago("2026-06-15T09:31:00"), 1, J.jonah);
const heronE11 = addEvent("Q-PW-05-v3", pw05, "notified", chicago("2026-06-16T08:15:00"), 1, J.jonah);
const heronR3 = msg("client_message", J.otto, chicago("2026-06-24T16:50:00"), pw05, "Rejected.");
addCard({
  card_id: "card.pw05.reject.v3",
  record_id: heronR3.record_id,
  quote: "Rejected.",
  mode: "decides",
  topic: "approval",
  facets: ["approval.status"],
  scope: `job:${pw05}`,
  decided_at: heronR3.source_recorded_at,
  effective: heronR3.source_recorded_at,
  decided_by: J.otto,
});
addEdge("card.pw05.reject.v2", "card.pw05.reject.v3", "REPLACES");
const heronHeld = msg(
  "internal_note",
  J.delia,
  chicago("2026-06-25T17:10:00"),
  pw05,
  "Heron Court: Wes's stop-gap from 6 May ($280, 3 hours and the temporary cover) is still unbilled, and the rebuild, $2,026 on v3, is on hold until Otto signs something. Crew is off the job.",
);

const fanV1 = [
  L("labor", "Site protect unit 7 bath", 1, 78),
  L("labor", "Remove old fan, install new fan and test", 3, 78),
  L("material", "Bath exhaust fan, 110 CFM", 1, 148),
  L("material", "Duct clamp and foil tape", 1, 22),
];
const fanV2 = [
  L("labor", "Site protect unit 7 bath", 1, 78),
  L("labor", "Remove old fan, install new fan and test", 3, 78),
  L("material", "Bath exhaust fan, 110 CFM", 1, 212),
  L("material", "Duct clamp and foil tape", 1, 22),
];
addWO(oc05, OC, "Unit 7 bath exhaust fan", chicago("2026-05-26T09:40:00"), "open", J.delia, "Opened WO-OC-05: Oak Circle unit 7 bath fan is loud and barely pulls air.");
msg("field_note", J.nora, chicago("2026-06-03T13:30:00"), oc05, "Unit 7 fan motor is seized. Housing is fine size-wise for a 110 CFM unit.");
const oc05q1 = addQuote({
  quote_id: "Q-OC-05-v1",
  work_order_id: oc05,
  version: 1,
  submitted_at: chicago("2026-06-08T09:00:00"),
  submitted_by: J.jonah,
  status: "voided",
  scope_summary: "Protect, replace bath fan, named fan and small material.",
  lines: fanV1,
});
const oc05e1 = addEvent("Q-OC-05-v1", oc05, "created", chicago("2026-06-08T09:00:00"), 2, J.jonah);
const oc05e2 = addEvent("Q-OC-05-v1", oc05, "voided", chicago("2026-06-08T09:05:00"), 2, J.jonah);
const oc05q2 = addQuote({
  quote_id: "Q-OC-05-v2",
  work_order_id: oc05,
  version: 2,
  submitted_at: chicago("2026-06-08T09:07:00"),
  submitted_by: J.jonah,
  status: "rejected",
  scope_summary: "Protect, replace bath fan, named fan and small material.",
  lines: fanV2,
});
const oc05e3 = addEvent("Q-OC-05-v2", oc05, "created", chicago("2026-06-08T09:07:00"), 2, J.jonah);
const oc05e4 = addEvent("Q-OC-05-v2", oc05, "notified", chicago("2026-06-08T09:08:00"), 2, J.jonah);
const oc05e5 = addEvent("Q-OC-05-v2", oc05, "notified", chicago("2026-06-08T09:26:00"), 2, J.jonah);
const oc05e6 = addEvent("Q-OC-05-v2", oc05, "notified", chicago("2026-06-08T09:51:00"), 2, J.jonah);
const oc05Tomas = msg("client_message", J.tomas, chicago("2026-06-08T10:02:00"), oc05, "Three emails this morning for the unit 7 fan. Which one is the real one?");
const oc05Reject = msg("client_message", J.helen, chicago("2026-06-11T10:15:00"), oc05, "I can't approve this version. Please hold off until you hear from me.");
addCard({
  card_id: "card.oc05.reject",
  record_id: oc05Reject.record_id,
  quote: "I can't approve this version.",
  mode: "decides",
  topic: "approval",
  facets: ["approval.status"],
  scope: `job:${oc05}`,
  decided_at: oc05Reject.source_recorded_at,
  effective: oc05Reject.source_recorded_at,
  decided_by: J.helen,
});

msg("internal_note", J.delia, chicago("2026-03-02T08:00:00"), nl01, "Harbor & Wick week start. Tallow Creek jobs only this spring.");
msg("internal_note", J.delia, chicago("2026-06-26T16:40:00"), rm04, "Quarter close reminder: do not send invoices that do not match an approved version.");
msg("field_note", J.cal, chicago("2026-03-02T15:10:00"), nl01, "Van stocked for the loft panel. No extra findings.");
msg("field_note", J.nora, chicago("2026-06-25T14:20:00"), pw02, "Last look at the basement drain before summer. Smell is still there.");
msg("client_message", J.tomas, chicago("2026-05-22T11:00:00"), oc02, "Helen said I can be copied now. I have v3. I am not the signer.");
msg("client_message", J.paul, chicago("2026-03-11T10:00:00"), rm01, "I saw the portal packet. Yvette signs, not me.");
msg("internal_note", J.mira, chicago("2026-04-14T08:10:00"), nl04, "Cal found a soft corner on the flashing job, so v3 adds a plywood patch.");
msg("internal_note", J.jonah, chicago("2026-05-28T13:40:00"), oc03, "Starting the pump invoice from the latest quote in the folder.");
msg("internal_note", J.jonah, chicago("2026-06-02T08:50:00"), pw04, "RTU-2 is done. Drafting INV-PW-04 off the newest version.");
msg("internal_note", J.jonah, chicago("2026-06-08T09:00:00"), rm04, "Gallery work wrapped. Drafting INV-RM-04 from the last quote we sent.");
msg("field_note", J.cal, chicago("2026-04-14T16:00:00"), nl04, "Soft plywood at the wet corner. Cut a square. Flashing not closed.");
msg("field_note", J.wes, chicago("2026-05-14T12:00:00"), pw04, "RTU-2 still waiting. No compressor change performed.");
msg("field_note", J.nora, chicago("2026-05-13T11:20:00"), oc02, "Washer still blocking camera access on the stack.");
msg("client_message", J.ria, chicago("2026-04-14T12:40:00"), nl04, "I have v3. I have not said yes.");
msg("client_message", J.helen, chicago("2026-05-18T16:05:00"), oc03, "I have not approved a lump sum on the pump job.");
msg("client_message", J.otto, chicago("2026-05-14T17:00:00"), pw04, "I have not asked you to hide labor inside material.");
msg("client_message", J.yvette, chicago("2026-05-13T13:10:00"), rm04, "I have not seen a trip line in our file. Explain it or take it off.");

// --- Card completeness pass ---
// Every decision-bearing sentence in a client message or internal note gets a gold card, so card
// extraction can be scored for precision and recall. Records found by an exact, unique quote.
function recordWith(quote: string): RecordRow {
  const hits = records.filter((r) => r.text.includes(quote));
  if (hits.length !== 1) throw new Error(`quote matches ${hits.length} records: ${quote}`);
  return hits[0];
}
function cardOn(
  card_id: string,
  quote: string,
  mode: Card["mode"],
  topic: string,
  facets: string[],
  opts: { scope?: string; decided_by?: string } = {},
) {
  const rec = recordWith(quote);
  addCard({
    card_id,
    record_id: rec.record_id,
    quote,
    mode,
    topic,
    facets,
    scope: opts.scope ?? `job:${rec.thread_id}`,
    decided_at: rec.source_recorded_at,
    effective: rec.source_recorded_at,
    decided_by: opts.decided_by ?? rec.author,
  });
}
const noDecisionRecords: string[] = [];
function noDecision(quote: string) {
  noDecisionRecords.push(recordWith(quote).record_id);
}

// Client-side decisions and rules that sat inside messages already carded for something else.
cardOn("card.nl.rule.notrip", "Do not add trip fees.", "decides", "client_rule", ["scope.structure"], { scope: `client:${NL}` });
cardOn("card.oc02.rule.routing", "Fix the routing before I read the numbers.", "decides", "client_rule", ["client_rule.submission"]);
cardOn("card.oc04.rule.noinvoice", "She said do not invoice until the texture matches.", "mentions", "client_rule", ["price.total"], { decided_by: J.helen });
cardOn("card.pw01.mention.noping", "He asked us not to ping him for ten business days after a send.", "mentions", "client_rule", ["client_rule.submission"], { decided_by: J.otto });
cardOn("card.rm.rule.signer", "Paul may read them but I am the signer.", "decides", "approval", ["approval.status"], { scope: `client:${RM}` });
cardOn("card.rm02.rule.onepacket", "Put one packet in the portal.", "decides", "client_rule", ["client_rule.submission"]);
cardOn("card.oc05.hold", "Please hold off until you hear from me.", "decides", "approval", ["approval.status"]);
cardOn("card.nl02.mention.allowance", "Carrying it as an allowance for now.", "mentions", "price", ["price.material", "open_item.inspection"]);

// Client messages that were not carded at all.
cardOn("card.oc04.invoice.paid", "Invoice matches the approved stair work. Paid.", "decides", "approval", ["approval.status", "price.total"]);
cardOn("card.rm02.mention.notices", "I now have three notices for the same restroom.", "mentions", "approval", ["submission.process"]);
cardOn("card.oc05.mention.emails", "Three emails this morning for the unit 7 fan. Which one is the real one?", "mentions", "approval", ["submission.process"]);
cardOn("card.oc02.mention.tomas", "Helen said I can be copied now. I have v3. I am not the signer.", "mentions", "client_rule", ["client_rule.submission"]);
cardOn("card.rm01.mention.signer", "I saw the portal packet. Yvette signs, not me.", "mentions", "approval", ["approval.status"]);
cardOn("card.nl04.mention.notyes", "I have v3. I have not said yes.", "mentions", "approval", ["approval.status"]);
cardOn("card.oc03.mention.nolump", "I have not approved a lump sum on the pump job.", "mentions", "approval", ["approval.status", "scope.structure"]);
cardOn("card.pw04.mention.nofold", "I have not asked you to hide labor inside material.", "mentions", "scope", ["scope.structure"]);
cardOn("card.rm04.trip.explain", "I have not seen a trip line in our file. Explain it or take it off.", "decides", "scope", ["scope.structure", "scope.lines"]);

// Internal notes: the contractor's own reasons and actions. A contractor cannot decide for the client,
// so these are gives_reason / proposes / mentions.
cardOn("card.nl.note.split", "Built v1 on the usual North Loft electrical split: two labor lines then named material.", "mentions", "scope", ["scope.structure"], { scope: `client:${NL}` });
cardOn("card.nl02.note.supplier", "Supplier sheet for the 40gal came in this morning.", "gives_reason", "price", ["price.material"]);
cardOn("card.nl03.note.capacitor", "Wes thinks it might be the capacitor but he has not confirmed it.", "mentions", "open_item", ["open_item.inspection"]);
cardOn("card.nl04.note.void", "Voided v1 because the PDF header still showed last year's logo.", "gives_reason", "approval", ["submission.process"]);
cardOn("card.nl04.note.renotify", "Jonah re-notified Ria twice more after she did not reply in ten minutes.", "mentions", "approval", ["submission.process"]);
cardOn("card.pw.note.split", "Used the Pike Water split: hours first, then tiny named material.", "mentions", "scope", ["scope.structure"], { scope: `client:${PW}` });
cardOn("card.pw02.note.bump", "Bump it so it stays on his list.", "proposes", "client_rule", ["client_rule.submission"]);
cardOn("card.pw03.note.void", "Void EPDM v2, take the trip line off and leave v1 as it was.", "proposes", "scope", ["scope.lines", "scope.structure"]);
cardOn("card.pw04.note.accounting", "Accounting asked for the compressor job as one line this time.", "gives_reason", "scope", ["scope.structure"]);
cardOn("card.rm01.note.email", "Portal would not load from my laptop, so I am emailing Yvette the annex PDF.", "gives_reason", "client_rule", ["client_rule.submission"]);
cardOn("card.rm02.note.void", "Voided v2 because I used the wrong portal form.", "gives_reason", "approval", ["submission.process"]);
cardOn("card.rm04.note.v2lines", "Gallery v2: the trip line covers the truck run from the shop. I also put the north wall refinish on it.", "gives_reason", "price", ["price.total", "scope.lines"]);
cardOn("card.pw05.note.void", "Voided Heron Court v1, the strainer line had the wrong bowl size.", "gives_reason", "approval", ["submission.process"]);
cardOn("card.pw05.note.held", "is still unbilled, and the rebuild, $2,026 on v3, is on hold until Otto signs something", "mentions", "price", ["price.total"]);
cardOn("card.global.note.invoicematch", "do not send invoices that do not match an approved version", "mentions", "approval", ["price.total"], { scope: "global" });
cardOn("card.nl04.note.plywood", "Cal found a soft corner on the flashing job, so v3 adds a plywood patch.", "gives_reason", "scope", ["scope.lines", "price.material"]);
cardOn("card.oc03.note.invoice", "Starting the pump invoice from the latest quote in the folder.", "proposes", "price", ["price.total"]);
cardOn("card.pw04.note.invoice", "Drafting INV-PW-04 off the newest version.", "proposes", "price", ["price.total"]);
cardOn("card.rm04.note.invoice", "Drafting INV-RM-04 from the last quote we sent.", "proposes", "price", ["price.total"]);

// Client messages and internal notes that carry no decision, reason, promise or rule.
noDecision("Re-sending unit 12 today so Tomas has a copy.");
noDecision("Harbor & Wick week start. Tallow Creek jobs only this spring.");

function seatState(job: string, client: string, jobState: string, clientState: string) {
  return { [`job:${job}`]: jobState, [`client:${client}`]: clientState };
}

Q({
  question_id: "q-p1-nl02-send-v3",
  pattern: "P1",
  question: "Before I send v3 for the Loft 2B water heater, what will Ria push back on?",
  as_of: chicago("2026-04-07T10:00:00"),
  seats: [`job:${nl02}`, `client:${NL}`],
  expected_state: seatState(nl02, NL, "open_item_unclosed", "cap_in_force"),
  expected_current_card: "card.nl02.promise.tank",
  expected_in_effect_card: "card.nl02.promise.tank",
  expected_reasons: ["card.nl02.promise.tank", "not_recorded"],
  expected_flags: ["P1", "P2"],
  must_not_say: ["the closet inspection found that the expansion tank is required", "Ria approved v3"],
});
Q({
  question_id: "q-p1-nl02-tank-result",
  pattern: "P1",
  question: "Did we ever record whether the expansion tank at Loft 2B is needed?",
  as_of: chicago("2026-06-01T09:00:00"),
  seats: [`job:${nl02}`],
  expected_state: { [`job:${nl02}`]: "open_item_unclosed" },
  expected_current_card: "card.nl02.promise.tank",
  expected_in_effect_card: "card.nl02.promise.tank",
  expected_reasons: ["not_recorded"],
  expected_flags: ["P1"],
  must_not_say: ["the tank was confirmed required", "the tank was confirmed not required"],
});
Q({
  question_id: "q-p1-pw02-camera",
  pattern: "P1",
  question: "Before I send the latest basement drain quote to Otto, are we still waiting on something we promised?",
  as_of: chicago("2026-05-28T11:30:00"),
  seats: [`job:${pw02}`, `client:${PW}`],
  expected_state: seatState(pw02, PW, "open_item_unclosed", "quiet_rule_in_force"),
  expected_current_card: "card.pw02.promise.trap",
  expected_in_effect_card: "card.pw02.promise.trap",
  expected_reasons: ["card.pw02.promise.trap", "not_recorded"],
  expected_flags: ["P1", "P3"],
  must_not_say: ["the camera showed a missing trap"],
});
Q({
  question_id: "q-p1-pw02-trap",
  pattern: "P1",
  question: "Why is there trap material on the Pike Water drain quote?",
  as_of: chicago("2026-05-28T12:00:00"),
  seats: [`job:${pw02}`],
  expected_state: { [`job:${pw02}`]: "price_depends_on_open_item" },
  expected_current_card: "card.pw02.promise.trap",
  expected_in_effect_card: "card.pw02.promise.trap",
  expected_reasons: ["card.pw02.promise.trap", "not_recorded"],
  expected_flags: ["P1"],
  must_not_say: ["the trap was found missing"],
});
Q({
  question_id: "q-p1-oc03-valves",
  pattern: "P1",
  question: "Does the boiler pump quote still depend on an inspection we never closed?",
  as_of: chicago("2026-05-18T11:16:00"),
  seats: [`job:${oc03}`],
  expected_state: { [`job:${oc03}`]: "open_item_unclosed" },
  expected_current_card: "card.oc03.promise.valves",
  expected_in_effect_card: "card.oc03.promise.valves",
  expected_reasons: ["card.oc03.promise.valves", "not_recorded"],
  expected_flags: ["P1", "P6"],
  must_not_say: ["the flanking valves were confirmed failed"],
});
Q({
  question_id: "q-p1-oc02-camera",
  pattern: "P1",
  question: "Can I treat the unit 12 stack camera hours as settled work?",
  as_of: chicago("2026-05-22T10:00:00"),
  seats: [`job:${oc02}`],
  expected_state: { [`job:${oc02}`]: "open_item_unclosed" },
  expected_current_card: "card.oc02.promise.camera",
  expected_in_effect_card: "card.oc02.promise.camera",
  expected_reasons: ["card.oc02.promise.camera", "not_recorded"],
  expected_flags: ["P1"],
  must_not_say: ["the next floor section was found necessary"],
});
Q({
  question_id: "q-p1-rm04-paint",
  pattern: "P1",
  question: "Before I send gallery v2, did we close the paint look we promised Yvette?",
  as_of: chicago("2026-05-13T09:00:00"),
  seats: [`job:${rm04}`],
  expected_state: { [`job:${rm04}`]: "open_item_unclosed" },
  expected_current_card: "card.rm04.promise.paint",
  expected_in_effect_card: "card.rm04.promise.paint",
  expected_reasons: ["card.rm04.promise.paint", "not_recorded"],
  expected_flags: ["P1", "P6"],
  must_not_say: ["the north wall refinish was confirmed required"],
});
Q({
  question_id: "q-p1-nl03-cause",
  pattern: "P1",
  question: "The condenser quote still prices a capacitor. Do we have the inspection result that would justify it?",
  as_of: chicago("2026-05-12T09:30:00"),
  seats: [`job:${nl03}`],
  expected_state: { [`job:${nl03}`]: "open_item_unclosed" },
  expected_current_card: "card.nl03.approve.v1",
  expected_in_effect_card: "card.nl03.approve.v1",
  expected_reasons: ["not_recorded"],
  expected_flags: ["P1", "P3"],
  must_not_say: ["the capacitor was confirmed as the failed part"],
});

Q({
  question_id: "q-p2-nl02-heater-price",
  pattern: "P2",
  question: "Why did the Loft 2B heater material move from 620 to 790 between v2 and v3?",
  as_of: chicago("2026-04-07T10:20:00"),
  seats: [`job:${nl02}`],
  expected_state: { [`job:${nl02}`]: "unexplained_material_delta" },
  expected_current_card: "card.nl02.approve.v1",
  expected_in_effect_card: "card.nl02.approve.v1",
  expected_reasons: ["not_recorded"],
  expected_flags: ["P2"],
  must_not_say: ["Ria asked for a more expensive heater"],
});
Q({
  question_id: "q-p2-nl03-hours",
  pattern: "P2",
  question: "Condenser v4 is higher than what Ria approved in March. What changed, and will she see why?",
  as_of: chicago("2026-05-12T10:00:00"),
  seats: [`job:${nl03}`],
  expected_state: { [`job:${nl03}`]: "unexplained_labor_delta" },
  expected_current_card: "card.nl03.approve.v1",
  expected_in_effect_card: "card.nl03.approve.v1",
  expected_reasons: ["not_recorded"],
  expected_flags: ["P2", "P3"],
  must_not_say: ["each hour increase is tied to a named failed part"],
});
Q({
  question_id: "q-p2-pw02-hours",
  pattern: "P2",
  question: "Otto's drain quote hours went up again. What in the description accounts for that?",
  as_of: chicago("2026-05-05T09:30:00"),
  seats: [`job:${pw02}`],
  expected_state: { [`job:${pw02}`]: "unexplained_labor_delta" },
  expected_current_card: "card.pw02.approve.v1",
  expected_in_effect_card: "card.pw02.approve.v1",
  expected_reasons: ["not_recorded"],
  expected_flags: ["P2", "P3"],
  must_not_say: ["the extra hours are for a documented camera finding"],
});
Q({
  question_id: "q-p2-pw04-fold",
  pattern: "P2",
  question: "RTU-2 v2 is a different total with the same scope sentence. What changed?",
  as_of: chicago("2026-05-14T09:40:00"),
  seats: [`job:${pw04}`],
  expected_state: { [`job:${pw04}`]: "unexplained_restructure" },
  expected_current_card: "card.pw04.approve.v1",
  expected_in_effect_card: "card.pw04.approve.v1",
  expected_reasons: ["not_recorded"],
  expected_flags: ["P2", "P6"],
  must_not_say: ["Otto asked to hide labor in material"],
});
Q({
  question_id: "q-p2-rm01-homerun",
  pattern: "P2",
  question: "What changed between annex v1 and v2, and will Yvette see why?",
  as_of: chicago("2026-04-13T09:00:00"),
  seats: [`job:${rm01}`],
  expected_state: { [`job:${rm01}`]: "unexplained_labor_delta" },
  expected_current_card: "card.rm01.approve.v1",
  expected_in_effect_card: "card.rm01.approve.v1",
  expected_reasons: ["not_recorded"],
  expected_flags: ["P2", "P4"],
  must_not_say: ["Yvette requested the extra homerun"],
});
Q({
  question_id: "q-p2-oc03-lump-delta",
  pattern: "P2",
  question: "Pump v2 comes to $2,200. What will Helen see that she did not see in v1?",
  as_of: chicago("2026-05-18T11:20:00"),
  seats: [`job:${oc03}`],
  expected_state: { [`job:${oc03}`]: "unexplained_restructure" },
  expected_current_card: "card.oc03.approve.v1",
  expected_in_effect_card: "card.oc03.approve.v1",
  expected_reasons: ["not_recorded"],
  expected_flags: ["P2", "P6"],
  must_not_say: ["Helen asked for a lump sum on 18 May"],
});
Q({
  question_id: "q-p2-nl04-v3-hours",
  pattern: "P2",
  question: "Flashing v3 labor is much higher than v1 with almost the same scope sentence. What should I flag?",
  as_of: chicago("2026-04-14T09:25:00"),
  seats: [`job:${nl04}`],
  expected_state: { [`job:${nl04}`]: "unexplained_labor_delta" },
  expected_current_card: "card.nl04.reject.v2",
  expected_in_effect_card: "card.nl04.reject.v2",
  expected_reasons: ["not_recorded"],
  expected_flags: ["P2", "P4"],
  must_not_say: ["Ria approved the extra flashing hours"],
});
Q({
  question_id: "q-p2-rm04-trip-price",
  pattern: "P2",
  question: "Gallery v2 costs more than the v1 Yvette approved. What exactly changed?",
  as_of: chicago("2026-05-13T09:35:00"),
  seats: [`job:${rm04}`],
  expected_state: { [`job:${rm04}`]: "unexplained_new_line" },
  expected_current_card: "card.rm04.approve.late",
  expected_in_effect_card: "card.rm04.approve.late",
  expected_reasons: ["not_recorded"],
  expected_flags: ["P2", "P6"],
  must_not_say: ["Yvette approved a trip charge", "the paint look found the north wall needs a refinish"],
});

Q({
  question_id: "q-p3-nl03-progress",
  pattern: "P3",
  question: "Has the Loft 4C condenser cause actually progressed across the quote versions?",
  as_of: chicago("2026-05-12T11:00:00"),
  seats: [`job:${nl03}`],
  expected_state: { [`job:${nl03}`]: "no_progress_4_versions" },
  expected_current_card: "card.nl03.approve.v1",
  expected_in_effect_card: "card.nl03.approve.v1",
  expected_reasons: ["not_recorded"],
  expected_flags: ["P3"],
  must_not_say: ["the cause was identified as the capacitor"],
});
Q({
  question_id: "q-p3-nl03-v4",
  pattern: "P3",
  question: "Before I send condenser v4, what will look circular to Ria?",
  as_of: chicago("2026-05-12T09:40:00"),
  seats: [`job:${nl03}`],
  expected_state: { [`job:${nl03}`]: "no_progress" },
  expected_current_card: "card.nl03.approve.v1",
  expected_in_effect_card: "card.nl03.approve.v1",
  expected_reasons: ["not_recorded"],
  expected_flags: ["P3", "P1"],
  must_not_say: ["v4 records a finding"],
});
Q({
  question_id: "q-p3-pw02-progress",
  pattern: "P3",
  question: "Are we any closer to naming the basement drain odor than we were in March?",
  as_of: chicago("2026-05-28T12:30:00"),
  seats: [`job:${pw02}`],
  expected_state: { [`job:${pw02}`]: "no_progress_4_versions" },
  expected_current_card: "card.pw02.approve.v1",
  expected_in_effect_card: "card.pw02.approve.v1",
  expected_reasons: ["not_recorded"],
  expected_flags: ["P3", "P1"],
  must_not_say: ["v4 names the cause"],
});
Q({
  question_id: "q-p3-pw02-v3",
  pattern: "P3",
  question: "Drain v3 still says we need to determine the cause. Has any version recorded a finding?",
  as_of: chicago("2026-05-05T09:40:00"),
  seats: [`job:${pw02}`],
  expected_state: { [`job:${pw02}`]: "no_progress" },
  expected_current_card: "card.pw02.promise.trap",
  expected_in_effect_card: "card.pw02.promise.trap",
  expected_reasons: ["not_recorded"],
  expected_flags: ["P3"],
  must_not_say: ["the odor cause is the missing trap"],
});
Q({
  question_id: "q-p3-rm02-hiss",
  pattern: "P3",
  question: "The restroom quotes keep saying we need to determine the refill hiss. Did we ever write a finding?",
  as_of: chicago("2026-05-08T10:10:00"),
  seats: [`job:${rm02}`],
  expected_state: { [`job:${rm02}`]: "no_progress" },
  expected_current_card: "card.rm02.reject",
  expected_in_effect_card: "card.rm02.approve.v1",
  expected_reasons: ["not_recorded"],
  expected_flags: ["P3"],
  must_not_say: ["the fill valve was confirmed as the cause"],
});
Q({
  question_id: "q-p3-rm02-v4",
  pattern: "P3",
  question: "Before I portal-submit restroom v4, has the question of the hiss moved?",
  as_of: chicago("2026-05-08T09:50:00"),
  seats: [`job:${rm02}`],
  expected_state: { [`job:${rm02}`]: "no_progress" },
  expected_current_card: "card.rm02.reject",
  expected_in_effect_card: "card.rm02.approve.v1",
  expected_reasons: ["not_recorded"],
  expected_flags: ["P3", "P5"],
  must_not_say: ["v4 includes a diagnosed cause"],
});
Q({
  question_id: "q-p3-nl03-reread",
  pattern: "P3",
  question: "If Ria reads condenser v1 through v4 in order, what is still unanswered?",
  as_of: null,
  seats: [`job:${nl03}`],
  expected_state: { [`job:${nl03}`]: "no_progress" },
  expected_current_card: "card.nl03.approve.v1",
  expected_in_effect_card: "card.nl03.approve.v1",
  expected_reasons: ["not_recorded"],
  expected_flags: ["P3"],
  must_not_say: ["later versions identify the failed part"],
});
Q({
  question_id: "q-p3-pw02-reread",
  pattern: "P3",
  question: "Where are we on the Pike Water drain odor compared with the first quote?",
  as_of: null,
  seats: [`job:${pw02}`],
  expected_state: { [`job:${pw02}`]: "no_progress" },
  expected_current_card: "card.pw02.approve.v1",
  expected_in_effect_card: "card.pw02.approve.v1",
  expected_reasons: ["not_recorded"],
  expected_flags: ["P3"],
  must_not_say: ["the cause is now known"],
});

Q({
  question_id: "q-p4-oc02-board",
  pattern: "P4",
  question: "Before I leave unit 12 v2 as sent, did we break a standing Oak Circle rule?",
  as_of: chicago("2026-04-09T09:10:00"),
  seats: [`job:${oc02}`, `client:${OC}`],
  expected_state: seatState(oc02, OC, "rule_broken_helen_only", "helen_only_in_force"),
  expected_current_card: "card.oc.rule.helenonly",
  expected_in_effect_card: "card.oc.rule.helenonly",
  expected_reasons: ["card.oc.rule.helenonly"],
  expected_flags: ["P4"],
  must_not_say: ["Helen had already allowed CC to Tomas", "the board alias is an approved recipient"],
});
Q({
  question_id: "q-p4-oc02-after-withdraw",
  pattern: "P4",
  question: "Now that Tomas can be copied, is v3's CC still a rule break?",
  as_of: chicago("2026-05-22T10:25:00"),
  seats: [`client:${OC}`, `job:${oc02}`],
  expected_state: seatState(oc02, OC, "routing_ok_open_item", "helen_only_withdrawn"),
  expected_current_card: "card.oc.rule.cc.tomas",
  expected_in_effect_card: "card.oc.rule.cc.tomas",
  expected_reasons: ["card.oc.rule.cc.tomas"],
  expected_flags: ["P1"],
  must_not_say: ["the only-Helen rule is still in force on 22 May"],
});
Q({
  question_id: "q-p4-rm01-email",
  pattern: "P4",
  question: "Is annex v2 a valid Red Mill submission?",
  as_of: chicago("2026-04-13T09:00:00"),
  seats: [`job:${rm01}`, `client:${RM}`],
  expected_state: seatState(rm01, RM, "portal_rule_broken", "portal_in_force"),
  expected_current_card: "card.rm.rule.portal",
  expected_in_effect_card: "card.rm.rule.portal",
  expected_reasons: ["card.rm.rule.portal"],
  expected_flags: ["P4"],
  must_not_say: ["emailing Yvette counts as a portal submission"],
});
Q({
  question_id: "q-p4-rm01-portal-still",
  pattern: "P4",
  question: "Has Yvette withdrawn the client portal rule?",
  as_of: chicago("2026-06-10T09:00:00"),
  seats: [`client:${RM}`],
  expected_state: { [`client:${RM}`]: "portal_in_force" },
  expected_current_card: "card.rm.rule.portal",
  expected_in_effect_card: "card.rm.rule.portal",
  expected_reasons: ["card.rm.rule.portal"],
  expected_flags: [],
  must_not_say: ["the portal rule was withdrawn"],
});
Q({
  question_id: "q-p4-nl04-cap",
  pattern: "P4",
  question: "Flashing v3 is over $2500. Do I still need Ria's pre-note?",
  as_of: chicago("2026-04-14T09:22:00"),
  seats: [`client:${NL}`, `job:${nl04}`],
  expected_state: seatState(nl04, NL, "cap_applies", "cap_in_force"),
  expected_current_card: "card.nl.cap.inforce",
  expected_in_effect_card: "card.nl.cap.inforce",
  expected_reasons: ["card.nl.cap.inforce", "not_recorded"],
  expected_flags: ["P4"],
  must_not_say: ["the $2500 cap was already lifted in April"],
});
Q({
  question_id: "q-p4-nl-cap-june",
  pattern: "P4",
  question: "In June, do I still need the North Loft pre-note for totals over $2500?",
  as_of: chicago("2026-06-03T09:00:00"),
  seats: [`client:${NL}`],
  expected_state: { [`client:${NL}`]: "cap_withdrawn" },
  expected_current_card: "card.nl.cap.withdrawn",
  expected_in_effect_card: "card.nl.cap.withdrawn",
  expected_reasons: ["card.nl.cap.withdrawn"],
  expected_flags: [],
  must_not_say: ["the $2500 cap is still in force after 2 June"],
});
Q({
  question_id: "q-p4-pw02-ping",
  pattern: "P4",
  question: "Did we break Otto's quiet period when we notified him about drain v2 the next day?",
  as_of: chicago("2026-04-17T10:10:00"),
  seats: [`client:${PW}`, `job:${pw02}`],
  expected_state: seatState(pw02, PW, "quiet_rule_broken", "quiet_rule_in_force"),
  expected_current_card: "card.pw.rule.noping",
  expected_in_effect_card: "card.pw.rule.noping",
  expected_reasons: ["card.pw.rule.noping"],
  expected_flags: ["P4"],
  must_not_say: ["Otto likes daily reminders"],
});
Q({
  question_id: "q-p4-pw-quiet-still",
  pattern: "P4",
  question: "Is Otto's ten-business-day quiet rule still in force in June?",
  as_of: chicago("2026-06-10T09:00:00"),
  seats: [`client:${PW}`],
  expected_state: { [`client:${PW}`]: "quiet_rule_in_force" },
  expected_current_card: "card.pw.rule.noping",
  expected_in_effect_card: "card.pw.rule.noping",
  expected_reasons: ["card.pw.rule.noping"],
  expected_flags: [],
  must_not_say: ["Otto withdrew the quiet rule"],
});

Q({
  question_id: "q-p5-nl04-why",
  pattern: "P5",
  question: "Why did they reject the south flashing quote?",
  as_of: chicago("2026-04-03T13:00:00"),
  seats: [`job:${nl04}`],
  expected_state: { [`job:${nl04}`]: "rejected_process_unclear" },
  expected_current_card: "card.nl04.reject.v2",
  expected_in_effect_card: "card.nl04.reject.v2",
  expected_reasons: ["card.nl04.reject.v2"],
  expected_flags: ["P5"],
  must_not_say: ["the client rejected it because it was too expensive", "Ria said the price was the problem"],
});
Q({
  question_id: "q-p5-rm02-why",
  pattern: "P5",
  question: "Why did Yvette reject the flush valve follow-up?",
  as_of: chicago("2026-04-27T16:00:00"),
  seats: [`job:${rm02}`],
  expected_state: { [`job:${rm02}`]: "rejected_process_unclear" },
  expected_current_card: "card.rm02.reject",
  expected_in_effect_card: "card.rm02.approve.v1",
  expected_reasons: ["card.rm02.reject"],
  expected_flags: ["P5"],
  must_not_say: ["the client rejected it because it was too expensive", "Yvette said the kit cost too much"],
});
Q({
  question_id: "q-p5-nl04-void",
  pattern: "P5",
  question: "Walk me through what happened the morning we sent the flashing packet. Did any of it hurt us?",
  as_of: chicago("2026-04-03T12:30:00"),
  seats: [`job:${nl04}`],
  expected_state: { [`job:${nl04}`]: "process_noise" },
  expected_current_card: "card.nl04.reject.v2",
  expected_in_effect_card: "card.nl04.reject.v2",
  expected_reasons: ["card.nl04.reject.v2"],
  expected_flags: ["P5"],
  must_not_say: ["Ria complained about the dollar amount"],
});
Q({
  question_id: "q-p5-rm02-ids",
  pattern: "P5",
  question: "Did anything about how we sent the restroom quote contribute to the rejection?",
  as_of: chicago("2026-04-28T09:00:00"),
  seats: [`job:${rm02}`],
  expected_state: { [`job:${rm02}`]: "process_noise" },
  expected_current_card: "card.rm02.reject",
  expected_in_effect_card: "card.rm02.approve.v1",
  expected_reasons: ["card.rm02.reject"],
  expected_flags: ["P5"],
  must_not_say: ["price is the documented reason"],
});
Q({
  question_id: "q-p5-nl04-not-price",
  pattern: "P5",
  question: "Can I tell the estimator the flashing job lost on price?",
  as_of: chicago("2026-04-04T10:00:00"),
  seats: [`job:${nl04}`],
  expected_state: { [`job:${nl04}`]: "do_not_blame_price" },
  expected_current_card: "card.nl04.reject.v2",
  expected_in_effect_card: "card.nl04.reject.v2",
  expected_reasons: ["card.nl04.reject.v2"],
  expected_flags: ["P5"],
  must_not_say: ["lost on price", "too expensive"],
});
Q({
  question_id: "q-p5-rm02-not-price",
  pattern: "P5",
  question: "Is it fair to say Red Mill turned down the restroom follow-up as too expensive?",
  as_of: chicago("2026-04-28T10:00:00"),
  seats: [`job:${rm02}`],
  expected_state: { [`job:${rm02}`]: "do_not_blame_price" },
  expected_current_card: "card.rm02.reject",
  expected_in_effect_card: "card.rm02.approve.v1",
  expected_reasons: ["card.rm02.reject"],
  expected_flags: ["P5"],
  must_not_say: ["too expensive", "rejected on price"],
});


const recId = (r: { record_id: string }) => r.record_id;
// Hero-case causes, shared by the "why" and "what should v4 fix" questions.
const heronCauses = (fixWording: boolean) => [
  {
    cause: fixWording
      ? "send one clean v4 under its own id; v1 was voided and re-sent within nine minutes with a cover note naming another job's quote (Q-PW-04-v2)"
      : "process noise on v1: voided and re-sent within nine minutes, and the cover note named another job's quote (Q-PW-04-v2)",
    evidence: [recId(heronE1), recId(heronE3), recId(heronE4), heronQ1.record_id, heronVoid.record_id],
    inference: true as const,
  },
  {
    cause: fixWording
      ? "say in the scope text that v2 added the leader replacement and why the strainer went from 185.00 to 228.00"
      : "v2 rose from 761.00 to 1626.00 and silently added the leader replacement while the scope text stayed the same",
    evidence: [heronQ1.record_id, heronQ2.record_id],
    inference: true as const,
  },
  {
    cause: fixWording
      ? "explain the five extra labor hours in v3 (400.00) or take them out"
      : "v3 added five labor hours (400.00) with no change in scope",
    evidence: [heronQ2.record_id, heronQ3.record_id],
    inference: true as const,
  },
  {
    cause: fixWording
      ? "close the promised leader scope first; the leader replacement is priced on a check that never happened"
      : "the promised scope of the leader was never done, yet v2 and v3 price replacing the leader",
    evidence: [heronPromise.record_id, heronAccess.record_id, heronQ2.record_id],
    inference: true as const,
  },
  {
    cause: fixWording
      ? "do not send reminders inside Otto's ten business days"
      : "reminders went out the next morning after v1 and v3, inside Otto's ten-business-day quiet period",
    evidence: [recId(heronE6), recId(heronE11), recOttoRule.record_id],
    inference: true as const,
  },
];
Q({
  question_id: "q-p5-heron-why",
  pattern: "P5",
  question: "Otto has turned down all three Heron Court quotes. Why?",
  as_of: chicago("2026-06-25T09:00:00"),
  seats: [`job:${pw05}`, `client:${PW}`],
  expected_state: seatState(pw05, PW, "rejected_three_times_reason_not_stated", "quiet_rule_in_force"),
  expected_current_card: "card.pw05.reject.v3",
  expected_in_effect_card: "card.pw05.reject.v3",
  expected_reasons: ["not_recorded"],
  expected_flags: ["P5", "P1", "P2", "P4"],
  must_not_say: [
    "the client rejected it because it was too expensive",
    "Otto rejected it because of the price",
    "Otto rejected it because of the reminders",
    "Otto rejected it because of the voided quote",
    "the leader scope found the leader needs replacing",
  ],
  expected_candidate_causes: heronCauses(false),
});
Q({
  question_id: "q-p5-heron-v4",
  pattern: "P5",
  question: "What should Heron Court v4 fix before I send it to Otto?",
  as_of: chicago("2026-06-26T09:00:00"),
  seats: [`job:${pw05}`, `client:${PW}`],
  expected_state: seatState(pw05, PW, "rejected_three_times_reason_not_stated", "quiet_rule_in_force"),
  expected_current_card: "card.pw05.reject.v3",
  expected_in_effect_card: "card.pw05.reject.v3",
  expected_reasons: ["not_recorded"],
  expected_flags: ["P5", "P1", "P2", "P4"],
  must_not_say: ["just lower the price", "the client rejected it because it was too expensive", "the leader scope is done"],
  expected_candidate_causes: heronCauses(true),
});
Q({
  question_id: "q-p7-heron-invoice",
  pattern: "P7",
  question: "Can we invoice anything on Heron Court yet?",
  as_of: chicago("2026-06-26T09:00:00"),
  seats: [`job:${pw05}`],
  expected_state: { [`job:${pw05}`]: "no_approved_version_unbilled" },
  expected_current_card: "card.pw05.reject.v3",
  expected_in_effect_card: "card.pw05.reject.v3",
  expected_reasons: ["card.pw05.reject.v1", "card.pw05.reject.v2", "card.pw05.reject.v3", "not_recorded"],
  expected_flags: ["P7"],
  must_not_say: ["invoice v3", "Otto approved the stop-gap work", "the $280 stop-gap is on an approved quote"],
});
Q({
  question_id: "q-p5-oc05-why",
  pattern: "P5",
  question: "Why did Helen turn down the unit 7 fan quote?",
  as_of: chicago("2026-06-12T09:00:00"),
  seats: [`job:${oc05}`],
  expected_state: { [`job:${oc05}`]: "rejected_reason_not_stated" },
  expected_current_card: "card.oc05.reject",
  expected_in_effect_card: "card.oc05.reject",
  expected_reasons: ["not_recorded"],
  expected_flags: ["P5", "P2"],
  must_not_say: ["the client rejected it because it was too expensive", "Helen rejected it because of the fan price", "Helen rejected it because of the duplicate emails"],
  expected_candidate_causes: [
    { cause: "v1 voided and recreated as v2 within seven minutes", evidence: [recId(oc05e2), recId(oc05e3)], inference: true },
    { cause: "fan material rose from 148.00 to 212.00 with the same description", evidence: [oc05q1.record_id, oc05q2.record_id], inference: true },
    { cause: "three notices to the same two people in under an hour; Tomas asked which one is real", evidence: [recId(oc05e4), recId(oc05e5), recId(oc05e6), oc05Tomas.record_id], inference: true },
  ],
});
Q({
  question_id: "q-p5-oc05-resend",
  pattern: "P5",
  question: "Before I resend the unit 7 fan quote, what should I fix?",
  as_of: chicago("2026-06-12T10:00:00"),
  seats: [`job:${oc05}`, `client:${OC}`],
  expected_state: seatState(oc05, OC, "rejected_reason_not_stated", "cc_tomas_allowed"),
  expected_current_card: "card.oc05.reject",
  expected_in_effect_card: "card.oc05.reject",
  expected_reasons: ["not_recorded"],
  expected_flags: ["P5", "P2"],
  must_not_say: ["the client rejected it because it was too expensive", "Helen said the fan costs too much"],
  expected_candidate_causes: [
    { cause: "send one quote number once, not a voided v1 plus three notices of v2", evidence: [recId(oc05e2), recId(oc05e4), recId(oc05e5), recId(oc05e6)], inference: true },
    { cause: "explain the fan price change from 148.00 to 212.00 or revert it", evidence: [oc05q1.record_id, oc05q2.record_id], inference: true },
  ],
});
Q({
  question_id: "q-p6-oc03-lump",
  pattern: "P6",
  question: "Does pump v2 look like what Oak Circle normally approves?",
  as_of: chicago("2026-05-18T11:30:00"),
  seats: [`job:${oc03}`, `client:${OC}`],
  expected_state: seatState(oc03, OC, "off_norm_lump_sum", "four_line_in_force"),
  expected_current_card: "card.oc03.approve.v1",
  expected_in_effect_card: "card.oc.structure.until",
  expected_reasons: ["card.oc03.approve.v1", "card.oc01.approve.v1", "card.oc.structure.until"],
  expected_flags: ["P6", "T10"],
  must_not_say: ["derive the norm from rejected quotes", "Helen already allowed lump sums in May"],
});
Q({
  question_id: "q-p6-pw04-fold",
  pattern: "P6",
  question: "Will Otto see RTU-2 v2 as a normal Pike Water HVAC quote?",
  as_of: chicago("2026-05-14T10:00:00"),
  seats: [`job:${pw04}`, `client:${PW}`],
  expected_state: seatState(pw04, PW, "off_norm_labor_folded", "split_labor_material"),
  expected_current_card: "card.pw04.approve.v1",
  expected_in_effect_card: "card.pw04.approve.v1",
  expected_reasons: ["card.pw04.approve.v1", "card.pw01.approve.late"],
  expected_flags: ["P6"],
  must_not_say: ["Pike Water usually approves labor hidden in material"],
});
Q({
  question_id: "q-p6-rm04-trip",
  pattern: "P6",
  question: "Does gallery v2 match Red Mill's approved general-repair shape?",
  as_of: chicago("2026-05-13T09:40:00"),
  seats: [`job:${rm04}`, `client:${RM}`],
  expected_state: seatState(rm04, RM, "off_norm_trip", "no_trip_lines"),
  expected_current_card: "card.rm04.approve.late",
  expected_in_effect_card: "card.rm04.approve.late",
  expected_reasons: ["card.rm04.approve.late", "card.rm02.approve.v1", "card.rm03.approve.v1"],
  expected_flags: ["P6"],
  must_not_say: ["Red Mill approved quotes usually include mobilization"],
});
Q({
  question_id: "q-p6-nl04-weather",
  pattern: "P6",
  question: "Would Ria see flashing v2's weather allowance as a normal North Loft line?",
  as_of: chicago("2026-04-03T09:25:00"),
  seats: [`job:${nl04}`, `client:${NL}`],
  expected_state: seatState(nl04, NL, "off_norm_lump_allowance", "split_named_lines"),
  expected_current_card: null,
  expected_in_effect_card: null,
  expected_reasons: ["card.nl01.approve.v1", "card.nl02.approve.v1", "card.nl03.approve.v1"],
  expected_flags: ["P6"],
  must_not_say: ["North Loft approved quotes include lump-sum weather allowances"],
  expected_norm_sources: ["card.nl01.approve.v1", "card.nl01.approve.v2", "card.nl01.approve.v3", "card.nl02.approve.v1", "card.nl03.approve.v1"],
});
Q({
  question_id: "q-p6-oc03-after-june",
  pattern: "P6",
  question: "After Helen's June lump-sum instruction, is pump v3 still off-norm?",
  as_of: chicago("2026-06-04T10:00:00"),
  seats: [`job:${oc03}`, `client:${OC}`],
  expected_state: seatState(oc03, OC, "structure_allowed_with_reason", "lump_sum_allowed"),
  expected_current_card: "card.oc.structure.new",
  expected_in_effect_card: "card.oc.structure.new",
  expected_reasons: ["card.oc.structure.new"],
  expected_flags: [],
  must_not_say: ["lump sums are still forbidden on 4 June"],
});
Q({
  question_id: "q-p6-pw03-trip",
  pattern: "P6",
  question: "Is a trip charge on the EPDM quote something Pike Water has approved before?",
  as_of: chicago("2026-05-01T09:05:00"),
  seats: [`job:${pw03}`, `client:${PW}`],
  expected_state: seatState(pw03, PW, "off_norm_trip", "no_trip_lines"),
  expected_current_card: "card.pw03.approve.v1",
  expected_in_effect_card: "card.pw03.approve.v1",
  expected_reasons: ["card.pw03.approve.v1", "card.pw01.approve.late", "card.pw02.approve.v1"],
  expected_flags: ["P6"],
  must_not_say: ["Otto's approved quotes include trip charges"],
});

Q({
  question_id: "q-p7-nl04-inv",
  pattern: "P7",
  question: "Can I send INV-NL-04 as it is?",
  as_of: chicago("2026-05-04T10:35:00"),
  seats: [`job:${nl04}`],
  expected_state: { [`job:${nl04}`]: "invoice_from_rejected" },
  expected_current_card: "card.nl04.reject.v2",
  expected_in_effect_card: "card.nl04.reject.v2",
  expected_reasons: ["card.nl04.reject.v2", "not_recorded"],
  expected_flags: ["P7"],
  must_not_say: ["the invoice matches an approved flashing quote"],
});
Q({
  question_id: "q-p7-pw03-inv",
  pattern: "P7",
  question: "Can I send the EPDM invoice as it is?",
  as_of: chicago("2026-05-19T10:20:00"),
  seats: [`job:${pw03}`],
  expected_state: { [`job:${pw03}`]: "invoice_from_voided" },
  expected_current_card: "card.pw03.approve.v1",
  expected_in_effect_card: "card.pw03.approve.v1",
  expected_reasons: ["card.pw03.approve.v1"],
  expected_flags: ["P7"],
  must_not_say: ["the invoice matches approved v1"],
});
Q({
  question_id: "q-p7-rm02-inv",
  pattern: "P7",
  question: "Does INV-RM-02 match what Yvette approved?",
  as_of: chicago("2026-05-18T09:50:00"),
  seats: [`job:${rm02}`],
  expected_state: { [`job:${rm02}`]: "invoice_from_rejected" },
  expected_current_card: "card.rm02.reject",
  expected_in_effect_card: "card.rm02.approve.v1",
  expected_reasons: ["card.rm02.approve.v1", "card.rm02.reject"],
  expected_flags: ["P7"],
  must_not_say: ["bill the rejected follow-up as if it were approved"],
});
Q({
  question_id: "q-p7-oc03-inv",
  pattern: "P7",
  question: "Can I send the boiler pump invoice draft?",
  as_of: chicago("2026-05-28T14:10:00"),
  seats: [`job:${oc03}`],
  expected_state: { [`job:${oc03}`]: "invoice_from_unapproved" },
  expected_current_card: "card.oc03.approve.v1",
  expected_in_effect_card: "card.oc03.approve.v1",
  expected_reasons: ["card.oc03.approve.v1"],
  expected_flags: ["P7", "P6"],
  must_not_say: ["Helen approved the lump-sum invoice"],
});
Q({
  question_id: "q-p7-pw04-inv",
  pattern: "P7",
  question: "Is INV-PW-04 safe to send against the approved compressor swap?",
  as_of: chicago("2026-06-02T11:30:00"),
  seats: [`job:${pw04}`],
  expected_state: { [`job:${pw04}`]: "invoice_mismatch" },
  expected_current_card: "card.pw04.approve.v1",
  expected_in_effect_card: "card.pw04.approve.v1",
  expected_reasons: ["card.pw04.approve.v1"],
  expected_flags: ["P7", "P6"],
  must_not_say: ["the folded invoice matches the approved split"],
});
Q({
  question_id: "q-p7-rm04-inv",
  pattern: "P7",
  question: "Can I send the gallery invoice draft as written?",
  as_of: chicago("2026-06-08T11:00:00"),
  seats: [`job:${rm04}`],
  expected_state: { [`job:${rm04}`]: "invoice_mismatch" },
  expected_current_card: "card.rm04.approve.late",
  expected_in_effect_card: "card.rm04.approve.late",
  expected_reasons: ["card.rm04.approve.late"],
  expected_flags: ["P7", "P6"],
  must_not_say: ["the trip charge was on the approved quote"],
});

Q({
  question_id: "q-t2-oc04-asof",
  pattern: "T2",
  question: "As of 24 April, is the stair drywall quote already approved?",
  as_of: chicago("2026-04-24T09:00:00"),
  seats: [`job:${oc04}`],
  expected_state: { [`job:${oc04}`]: "approved_on_call_not_yet_written" },
  expected_current_card: "card.oc04.approve.late",
  expected_in_effect_card: "card.oc04.approve.late",
  expected_reasons: ["card.oc04.approve.late"],
  expected_flags: ["T2"],
  must_not_say: ["approval only counts from 27 April when Jonah wrote the note"],
});
Q({
  question_id: "q-t2-nl01-asof",
  pattern: "T2",
  question: "As of 18 March, is panel v3 approved even though Jonah wrote the note on the 20th?",
  as_of: chicago("2026-03-18T12:00:00"),
  seats: [`job:${nl01}`],
  expected_state: { [`job:${nl01}`]: "approved_on_call" },
  expected_current_card: "card.nl01.approve.v3",
  expected_in_effect_card: "card.nl01.approve.v3",
  expected_reasons: ["card.nl01.approve.v3"],
  expected_flags: ["T2"],
  must_not_say: ["v3 was not approved until the 20 March note"],
});
Q({
  question_id: "q-t2-pw01-asof",
  pattern: "T2",
  question: "As of 21 March, had Otto already approved the shop labeling quote?",
  as_of: chicago("2026-03-21T09:00:00"),
  seats: [`job:${pw01}`],
  expected_state: { [`job:${pw01}`]: "approved_on_call" },
  expected_current_card: "card.pw01.approve.late",
  expected_in_effect_card: "card.pw01.approve.late",
  expected_reasons: ["card.pw01.approve.late"],
  expected_flags: ["T2"],
  must_not_say: ["approval started when the 23 March note was typed"],
});
Q({
  question_id: "q-t2-rm04-asof",
  pattern: "T2",
  question: "As of 22 April, is the gallery leak quote approved?",
  as_of: chicago("2026-04-22T09:00:00"),
  seats: [`job:${rm04}`],
  expected_state: { [`job:${rm04}`]: "approved_on_call" },
  expected_current_card: "card.rm04.approve.late",
  expected_in_effect_card: "card.rm04.approve.late",
  expected_reasons: ["card.rm04.approve.late"],
  expected_flags: ["T2"],
  must_not_say: ["approval waits for the 24 April write-up"],
});

Q({
  question_id: "q-t6-rm03-rates",
  pattern: "T6",
  question: "For the second library AHU belt change, which labor and material prices apply after 4 June?",
  as_of: chicago("2026-06-04T12:00:00"),
  seats: [`job:${rm03}`, `client:${RM}`],
  expected_state: seatState(rm03, RM, "labor_new_material_old", "partial_replace"),
  expected_current_card: "card.rm03.approve.v2",
  expected_in_effect_card: "card.rm.labor.new",
  expected_reasons: ["card.rm.labor.new", "card.rm.material.keep"],
  expected_flags: ["T6"],
  must_not_say: ["material belt prices also moved to a new rate"],
});
Q({
  question_id: "q-t6-nl-labor",
  pattern: "T6",
  question: "If I rebuild a North Loft electrical quote after 1 May, which rates apply?",
  as_of: chicago("2026-05-02T09:00:00"),
  seats: [`client:${NL}`],
  expected_state: { [`client:${NL}`]: "labor_new_material_old" },
  expected_current_card: "card.nl.labor.new",
  expected_in_effect_card: "card.nl.labor.new",
  expected_reasons: ["card.nl.labor.new", "card.nl.material.keep"],
  expected_flags: ["T6"],
  must_not_say: ["material panel pricing was reopened"],
});
Q({
  question_id: "q-t6-rm04-gallery",
  pattern: "T6",
  question: "On the gallery job after 21 May, do I change labor, material, or both?",
  as_of: chicago("2026-05-22T09:00:00"),
  seats: [`job:${rm04}`],
  expected_state: { [`job:${rm04}`]: "labor_new_material_old" },
  expected_current_card: "card.rm04.labor.new",
  expected_in_effect_card: "card.rm04.labor.new",
  expected_reasons: ["card.rm04.labor.new", "card.rm04.material.keep"],
  expected_flags: ["T6"],
  must_not_say: ["tile and copper prices were also revised"],
});
Q({
  question_id: "q-t6-rm-keep-mat",
  pattern: "T6",
  question: "Yvette changed mechanical labor. Did she reopen AHU material?",
  as_of: chicago("2026-06-05T09:00:00"),
  seats: [`client:${RM}`, `job:${rm03}`],
  expected_state: seatState(rm03, RM, "material_unchanged", "partial_replace"),
  expected_current_card: "card.rm.material.keep",
  expected_in_effect_card: "card.rm.material.keep",
  expected_reasons: ["card.rm.material.keep"],
  expected_flags: ["T6"],
  must_not_say: ["the belt set price is no longer the approved one"],
});

Q({
  question_id: "q-t10-rm-may",
  pattern: "T10",
  question: "On 20 May, which Red Mill mechanical labor rate applies?",
  as_of: chicago("2026-05-20T09:00:00"),
  seats: [`client:${RM}`],
  expected_state: { [`client:${RM}`]: "old_rate_in_effect_new_scheduled" },
  expected_current_card: "card.rm.labor.new",
  expected_in_effect_card: "card.rm.labor.old",
  expected_reasons: ["card.rm.labor.old", "card.rm.labor.new"],
  expected_flags: ["T10"],
  must_not_say: ["$96/hr already applies on 20 May"],
});
Q({
  question_id: "q-t10-rm-june",
  pattern: "T10",
  question: "On 31 May, which Red Mill mechanical labor rate applies?",
  as_of: chicago("2026-05-31T09:00:00"),
  seats: [`client:${RM}`],
  expected_state: { [`client:${RM}`]: "old_rate_in_effect_new_scheduled" },
  expected_current_card: "card.rm.labor.new",
  expected_in_effect_card: "card.rm.labor.old",
  expected_reasons: ["card.rm.labor.old", "card.rm.labor.new"],
  expected_flags: ["T10"],
  must_not_say: ["$96/hr already applies on 31 May"],
});
Q({
  question_id: "q-t10-oc-may",
  pattern: "T10",
  question: "On 20 May, may I send Oak Circle mechanical work as a lump sum?",
  as_of: chicago("2026-05-20T12:00:00"),
  seats: [`client:${OC}`],
  expected_state: { [`client:${OC}`]: "four_line_still_required" },
  expected_current_card: "card.oc.structure.new",
  expected_in_effect_card: "card.oc.structure.until",
  expected_reasons: ["card.oc.structure.until", "card.oc.structure.new"],
  expected_flags: ["T10"],
  must_not_say: ["lump sums are already allowed on 20 May"],
});
Q({
  question_id: "q-t10-pw-june10",
  pattern: "T10",
  question: "On 10 June, which Pike Water electrical labor rate should I use?",
  as_of: chicago("2026-06-10T09:00:00"),
  seats: [`client:${PW}`],
  expected_state: { [`client:${PW}`]: "old_rate_in_effect_new_scheduled" },
  expected_current_card: "card.pw.labor.new",
  expected_in_effect_card: "card.pw.labor.old",
  expected_reasons: ["card.pw.labor.old", "card.pw.labor.new"],
  expected_flags: ["T10"],
  must_not_say: ["$96/hr already applies on 10 June"],
});

Q({
  question_id: "q-ctrl-nl01-send",
  pattern: "CTRL",
  question: "Before I send panel v3 to Ria, is there anything she will question?",
  as_of: chicago("2026-03-16T16:20:00"),
  seats: [`job:${nl01}`],
  expected_state: { [`job:${nl01}`]: "clean_explained_changes" },
  expected_current_card: "card.nl01.approve.v2",
  expected_in_effect_card: "card.nl01.approve.v2",
  expected_reasons: ["card.nl01.inspector.surge"],
  expected_flags: [],
  must_not_say: ["unexplained price change", "open inspection on the panel job"],
});
Q({
  question_id: "q-ctrl-nl01-inv",
  pattern: "CTRL",
  question: "Can I treat INV-NL-01 as matching the approved panel quote?",
  as_of: chicago("2026-04-03T10:10:00"),
  seats: [`job:${nl01}`],
  expected_state: { [`job:${nl01}`]: "invoice_matches" },
  expected_current_card: "card.nl01.approve.v3",
  expected_in_effect_card: "card.nl01.approve.v3",
  expected_reasons: ["card.nl01.approve.v3"],
  expected_flags: [],
  must_not_say: ["the panel invoice will be disputed"],
});
Q({
  question_id: "q-ctrl-oc01-v2",
  pattern: "CTRL",
  question: "Corridor lighting v2 is higher than v1. Anything Helen will question before I send it?",
  as_of: chicago("2026-03-23T10:50:00"),
  seats: [`job:${oc01}`],
  expected_state: { [`job:${oc01}`]: "clean_explained_changes" },
  expected_current_card: "card.oc01.approve.v1",
  expected_in_effect_card: "card.oc01.approve.v1",
  expected_reasons: ["card.oc01.ask.heads"],
  expected_flags: [],
  must_not_say: ["silent scope growth on the corridor job"],
});
Q({
  question_id: "q-ctrl-oc01-inv",
  pattern: "CTRL",
  question: "Can I send INV-OC-01 as it is?",
  as_of: chicago("2026-04-10T11:10:00"),
  seats: [`job:${oc01}`],
  expected_state: { [`job:${oc01}`]: "invoice_matches" },
  expected_current_card: "card.oc01.approve.v2",
  expected_in_effect_card: "card.oc01.approve.v2",
  expected_reasons: ["card.oc01.approve.v2"],
  expected_flags: [],
  must_not_say: ["the lighting invoice mismatches the approval"],
});
Q({
  question_id: "q-ctrl-pw01-inv",
  pattern: "CTRL",
  question: "Is the shop labeling invoice clean to send?",
  as_of: chicago("2026-04-01T09:10:00"),
  seats: [`job:${pw01}`],
  expected_state: { [`job:${pw01}`]: "invoice_matches" },
  expected_current_card: "card.pw01.approve.late",
  expected_in_effect_card: "card.pw01.approve.late",
  expected_reasons: ["card.pw01.approve.late"],
  expected_flags: [],
  must_not_say: ["shop labeling invoice is likely to be disputed"],
});
Q({
  question_id: "q-ctrl-rm03-inv",
  pattern: "CTRL",
  question: "Does INV-RM-03 match the belts Yvette approved in April?",
  as_of: chicago("2026-04-20T10:10:00"),
  seats: [`job:${rm03}`],
  expected_state: { [`job:${rm03}`]: "invoice_matches" },
  expected_current_card: "card.rm03.approve.v1",
  expected_in_effect_card: "card.rm03.approve.v1",
  expected_reasons: ["card.rm03.approve.v1"],
  expected_flags: [],
  must_not_say: ["the belts invoice used the June labor rate"],
});
Q({
  question_id: "q-ctrl-oc04-inv",
  pattern: "CTRL",
  question: "Can I send the stair drywall invoice as written?",
  as_of: chicago("2026-05-11T09:20:00"),
  seats: [`job:${oc04}`],
  expected_state: { [`job:${oc04}`]: "invoice_matches" },
  expected_current_card: "card.oc04.approve.late",
  expected_in_effect_card: "card.oc04.approve.late",
  expected_reasons: ["card.oc04.approve.late"],
  expected_flags: [],
  must_not_say: ["stair invoice does not match the approved quote"],
});
Q({
  question_id: "q-ctrl-oc03-v3-reason",
  pattern: "CTRL",
  question: "Can I send pump v3 to Helen as it is?",
  as_of: chicago("2026-06-04T10:10:00"),
  seats: [`job:${oc03}`, `client:${OC}`],
  expected_state: seatState(oc03, OC, "clean_restructure_with_reason", "lump_sum_allowed"),
  expected_current_card: "card.oc.structure.new",
  expected_in_effect_card: "card.oc.structure.new",
  expected_reasons: ["card.oc.structure.new"],
  expected_flags: [],
  must_not_say: ["v3 is off-norm because it is lump sum"],
});
Q({
  question_id: "q-ctrl-nl-cap-after",
  pattern: "CTRL",
  question: "I have a $3,100 North Loft quote to send on 10 June. Do I need anything from Ria first?",
  as_of: chicago("2026-06-10T09:00:00"),
  seats: [`client:${NL}`],
  expected_state: { [`client:${NL}`]: "cap_withdrawn" },
  expected_current_card: "card.nl.cap.withdrawn",
  expected_in_effect_card: "card.nl.cap.withdrawn",
  expected_reasons: ["card.nl.cap.withdrawn"],
  expected_flags: [],
  must_not_say: ["the pre-note cap still applies in June"],
});
Q({
  question_id: "q-ctrl-rm03-v2-reason",
  pattern: "CTRL",
  question: "Before I upload library belts v2, anything Yvette will push back on?",
  as_of: chicago("2026-06-03T10:20:00"),
  seats: [`job:${rm03}`],
  expected_state: { [`job:${rm03}`]: "clean_explained_labor_only" },
  expected_current_card: "card.rm03.approve.v1",
  expected_in_effect_card: "card.rm.labor.new",
  expected_reasons: ["card.rm.labor.new", "card.rm.material.keep"],
  expected_flags: ["T6"],
  must_not_say: ["v2 silently grew scope"],
});

Q({
  question_id: "q-ctrl-nl01-ground",
  pattern: "CTRL",
  question: "Before I send panel v2 to Ria, are we still waiting on anything we told her we'd check?",
  as_of: chicago("2026-03-12T09:50:00"),
  seats: [`job:${nl01}`],
  expected_state: { [`job:${nl01}`]: "promise_closed" },
  expected_current_card: "card.nl01.approve.v1",
  expected_in_effect_card: "card.nl01.approve.v1",
  expected_reasons: ["card.nl01Ground.promise", "card.nl01Ground.result"],
  expected_flags: [],
  must_not_say: ["the isolated ground check is still open", "the quote depends on an inspection with no result"],
});
Q({
  question_id: "q-ctrl-oc04-framing",
  pattern: "CTRL",
  question: "Before I send the stair drywall quote, is anything open from what we told Helen?",
  as_of: chicago("2026-04-21T10:20:00"),
  seats: [`job:${oc04}`],
  expected_state: { [`job:${oc04}`]: "promise_closed" },
  expected_current_card: "card.oc04Framing.result",
  expected_in_effect_card: "card.oc04Framing.result",
  expected_reasons: ["card.oc04Framing.promise", "card.oc04Framing.result"],
  expected_flags: [],
  must_not_say: ["we still do not know whether the framing is wet"],
});
Q({
  question_id: "q-ctrl-rm01-panel",
  pattern: "CTRL",
  question: "Before I upload the annex quote, did we answer what Yvette asked about the subpanel?",
  as_of: chicago("2026-03-10T10:00:00"),
  seats: [`job:${rm01}`],
  expected_state: { [`job:${rm01}`]: "promise_closed" },
  expected_current_card: "card.rm01Panel.result",
  expected_in_effect_card: "card.rm01Panel.result",
  expected_reasons: ["card.rm01Panel.promise", "card.rm01Panel.result"],
  expected_flags: [],
  must_not_say: ["the subpanel capacity is still unknown", "a homerun is needed"],
});

// P2 split, applied after the questions are declared.
const p2Gold: Record<string, [string[], "present" | "absent"]> = {
  "q-p1-nl02-send-v3": [["card.nl02.note.supplier"], "absent"],
  "q-p2-nl02-heater-price": [["card.nl02.note.supplier"], "absent"],
  "q-p2-nl03-hours": [[], "absent"],
  "q-p2-pw02-hours": [[], "absent"],
  "q-p2-pw04-fold": [["card.pw04.note.accounting"], "absent"],
  "q-p2-rm01-homerun": [[], "absent"],
  "q-p2-oc03-lump-delta": [[], "absent"],
  "q-p2-nl04-v3-hours": [[], "absent"],
  "q-p2-rm04-trip-price": [["card.rm04.note.v2lines"], "absent"],
  "q-p5-heron-why": [[], "absent"],
  "q-p5-heron-v4": [[], "absent"],
  "q-p5-oc05-why": [[], "absent"],
  "q-p5-oc05-resend": [[], "absent"],
  "q-ctrl-nl01-send": [["card.nl01.inspector.surge"], "present"],
  "q-ctrl-nl01-ground": [["card.nl01Ground.result"], "present"],
  "q-ctrl-oc01-v2": [["card.oc01.ask.heads"], "present"],
  "q-ctrl-oc03-v3-reason": [["card.oc.structure.new"], "present"],
  "q-ctrl-rm03-v2-reason": [["card.rm.labor.new"], "present"],
};
for (const q of questions) {
  const g = p2Gold[q.question_id];
  if (!g) continue;
  q.expected_internal_reasons = g[0];
  q.expected_client_explanation = g[1];
}

const samples = { question_ids: ["q-p5-nl04-why", "q-p6-oc03-lump", "q-ctrl-nl01-send"] };

const vocab = `topics:
  scope:${yamlList(["work", "job-scope", "included-work", "scope"], 4).trimEnd()}
  price:${yamlList(["cost", "amount", "pricing", "price"], 4).trimEnd()}
  open_item:${yamlList(["open-item", "pending-check", "follow-up-inspection", "open_item"], 4).trimEnd()}
  client_rule:${yamlList(["standing-rule", "client-requirement", "process-rule", "client_rule"], 4).trimEnd()}
  approval:${yamlList(["approve", "reject", "sign-off", "approval"], 4).trimEnd()}
facets:
  price.labor:${yamlList(["labor", "hours", "labor-rate"], 4).trimEnd()}
  price.material:${yamlList(["material", "parts", "equipment"], 4).trimEnd()}
  price.total:${yamlList(["total", "grand-total"], 4).trimEnd()}
  scope.lines:${yamlList(["line-items", "breakdown"], 4).trimEnd()}
  scope.structure:${yamlList(["quote-structure", "lump-sum", "trip-charge"], 4).trimEnd()}
  open_item.inspection:${yamlList(["reinspect", "cause-unknown"], 4).trimEnd()}
  client_rule.submission:${yamlList(["how-to-send", "portal", "cc-list"], 4).trimEnd()}
  client_rule.cap:${yamlList(["pre-approval-cap", "threshold"], 4).trimEnd()}
  approval.status:${yamlList(["approved", "rejected"], 4).trimEnd()}
  approval.effective:${yamlList(["start-date", "in-force"], 4).trimEnd()}
  submission.process:${yamlList(["void", "resend", "notify", "duplicate-notice"], 4).trimEnd()}
scopes:
  global: []
  "client:${NL}":${yamlList(["north-loft", "nl"], 4).trimEnd()}
  "client:${OC}":${yamlList(["oak-circle", "oc"], 4).trimEnd()}
  "client:${PW}":${yamlList(["pike-water", "pw"], 4).trimEnd()}
  "client:${RM}":${yamlList(["red-mill", "rm"], 4).trimEnd()}
  "job:${nl01}":${yamlList(["panel-job"], 4).trimEnd()}
  "job:${nl02}":${yamlList(["heater-job"], 4).trimEnd()}
  "job:${nl03}":${yamlList(["condenser-job"], 4).trimEnd()}
  "job:${nl04}":${yamlList(["flashing-job"], 4).trimEnd()}
  "job:${oc01}":${yamlList(["corridor-light-job"], 4).trimEnd()}
  "job:${oc02}":${yamlList(["stack-job"], 4).trimEnd()}
  "job:${oc03}":${yamlList(["pump-job"], 4).trimEnd()}
  "job:${oc04}":${yamlList(["stair-drywall-job"], 4).trimEnd()}
  "job:${pw01}":${yamlList(["shop-label-job"], 4).trimEnd()}
  "job:${pw02}":${yamlList(["drain-job"], 4).trimEnd()}
  "job:${pw03}":${yamlList(["epdm-job"], 4).trimEnd()}
  "job:${pw04}":${yamlList(["rtu-job"], 4).trimEnd()}
  "job:${rm01}":${yamlList(["annex-receptacle-job"], 4).trimEnd()}
  "job:${rm02}":${yamlList(["flush-valve-job"], 4).trimEnd()}
  "job:${rm03}":${yamlList(["ahu-belts-job"], 4).trimEnd()}
  "job:${rm04}":${yamlList(["gallery-leak-job"], 4).trimEnd()}
  "job:${pw05}":${yamlList(["dock-door-job"], 4).trimEnd()}
  "job:${oc05}":${yamlList(["bath-fan-job"], 4).trimEnd()}
scope_parent:
  "job:${nl01}": "client:${NL}"
  "job:${nl02}": "client:${NL}"
  "job:${nl03}": "client:${NL}"
  "job:${nl04}": "client:${NL}"
  "job:${oc01}": "client:${OC}"
  "job:${oc02}": "client:${OC}"
  "job:${oc03}": "client:${OC}"
  "job:${oc04}": "client:${OC}"
  "job:${pw01}": "client:${PW}"
  "job:${pw02}": "client:${PW}"
  "job:${pw03}": "client:${PW}"
  "job:${pw04}": "client:${PW}"
  "job:${rm01}": "client:${RM}"
  "job:${rm02}": "client:${RM}"
  "job:${rm03}": "client:${RM}"
  "job:${rm04}": "client:${RM}"
  "job:${pw05}": "client:${PW}"
  "job:${oc05}": "client:${OC}"
  "client:${NL}": global
  "client:${OC}": global
  "client:${PW}": global
  "client:${RM}": global
deciders:
  approval:${yamlList([J.ria, J.helen, J.otto, J.yvette], 4).trimEnd()}
  client_rule:${yamlList([J.ria, J.helen, J.otto, J.yvette], 4).trimEnd()}
  scope:${yamlList([J.ria, J.helen, J.otto, J.yvette], 4).trimEnd()}
  price:${yamlList([J.ria, J.helen, J.otto, J.yvette], 4).trimEnd()}
`;

const readme = `# Harbor & Wick Repair Co. — synthetic records

ALL DATA IS FICTIONAL. Every company, city, person, address, quote, invoice, and message in this folder is invented for the unexplained hackathon. None of it refers to a real contractor, client, or person.

## Contractor

- Company: Harbor & Wick Repair Co.
- City: Tallow Creek, Missouri (fictional)
- Time zone: America/Chicago, timestamps with explicit offsets

## People (author / person ids)

Contractor staff:

| id | role | name |
|---|---|---|
| ${J.mira} | estimator (writes quotes) | Mira Kell |
| ${J.jonah} | office coordinator (submits quotes; the gatekeeper) | Jonah Prent |
| ${J.delia} | operations manager | Delia Vorn |
| ${J.cal} | field technician | Cal Rhees |
| ${J.nora} | field technician | Nora Quinn |
| ${J.wes} | field technician | Wes Dalby |

Clients and reviewers:

| client_id | organization | personality | reviewers |
|---|---|---|---|
| ${NL} | North Loft Holdings | terse | ${J.ria} Ria Moth |
| ${OC} | Oak Circle Residences | detailed | ${J.helen} Helen Bray (signer), ${J.tomas} Tomas Frey (may be copied from 20 May; not a signer) |
| ${PW} | Pike Water Commons | slow | ${J.otto} Otto Gell |
| ${RM} | Red Mill Civic Trust | strict about process | ${J.yvette} Yvette Sarn (signer), ${J.paul} Paul Kett (reader, not signer) |

A quote is only a proposal until a client reviewer in \`deciders.approval\` approves it.

## Jobs

${workOrders.length} work orders from 2026-03-02 to 2026-06-26 covering electrical, plumbing, HVAC, roofing, and general repair. Quote versions, invoices, and messages are in \`data/tables\` and \`data/records/records.jsonl\`.

## Status columns are end-of-window state

The \`status\` column in \`tables/quote_versions.csv\` and \`tables/invoices.csv\` is the state at the END of the window (2026-06-26), not the state on any question's date. A quote marked \`approved\` here may still have been unanswered on an earlier day. Any as-of answer must be derived from dated records (client messages, notes, submission events), never from these columns. The record text for quotes and invoices deliberately leaves status out.

## Trades

\`tables/work_orders.csv\` has a \`trade\` column (electrical | plumbing | hvac | roofing | general).

## Cost categories and the client portal

Each client reviews and pays through its own client portal. A client portal accepts only five cost categories, whatever the trade: labor, travel, material, freight, management. \`quote_lines.csv\` and \`invoice_lines.csv\` carry the \`category\` each line rolls up into (\`kind\` stays for the labor/material totals columns). Invoices may describe lines in more detail, but on the client portal everything is totalled per category. Trade-specific rates are not visible there; they live inside the labor amount.

\`tables/clients.csv\` lists the categories each client portal accepts (\`portal_categories\`, separated by \`;\`). A line in a category the client portal does not accept is off the client's structure by definition.

The normal structure of a client's quotes (P6) has two parts:
- structure: per client, across all trades: the categories in its approved quotes, its portal categories, and any later explicit structure instruction (the instruction wins);
- amount: per client and trade, category totals of approved quotes only, once there are at least two approved quotes in that trade.

## Approval seats: current vs in effect

For an approval seat, \`current\` is the latest client decision on that seat (an approval or a rejection, of any version). \`in_effect\` is what is approved and binding on the as-of date: rejecting a later version does not undo the approval of an earlier one. If nothing on the job has been approved, \`in_effect\` is the latest client decision.

## Warnings vs time tags

P1-P7 are warnings: something about to go out is wrong. T2, T6, T10 are time tags: they name the time trap a question tests and are never alarms. A P4 warning means a rule in force was broken; P4-pattern questions that only ask whether a rule is still in force carry no P4 warning. CTRL questions carry no warnings but may carry a time tag.

## How to read a decision

- Order by \`decided_at\`, not by when Jonah typed the note.
- Ignore withdrawn client rules.
- Do not treat rejected, voided, or draft quotes as the client's normal structure.
- If the records do not say, the gold answers use \`not_recorded\`.
`;

mkdirSync(join(root, "data/tables"), { recursive: true });
mkdirSync(join(root, "data/records"), { recursive: true });
mkdirSync(join(root, "eval/gold"), { recursive: true });

writeFileSync(join(root, "data/README.md"), readme);
writeFileSync(join(root, "data/vocab.yaml"), vocab);
writeFileSync(join(root, "data/tables/clients.csv"), toCsv(["client_id", "name", "portal_categories"], CLIENTS));
writeFileSync(join(root, "data/tables/work_orders.csv"), toCsv(["work_order_id", "client_id", "job_title", "trade", "opened_at", "status"], workOrders));
writeFileSync(
  join(root, "data/tables/quote_versions.csv"),
  toCsv(
    ["quote_id", "work_order_id", "version", "submitted_at", "submitted_by", "status", "total_labor", "total_material", "total", "scope_summary"],
    quoteVersions,
  ),
);
writeFileSync(
  join(root, "data/tables/quote_lines.csv"),
  toCsv(["quote_id", "line_no", "kind", "category", "description", "qty", "unit_price", "amount"], quoteLines),
);
writeFileSync(
  join(root, "data/tables/submission_events.csv"),
  toCsv(["event_id", "quote_id", "work_order_id", "event", "at", "recipients_count"], submissionEvents),
);
writeFileSync(
  join(root, "data/tables/invoices.csv"),
  toCsv(
    ["invoice_id", "work_order_id", "quote_id", "quote_version", "issued_at", "total_labor", "total_material", "total", "status"],
    invoices,
  ),
);
writeFileSync(
  join(root, "data/tables/invoice_lines.csv"),
  toCsv(["invoice_id", "line_no", "kind", "category", "description", "qty", "unit_price", "amount"], invoiceLines),
);
writeFileSync(join(root, "data/records/records.jsonl"), records.map((r) => JSON.stringify(r)).join("\n") + "\n");
writeFileSync(join(root, "eval/gold/gold_cards.jsonl"), cards.map((c) => JSON.stringify(c)).join("\n") + "\n");
writeFileSync(join(root, "eval/gold/gold_edges.jsonl"), edges.map((e) => JSON.stringify(e)).join("\n") + "\n");
writeFileSync(join(root, "eval/gold/gold_questions.jsonl"), questions.map((q) => JSON.stringify(q)).join("\n") + "\n");
writeFileSync(
  join(root, "eval/gold/no_decision_records.json"),
  JSON.stringify({ record_ids: noDecisionRecords }, null, 2) + "\n",
);
writeFileSync(join(root, "eval/gold/samples.json"), JSON.stringify(samples, null, 2) + "\n");

const msgLike = records.filter((r) => ["client_message", "internal_note", "field_note", "submission_event"].includes(r.source_type));
console.log({
  records: records.length,
  messages_notes_events: msgLike.length,
  work_orders: workOrders.length,
  quotes: quoteVersions.length,
  events: submissionEvents.length,
  invoices: invoices.length,
  cards: cards.length,
  questions: questions.length,
});
