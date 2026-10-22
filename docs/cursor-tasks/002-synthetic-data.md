# Task 002 — Synthetic dataset + gold answers (no model calls)

Paste everything below the line into a NEW Cursor chat in this repository. You write every data file directly. Do not call any model API, and do not write a script that calls one.

---

All data in this task is fictional. Follow `.cursor/rules/00-isolation.mdc`. Do not look anything up outside this repository.

## What the product is (so the data fits it)

`unexplained` is the last check before a repair contractor's quote or invoice goes out. It is used by the office gatekeeper who reviews every quote before submission and every invoice before billing. It reads the document the way the client will: against what this client has already approved before (the client's normal quote structure and normal amounts for this kind of job), against the client's standing rules, and against promises already made. After a rejection or a disputed invoice it works out why, with evidence. It answers only from decisions that are still in force, shows which earlier versions were replaced and by whom, quotes the original words, and says "the records do not say" instead of guessing.

Why it matters commercially: a quote that looks abnormal to the client costs the job and the client's trust; an invoice that does not match what the client approved gets disputed and delays payment. This is financial risk control for a small contractor.

## The world to invent

- One fictional contractor in a fictional mid-size US city. Invent the company name, the city, and every person's name. No real companies, products, people, or addresses.
- Contractor staff: 1 estimator who writes quotes, 1 office coordinator who submits them, 1 operations manager, 3 field technicians.
- 4 fictional clients (property owners or property managers). Each client has 1–2 reviewers who approve or reject quotes. Give each client a different personality: one terse, one detailed, one slow, one strict about process.
- About 16 jobs across the 4 clients (electrical, plumbing, HVAC, roofing, general repair), about 45 quote versions in total, and about 150 messages, field notes, and submission events.
- Time window: 2026-03-02 to 2026-06-26, all timestamps America/Chicago with explicit offsets (for example `2026-04-14T09:20:00-05:00`).
- Amounts are plausible USD, but invented. Every quote has line items split into labor and material.

## Files to create

```
data/README.md                      states clearly: ALL DATA IS FICTIONAL
data/vocab.yaml                     topics, facets, scopes, scope_parent, deciders (shape below)
data/tables/work_orders.csv         work_order_id, client_id, job_title, opened_at, status
data/tables/quote_versions.csv      quote_id, work_order_id, version, submitted_at, submitted_by, status (draft|submitted|voided|approved|rejected), total_labor, total_material, total, scope_summary
data/tables/quote_lines.csv         quote_id, line_no, kind (labor|material), description, qty, unit_price, amount
data/tables/submission_events.csv   event_id, quote_id, work_order_id, event (created|voided|resubmitted|notified), at, recipients_count
data/tables/invoices.csv            invoice_id, work_order_id, quote_id, quote_version, issued_at, total_labor, total_material, total, status (draft|sent|disputed|paid)
data/tables/invoice_lines.csv       invoice_id, line_no, kind (labor|material), description, qty, unit_price, amount
data/records/records.jsonl          one SourceRecord per line (shape below)
eval/gold/gold_cards.jsonl
eval/gold/gold_edges.jsonl
eval/gold/gold_questions.jsonl
eval/gold/samples.json              the 3 question ids chosen as judge samples
scripts/validate-data.ts            checks listed under "Done when"
```

`SourceRecord` (one line in `records.jsonl`):

```ts
{
  record_id: string;                  // unique
  source_type: "client_message" | "internal_note" | "field_note" | "quote_version" | "work_order" | "submission_event" | "invoice";
  source_version: string;             // "v1" unless the record was revised
  text: string;                       // natural prose, the way a real person writes
  author: string;                     // person id from data/README.md
  source_recorded_at: string;         // ISO 8601 with offset
  thread_id?: string;                 // work_order_id for messages about a job
  row_key?: string;                   // for table-derived records
}
```

Every quote version, submission event and invoice must also appear as a record (`source_type` `quote_version` / `submission_event` / `invoice`) whose text is a short human-readable rendering of the row, so the text corpus and the tables agree.

`vocab.yaml` shape:

```yaml
topics:   { scope: [...aliases], price: [...], open_item: [...], client_rule: [...], approval: [...] }
facets:   { price.labor: [...], price.material: [...], price.total: [...], scope.lines: [...], ... }
scopes:   { global: [], "client:<id>": [...], "job:<work_order_id>": [...] }
scope_parent: { "job:<id>": "client:<id>", "client:<id>": global }
deciders: { approval: [client reviewer ids], client_rule: [client reviewer ids], scope: [client reviewer ids], price: [client reviewer ids] }
```

A contractor's quote is only a proposal. It becomes a decision only when a client reviewer approves it.

## Failure patterns to plant (the gold answers test these)

