# Task 010 — The judgment form must not lose what the reviewer knows

Everything below the line is the task. Do step 0 first and report it.

---

## 0. Commit Task 009 (Ciki approved, 2026-10-23 08:20 CDT)

Commit Part A + Part B + the verdict/clock round as Conventional Commits (for example `feat(review): ledger, review queue and human judgments` and `feat(ui): gatekeeper screen with a not-cleared verdict`). Also commit:
- `review/judgments.jsonl` — Ciki's first 5 judgments (reviewer data, invented records; it is evidence of the loop, not gold);
- `docs/cursor-tasks/009-no-truth-lost.md` and this card;
- `.claude/launch.json`.
Nothing under `.env`, `cache/`, `state/`, `logs/` staged. Check the `-0500` offset; paste `git log -4 --format='%ai %h %s'`.

## Why (reviewer, after reading Ciki's 5 judgments on WO-NL-01)

Her reasons are good — every one says why. The form lost part of what she knew:

| record | her judgment | what she knew (from her reason) | what the form kept |
|---|---|---|---|
| rec-0017 "Electrical labor … $98 per hour from 1 May 2026. Leave material pricing as already approved." | decides, $98 sentence | "$98 applies from 5/1; this order is 4/8, so the current rate applies" | **effective = the message time (4/8)** — `src/review/judgments.ts` sets `decided_at` and `effective` to `rec.source_recorded_at`. The engine would apply $98 from 4/8: the opposite of her judgment. The second decision (material stays) is in her reason but has no card. |
| rec-0006 "…I'll tell you either way before we requote." | no decision | an open question: was the gutter opened, does the riser need its own ground | nothing — the form has no "promise / open item" path, so a promise became "no decision" |
| rec-0011 "Ok on the extra ground hours. Approved." | no decision | approved, but the number of hours is not stated | nothing — "approved with a gap" became "not approved" |

Under the project principle (no truth lost), "No decision here" must not be the easy exit for anything uncertain.

## Build

1. **Effective date per card.**
   - Each quote row gets "Effective from" (date, optional time), prefilled by running the existing time-phrase parser (`src/engine/timephrase.ts`) on the selected words; if the quote has no time phrase, prefill the record's time. Show where the prefill came from ("from the words '1 May 2026'" / "the message time").
   - The reviewer can change it. Store it on the human card (`effective`, ISO with the record's offset). `decided_at` stays the record time (when it was said).
   - `applyJudgments` uses the card's `effective` when present; old judgments without it keep the record time (backward compatible).
   - The confirmed view shows "effective from …".
2. **Four types in plain words**, as a choice on each quote row, each with one line of help and one invented example (reuse the invented examples from the Researcher prompt; nothing copied from `data/records/`):
   - Decision (`decides`) — the client approves, rejects, or sets/withdraws a rule; also a client decision someone else logged.
   - Reason (`gives_reason`) — why: why rejected, why a price changed, why something is needed.
   - Promise / open item (`proposes`) — something someone will do or find out later.
   - Mentions (`mentions`) — refers to an existing practice, decision or state without making a new one.
3. **"Has a question"** on each quote row: an optional text. The card is kept AND the question is stored (`open_question`). In the check, an open question on a record before the cut-off is an open item: the verdict cannot be "Clear", and the note says "Open question (Ciki, 10/23): <text>". Resolving it = a new judgment for that record without the question (append; latest wins).
4. **"Nothing to keep in this record"** replaces "No decision here", placed last, with one line under it: "Use this only when the record holds no decision, reason, promise or reference."
5. **Several cards per record**: under the record text, "Select more words for another card — one record can hold several decisions." After the first selection, keep that hint visible.
6. **History in the confirmed view**: when a judgment supersedes an earlier one, show "replaces the judgment of <date>: <verdict / types>" — traceability is part of the demo.
7. Tests (no network): a rec-0017-shaped quote ("… from 1 May 2026") prefills 1 May and the human card carries it; an edited effective date is stored; an old judgment without `effective` still loads with the record time; an `open_question` keeps the card and turns a would-be Clear into Not cleared with the note; a judgment with two quote rows creates two cards; the superseded history is returned by the API.

## Do not

- Call any model. Install packages. Edit gold, data, vocab or `RULES`. Read `.env`.
- Edit or delete lines in `review/judgments.jsonl` — it is append-only; Ciki will re-judge rec-0006, rec-0011 and rec-0017 herself.
- Commit the Task 010 code; Ciki checks it on screen first.

## Done when

- Step 0 `git log` lines.
- typecheck + tests.
- Server restarted at http://127.0.0.1:8095/; tell the reviewer, who checks it in a browser before Ciki re-judges.
