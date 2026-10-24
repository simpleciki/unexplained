# Task 017 — Fix two false-alarm causes, refine first quotes, add a curated view

Decided by Ciki on 2026-10-24 (16:22 CDT), after the read-only check of the 25 designed-clean documents (0 green:
8 waiting on a person, 4 need the Judge step, 11 first-version quotes blocked by the zero-record rule, 6 of those
also P6 false alarms, 2 paid invoices blocked by P7 because a person's confirmed approval is not recognised).
Task 016 (adding 108 clean documents) is cancelled; this replaces it.

Do this on top of the grouped commits of the existing work, so the full evaluation run (still running, pid 17838,
started on the pre-017 code) maps to a known commit. Do not stop or touch that process. No model calls, no eval
commands that call a model. `npm run eval:oracle` makes no model calls and is allowed. Do not commit 017 until
the hub session has checked it.

## 1. A person's confirmed approval must count (bug)
The judgment form saves cards without `facets`, and `approvals()` only counts cards with `approval.status`
(`src/engine/docs.ts:108`, `src/review/judgments.ts:126`). When a person judges a record as the client's approval,
the card must carry `approval.status` (and whatever facets the form's chosen topic implies), so P7 and the other
detectors see it. Test: a person confirms the approval behind INV-OC-01 / INV-OC-04 (in a temp copy) and P7 no
longer fires on them.

## 2. P6 needs at least 3 approved documents of that client
Structural norms are inferred from 1–2 earlier approved quotes today, which flags normal quotes. Require at least
3 approved documents of the client before judging structure (same spirit as Ciki's 10/22 rule: no amount norm
with fewer than 2 same-trade documents). With fewer, P6 says nothing about structure (no warning), and the check
page can say "not enough history to judge this client's usual structure".

## 3. First-version quotes: clear against client rules and norms
Task 014 made "zero records before this document" `not_cleared`. That blocks every first-version quote, since a
job has no records before its first quote. Refine it:
- If the job has no records yet but the client-level checks ran on enough history (client rules on file, and the
  client norm checks had the history they need) and nothing fired: `clear`, with the text
  "Clear — first quote on this job; checked against the client's rules and usual quotes only."
- If there is no client history either: stay `not_cleared` ("nothing on file to check it against").
- A spot-check or unjudged record by the cut-off still blocks, as in 014.

## 4. Curated view
In the outbox, a view switch "All documents" / "Curated: one example per problem + all clean documents". The curated
set: for each pattern P1–P7 one representative problem document (pick the clearest from the gold questions; list
your picks and why), plus the 25 designed-clean documents. Label it on screen as curated. The default stays
"All documents". Totals in each view match the API.

## Done when
1. Tests for 1–3 (including: a first quote with client rules and enough history clears; one without client
   history does not; P6 with 2 approved documents does not warn, with 3 it does when the structure differs).
2. `npm run typecheck` clean, `npm test` all pass.
3. `npm run eval:oracle` still 80/80. If it drops, stop and report which questions and why; do not adjust gold.
4. Before/after table for all 58 documents and for the 25 designed-clean ones (count and money per state).
5. Browser check of the curated view and of one first quote that now clears. Diff stat. Do not commit.
