# Harbor & Wick Repair Co. — synthetic records

ALL DATA IS FICTIONAL. Every company, city, person, address, quote, invoice, and message in this folder is invented for the unexplained hackathon. None of it refers to a real contractor, client, or person.

## Contractor

- Company: Harbor & Wick Repair Co.
- City: Tallow Creek, Missouri (fictional)
- Time zone: America/Chicago, timestamps with explicit offsets

## People (author / person ids)

Contractor staff:

| id | role | name |
|---|---|---|
| p.hw.mira_kell | estimator (writes quotes) | Mira Kell |
| p.hw.jonah_prent | office coordinator (submits quotes; the gatekeeper) | Jonah Prent |
| p.hw.delia_vorn | operations manager | Delia Vorn |
| p.hw.cal_rhees | field technician | Cal Rhees |
| p.hw.nora_quinn | field technician | Nora Quinn |
| p.hw.wes_dalby | field technician | Wes Dalby |

Clients and reviewers:

| client_id | organization | personality | reviewers |
|---|---|---|---|
| cl.north_loft | North Loft Holdings | terse | p.nl.ria_moth Ria Moth |
| cl.oak_circle | Oak Circle Residences | detailed | p.oc.helen_bray Helen Bray (signer), p.oc.tomas_frey Tomas Frey (may be copied from 20 May; not a signer) |
| cl.pike_water | Pike Water Commons | slow | p.pw.otto_gell Otto Gell |
| cl.red_mill | Red Mill Civic Trust | strict about process | p.rm.yvette_sarn Yvette Sarn (signer), p.rm.paul_kett Paul Kett (reader, not signer) |

A quote is only a proposal until a client reviewer in `deciders.approval` approves it.

## Jobs

18 work orders from 2026-03-02 to 2026-06-26 covering electrical, plumbing, HVAC, roofing, and general repair. Quote versions, invoices, and messages are in `data/tables` and `data/records/records.jsonl`.

## Status columns are end-of-window state

The `status` column in `tables/quote_versions.csv` and `tables/invoices.csv` is the state at the END of the window (2026-06-26), not the state on any question's date. A quote marked `approved` here may still have been unanswered on an earlier day. Any as-of answer must be derived from dated records (client messages, notes, submission events), never from these columns. The record text for quotes and invoices deliberately leaves status out.

## Trades

`tables/work_orders.csv` has a `trade` column (electrical | plumbing | hvac | roofing | general).

## Cost categories and the client portal

Each client reviews and pays through its own client portal. A client portal accepts only five cost categories, whatever the trade: labor, travel, material, freight, management. `quote_lines.csv` and `invoice_lines.csv` carry the `category` each line rolls up into (`kind` stays for the labor/material totals columns). Invoices may describe lines in more detail, but on the client portal everything is totalled per category. Trade-specific rates are not visible there; they live inside the labor amount.

`tables/clients.csv` lists the categories each client portal accepts (`portal_categories`, separated by `;`). A line in a category the client portal does not accept is off the client's structure by definition.

The normal structure of a client's quotes (P6) has two parts:
- structure: per client, across all trades: the categories in its approved quotes, its portal categories, and any later explicit structure instruction (the instruction wins);
- amount: per client and trade, category totals of approved quotes only, once there are at least two approved quotes in that trade.

## Approval seats: current vs in effect

For an approval seat, `current` is the latest client decision on that seat (an approval or a rejection, of any version). `in_effect` is what is approved and binding on the as-of date: rejecting a later version does not undo the approval of an earlier one. If nothing on the job has been approved, `in_effect` is the latest client decision.

## Warnings vs time tags

P1-P7 are warnings: something about to go out is wrong. T2, T6, T10 are time tags: they name the time trap a question tests and are never alarms. A P4 warning means a rule in force was broken; P4-pattern questions that only ask whether a rule is still in force carry no P4 warning. CTRL questions carry no warnings but may carry a time tag.

## How to read a decision

- Order by `decided_at`, not by when Jonah typed the note.
- Ignore withdrawn client rules.
- Do not treat rejected, voided, or draft quotes as the client's normal structure.
- If the records do not say, the gold answers use `not_recorded`.
