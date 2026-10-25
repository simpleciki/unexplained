# Task 019 — A sample day on the home page, and "N left to confirm" instead of a wall

Decided by Ciki on 2026-10-25 (07:32 CDT). Definitions are pre-registered in `docs/value-metrics-amendment-1.md`
(commit `e309034`): read it first and do not change it.

No rule of the check changes. A document that is not cleared stays not cleared; this task shows the work a person
has to do and lets them do it in place. No model calls, no eval commands, never write the real
`review/judgments.jsonl` (judging happens in the normal app as before, or in `--demo` on the copy). Do not commit.

## 1. Count (section 4 of the amendment)
Extend `npm run value:metrics` to report the items a person has to confirm, exactly as section 4 defines them,
into `eval/results/value-metrics.json`. Print totals, median, range and the 1 / 2 / 3 / more distribution, and
the split by designed outcome. Test the counting.

## 2. Today's outbox (section 5)
The outbox opens on "Today's outbox": 10 documents drawn as section 5 says (seed 20261027, 2 problem + 8 clean,
uniform without replacement over each list sorted by id, seeded PRNG in the code). Put the draw in a small pure
function with a test that pins which 10 come out. On screen: "A sample day: 10 documents, drawn at random at the
builder's 2-in-10 ratio. See all 58." with a one-click switch to all documents (and the curated view from 017).
Totals shown match the API for the view in use.

## 3. "N left to confirm"
- Each not-cleared document shows "N left to confirm" instead of reading as blocked, and lists those items in
  place: the record (who, when, the text), why it needs a person, and the quick actions the existing judgment form
  already supports (e.g. "Looks fine" / "This is a decision"), one click where the form allows it. Reuse the
  existing judgment path; do not add a new way of writing judgments.
- Documents with warnings show "Fix before sending" with their named problems, as today.
- The outbox header reads as a to-do list, e.g. "2 to fix before sending · 7 quick checks (9 items) · 1 ready to
  send", from the counts of the view in use.
- After a person confirms the last item, the document turns green without a page reload, as in 015.

## Done when
1. typecheck clean, all tests pass (counts).
2. The section-4 numbers printed and saved; the 10 picked documents listed with their states.
3. Live check with `npm run ui -- --demo`: on Today's outbox, confirm every quick-check item and report, per
   document, the clicks it took and whether it turned green; real `review/judgments.jsonl` sha256 identical before
   and after. Screenshots of the outbox before and after. Stop the server.
4. Diff stat. Do not commit.
