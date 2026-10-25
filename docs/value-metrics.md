# Value metrics — what the gatekeeper does for the contractor, per document and per dollar

Pre-registered 2026-10-25 (America/Chicago), before any of these numbers was computed. Decided with Ciki on
2026-10-25: the 80-question A-vs-C evaluation measures whether answers cite the exact deciding record (a
trust measure); it does not show what a contractor gets. These metrics do. Definitions are fixed here; any later
change is a new dated file.

All three are computed with no model calls, from the engine as committed (`ff67f61` or later, stated in the
result), the ingested model cards in `state/` as they are, and the real `review/judgments.jsonl` (13 lines).
The demo copy (`.demo/`) is never used.

## 1. Documents and money

**Ground truth per document** comes from the data generator's designed outcome, not from the engine:
- *problem*: a quote version that was rejected, voided, or submitted and never approved; an invoice that was
  disputed, or a draft raised on a version that was never approved.
- *clean*: a quote version the client approved as sent; an invoice that was paid.

**Verdict** is the check page's state for that document (`warnings` / `not_cleared` / `clear`), with records up
to just before the document was submitted or issued.

| outcome | rule |
|---|---|
| caught | problem document, state `warnings` |
| held | problem document, state `not_cleared` (stopped and sent to a person, without a named problem) |
| missed | problem document, state `clear` (it would have gone out unchallenged) |
| false alarm | clean document, state `warnings` |
| needs a person | clean document, state `not_cleared` |
| cleared | clean document, state `clear` |

Report each as a count and as money (document total). Also report: stopped before sending = (caught + held) /
problem documents, by count and by money; missed by count and money; false alarms by count and money. The
P2 pattern needs the Judge model step, which the check page does not run; say how many documents that leaves open.

## 2. How much a person has to read

For each problem document that is caught: the number of records a person would have to go through without the
tool, defined as every record on file for that work order and for that client up to the document's cut-off,
across both source systems; and the number of distinct records the check page cites as evidence for its
warnings. Report the median and the range of both, and the ratio. This is a count of records, not a time. Time per
investigation is quoted only as the builder's own estimate from real work (1.5–2 hours, about 15–20 disputed
quotes a month reaching the last check), labelled as an estimate.

## 3. One job, told forward: WO-PW-05

For each quote version of WO-PW-05, at the moment it was submitted: what the check page says (state, warnings,
the evidence it cites, and the next step: who to ask, what to ask), next to what actually happened (rejected,
with or without a reason). Money at stake from `eval/demo/hero_case.json`. No claim about what the client would
have done; only what the contractor would have known before sending.

## What these numbers cannot say

The data is fictional and the problem documents were planted on purpose; the mix was about 57% problem documents.
No real user has used the tool; time saved is not measured. These are reported next to the numbers, not after them.
