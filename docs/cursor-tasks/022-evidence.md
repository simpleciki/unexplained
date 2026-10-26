# Task 022 — Committed evidence: live Zetaris, Nightshift receipts, and the sample day

Decided by Ciki on 2026-10-25 (23:03 CDT), after the cold review: the sponsor integrations and the "6 of 10 ready"
claim need evidence a judge can read in the repo. No model calls.

Already done by the hub session (do not redo; you cannot read `.env` or `~/Library` from your sandbox):
- `evidence/zetaris-parity-2026-10-25.txt`: a live `npm run zetaris:parity` at 23:03 CDT, 16 tables and views
  identical between `data/` and Zetaris.
- `evidence/nightshift-receipts-summary.jsonl`: 713 successful Nightshift calls by app `unexplained`,
  2026-10-21 20:28 to 2026-10-23 12:44 CDT, summarised from Nightshift's signed compute receipts (fields: signed
  time, receipt id, request id, requested mode, model that answered, provider, egress, cache, tokens, latency,
  cost, status). The full signed receipts stay local: the losing lanes of each race carry NVIDIA error text with
  the account id, and redacting it would break the signatures. Answered by: super-vl-120b 267, ultra-550b 244,
  lightning-30b 202, all with requested mode `meterless/auto` (Nightshift substituted models; reported to
  Meterless on 2026-10-23).

## 1. Reproduce the sample day
Add `npm run demo:sample-day` (no model calls): copy `review/judgments.jsonl` into a fresh temp directory, build the
check context on it, draw Today's outbox (seed 20261027), and apply exactly the confirmations a person can make in
the page: one-click "Looks fine" on records the model read as empty or routed to a person, and "Checked against this
client's history — OK to send" on first quotes. Do NOT confirm open questions (they need a person's answer) and do NOT
confirm rec-0007 (its text is a real finding: "Studio riser does need an isolated ground. About two hours of labor").
Print each of the 10 documents before and after, with its state, and the totals (expected from the live demo: 3 fix
before sending, 6 ready, 1 left). If the numbers differ, report them; do not adjust the script to match. Never write the
real `review/judgments.jsonl` or `.demo/`. Add a test that pins the result.

## 2. evidence/README.md
One page: what each evidence file is, when and how it was produced (the facts above), what it shows, what it does not
show, and how to reproduce (`npm run zetaris:parity` needs a running Zetaris and its credentials; `npm run
demo:sample-day` needs nothing). Scan both evidence files again for account ids, keys, tokens, paths and prompt text;
report the scan.

## Done when
typecheck clean, tests pass (counts), `npm run demo:sample-day` output pasted, scan reported, diff stat. Do not edit
README.md (report any wording you think it needs). Do not commit.