Plant each pattern in several different jobs and clients, in varied wording. Never make a pattern obvious from a single keyword.

| id | Pattern | What it looks like in the records | Correct agent behaviour |
|---|---|---|---|
| P1 | A promise never closed | Contractor tells the client "we'll inspect again, then we'll know whether X is needed". Later quote versions never state the inspection result, but price depends on X. | Flag that the quote depends on an open item; quote the promise and its date; say no result is recorded. |
| P2 | Unexplained change between versions | Price changes between versions; the scope text does not change to match (or scope grows silently). | List each changed line with the price delta and whether the description explains it. |
| P3 | Going in circles | Several versions repeat "need to determine the cause" or similar, none records a finding. | Report that the question has not progressed across N versions. |
| P4 | A client rule still in force is broken | A client reviewer sets a standing rule (for example about where or how quotes are submitted, or a cap that needs pre-approval). A later submission breaks it. Some rules are later withdrawn by the same client. | Check new submissions against rules still in force; ignore withdrawn rules; quote the rule. |
| P5 | Rejection blamed on price by default | A rejection where the records show process or clarity problems (voided and recreated submissions within minutes, mismatched quote ids, several notifications to the same people), and price may or may not be a factor. | List candidate reasons with evidence for each; mark inferences as inference; never conclude "too expensive" without the client saying so. |
| P6 | Off the client's normal structure | Each client has a normal way its approved quotes look for a kind of job: which line items appear, in what order, how labor and material are split, and a typical amount range. Derive this ONLY from that client's approved quotes. A new quote breaks it (a new lump-sum line, labor folded into material, a trip charge the client never sees elsewhere, an amount far outside the client's approved range) without saying why. Some clients later change their own normal structure by an explicit instruction. | Flag what the client will see as abnormal, cite the approved quotes the norm comes from, and suggest how to restructure. Never derive the norm from rejected, voided, or draft quotes. Respect a client's later instruction over older history. |
| P7 | Invoice does not match what was approved | An invoice is built from the latest submitted version, a voided version, or a rejected version instead of the version the client approved; or its lines or totals differ from the approved version without a recorded approved change. | Name the approved version as of the invoice date, list each mismatch, and say the invoice is likely to be disputed. |
| T2 | Late record | A decision is made on a call and only written down days later. | Order by when it was decided, not when it was written. |
| T6 | Partial replacement | The client approves a new labor rate but leaves material pricing unchanged. | Labor = new, material = old. |
| T10 | Decided but not yet in effect | A client approves a change that starts on a later date; a question asks about a date in between. | Answer with what applied on that date, and note the scheduled change. |
| CTRL | Clean controls | Quotes where every price change is explained, promises are closed, and rules are respected. | The agent must NOT flag anything. |

Counts: P1–P5 at least 8 questions each; P6 and P7 at least 6 each; T2, T6, T10 at least 4 each; CTRL at least 10 (include clean invoices and quotes that change structure WITH a clear reason). Total at least 72. Give each client enough approved history (at least 3 approved quotes) for P6 norms to be meaningful.

## Gold files

- `gold_cards.jsonl`: `record_id, quote, mode (decides|mentions|gives_reason|proposes), topic, facets, scope, decided_at, effective, decided_by`. `quote` must be an exact substring of that record's `text`.
- `gold_edges.jsonl`: `old_card, new_card, relation (REPLACES|SAME|REFINES|UNRELATED)`.
- `gold_questions.jsonl`: `question_id, pattern, question, as_of (ISO date or null), seats, expected_state per seat, expected_current_card, expected_in_effect_card, expected_reasons (card ids or "not_recorded"), expected_flags (list of pattern ids, empty for CTRL), must_not_say (list of claims that would be wrong, for example "the client rejected it because it was too expensive")`.
- Write questions the way a contractor's office gatekeeper would actually ask, for example "Before I send v3 for the roof job, what will the client push back on?", "Why did they reject the panel replacement quote?", "Does this quote look like what this client normally approves?", or "Can I send this invoice as it is?"

## Done when

`npm run validate:data` (add the script to `package.json`) passes, and it checks:
1. Every `record_id` is unique; every timestamp has an offset and falls inside the time window.
2. Every gold card `quote` is found verbatim in its record's `text`.
3. Every gold edge and question refers to existing card ids; every seat key exists in `vocab.yaml`.
4. Table rows and their `quote_version` / `submission_event` / `invoice` records agree (ids, totals, timestamps); line items sum to totals.
5. Pattern counts meet the minimums above; it prints a table of counts per pattern.
6. `data/README.md` contains the word FICTIONAL.

Then show me: the counts table, the total number of records, and two example questions per pattern with their expected answers. Do not run any model.
