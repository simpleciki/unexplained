# Task 020 — Recall what this client told us before, from H-MEM; let a person confirm a first quote there

Decided by Ciki on 2026-10-25 (18:39 CDT).

Why: today H-MEM is written to (every card, with provenance and supersession reconciled to the seat table) but no
feature reads from it; answers come from the seat table only. The sponsor rule says an engine must be used in a
working feature ("adding an unused dependency won't count"). Second, after 019 four of the seven quick checks on
Today's outbox are first quotes that a person cannot confirm in the page, so they never turn green.

No change to how the verdict is decided: the seat table and detectors stay the authority. No model calls, no eval
commands, never write the real `review/judgments.jsonl` while testing (use `--demo` or a temp copy). Do not commit.

## 1. Read path: "What this client told us before"
On the check page, for the document's client, a panel recalled **from H-MEM** (the engine's `memory.hmem`, using
H-MEM's own `query()` for retrieval, then filtered):
- memories whose scope is this client or one of this client's work orders,
- learned at or before the document's cut-off,
- not superseded by a memory learned at or before the cut-off,
- each shown with who, when, the text, and a link to the source record (provenance).
Rules, approvals and rejections first, newest first within each. If H-MEM and the seat table disagree about whether a
memory was superseded, show the item with a small "memory and decision table disagree" mark (do not hide it).
Tests: the panel's items come from H-MEM (with an empty H-MEM store the panel is empty even though the seat table has
cards); the cut-off and supersession filters hold; the verdict and `summary()` are identical with and without the panel.

## 2. A person confirms a first quote
For a first quote whose open item is "confirm this first quote" (amendment 1, section 4), the panel offers
"Checked against this client's history — OK to send". It writes one judgment through the same judgments path the form
uses (real file in normal mode, the copy in `--demo`), with reviewer, time and a required reason, prefilled and
editable, e.g. "Checked against what this client told us before (N items)". The document then clears with the text
"Clear — first quote, confirmed by <reviewer> against the client's history." if nothing else is open. Extend the judgment
format minimally (a document-level judgment), keep old lines valid, and add tests (including: other open items still
block; the judgment is written to the copy in demo mode).

## 3. README
A short "Meterless H-MEM" section: what is written (every accepted card with provenance; H-MEM's supersession guesses
are checked against the seat table and every override and drift is logged; snapshot in `state/hmem-snapshot.json`), what
is read (the client-memory recall above, used by the check page and the first-quote confirmation), and what H-MEM does
not decide (the verdict). Link the code.

## Done when
1. typecheck clean, all tests pass (counts); `npm run eval:oracle -- --source files` still 80/80 (restore the tracked
   oracle outputs afterwards).
2. Live with `npm run ui -- --demo` on Today's outbox: confirm everything a person can confirm (not rec-0007, which is
   a real finding, and not Ciki's own open questions); report per document clicks and whether it turned green, and the
   header before and after. Real `review/judgments.jsonl` sha256 identical before and after. Screenshots. Stop the server.
3. Diff stat. Do not commit.
