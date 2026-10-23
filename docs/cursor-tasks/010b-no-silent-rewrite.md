# Task 010b — Never silently rewrite a human judgment

Everything below the line is the task. Do step 0 first and report it.

---

## 0. Commit Task 010 and Ciki's re-judgments (Ciki approved, 2026-10-23 08:58 CDT)

Commit the Task 010 code (effective date, four types, open question, "Nothing to keep", several cards, history) and `review/judgments.jsonl` (now 10 lines: her 5 first judgments + 5 re-judgments; append-only, nothing edited) and this card, as Conventional Commits, e.g. `feat(review): effective date, open questions and history in the judgment form` and `docs(review): Ciki re-judges WO-NL-01 with the new form`. Nothing from `.env`/`cache/`/`state/`/`logs/`. Check `-0500`; paste `git log -3 --format='%ai %h %s'`.

## Why (reviewer, 2026-10-23 08:5x CDT)

Ciki's re-judgments work end to end: Q-NL-01-v3 and INV-NL-01 are "Not cleared" and list her four open questions; rec-0017's $98 card is effective from 2026-05-01.

But the engine silently changes two of her cards. `applyDeciderCheck` (`src/engine/vocab.ts`) turns a `decides` card from someone outside `deciders[topic]` into `mentions` and only emits a trace event:
- rec-0006: she chose Decision, decided_by Mira Kell (estimator), topic scope → the engine uses **mentions**;
- rec-0284: she chose Decision, decided_by Delia Vorn (operations manager), topic client_rule → the engine uses **mentions**.
The confirmed view still says "Decision". What the screen shows and what the system uses differ — the exact kind of silent rewrite the project exists to prevent. The rule itself is right (a contractor can only propose); hiding it is not.

## Build

1. **Before submit**: on each quote row, when Type = Decision and the chosen person is not in `deciders[topic]` for the chosen topic, show inline, in the row: "<name> is not a client decider for <topic>. The system will read this card as Mentions. Choose Promise / open item, or Mentions — or keep it, and it will be shown as Mentions." Offer one-click buttons for Promise / open item and Mentions. Do not block submission. Same check in `validateJudgment` as a returned warning (not an error), and the API response carries it.
2. **Stored and shown honestly**: keep what the reviewer chose (`mode` as submitted) in `review/judgments.jsonl`; on the human card add `mode_used` (what the engine applies) when it differs. The confirmed view shows "Decision → used as Mentions (Mira Kell is not a client decider for scope)". The check's evidence lines show `mode_used`.
3. **"Has a question" help line**: "Blocks this job's documents from Clear until it is answered. Use it for a gap that could change this document's result."
4. Tests (no network): a Decision by a non-decider returns the warning, is stored as submitted, and loads with `mode_used: "mentions"`; the confirmed view data carries both; a Decision by a listed decider has no warning and no `mode_used`.

## Do not

- Call any model. Install packages. Edit gold, data, vocab, `RULES`, or any existing line of `review/judgments.jsonl`. Read `.env`.
- Change the decider rule itself.
- Commit the 010b code; Ciki checks it on screen first.

## Done when

- Step 0 `git log` lines.
- typecheck + tests.
- Server restarted at http://127.0.0.1:8095/; tell the reviewer.
