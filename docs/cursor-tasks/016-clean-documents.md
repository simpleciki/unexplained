# Task 016 — Add clean documents at a realistic ratio, then measure honestly

Decided by Ciki on 2026-10-24 (10:20 CDT): in her real work about 2 in 10 quotes have a problem (rejected, needs
changes, breaks a client rule). Our data has the opposite mix (35 of 58 documents warn), because it was built to
plant test cases. A gatekeeper in real use mostly sees clean documents, so the data gets clean documents added at
that ratio, and the check is measured on them as it is.

**The line we do not cross**: clean documents are written as "what a normal job looks like" (approved as sent,
invoice matches the approved quote, ordinary chatter), not as "what makes our engine go green". Do not tune the
data to the detectors, and do not change any engine, detector or prompt in this task. If the engine raises false
alarms on clean documents, that is a finding to report, not something to fix here.

Scope: the data generator (`scripts/generate-data.ts` and what it writes in `data/`), `data/README.md`, the
README's data section. Do NOT change existing records, existing gold questions (`eval/gold/*`), the scoring, or
`review/judgments.jsonl`. Do not commit.

**Start only after the full evaluation run (`eval-compare --subset full`) has finished**; it reads `data/` and
`state/`. Do not start it again.

## Step 1 — count, then stop and report
- From the generator's own ground truth (not from engine output), count the documents designed to have a problem
  (P) and those designed clean. Target: problem documents ≈ 20% of all documents, so about 4 clean per problem
  document. Report P, the current clean count and how many clean documents to add.
- Estimate how many new records that means and how many model calls the ingest of only the new records will take
  (`--dry-run` or the ingest's own estimate). **Stop and report the numbers.** Ciki approves the call count before
  any model call; the ingest runs on `AI_PROVIDER=nvidia-direct` in Ciki's own terminal.

## Step 2 — after Ciki's go-ahead
- Generate the clean jobs under new fictional clients (at least 3, mixed trades), so no existing gold question can
  see them. Each job: a quote (some with a v2 the client approves), the client's approval in their own words, the
  invoice that matches the approved quote, and ordinary noise (scheduling, access, thanks) the way real jobs have it.
- `npm run validate:data` passes; `npm run eval:oracle` still scores 80/80 (no model calls).
- Zetaris: register the new rows and run parity (`zetaris:register --apply`, `zetaris:parity`); all tables match.
- Give Ciki the exact ingest command for the new records only; she runs it.

## Step 3 — measure and report
With the same no-model script as Task 014, report for the new clean documents:
- cleared with no person (green),
- false alarms (warnings on a clean document) — list each with the detector that fired,
- not cleared, waiting on a person to spot-check (and how many records that is),
and the overall before/after table for all documents (count and money per state).

Add one dated paragraph to `data/README.md` and the README: on 2026-10-24 N clean documents were added because the
original mix was about 60% problem documents; the ratio follows the builder's experience (about 2 in 10); results
before and after the addition are reported separately.

## Done when
Steps 1–3 reported; typecheck and tests pass; oracle 80/80; Zetaris parity all tables; diff stat; no commit.
