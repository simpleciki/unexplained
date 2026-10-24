# Task 012 — Bring the approved design into the real UI: "the call" home + the check page

Everything below the line is the task. Ciki approved both directions on 2026-10-23 at 10:18 CDT. Build in two parts; report after Part 1.

---

## Read first (all in this repo)
- `docs/design/direction-approved.md` — what was shown, Ciki's words verbatim, the mix she chose.
- `docs/design/home-director-notes.md` — beats, timing, visual density rules and acceptance frames for the home animation.
- `docs/design/home-prototype.html` — the approved home ("the call"): open it in a browser; `window.__seek(t)` freezes a frame. **This is the visual and motion reference.** Its content is a curated story of WO-NL-01; every bubble is an exact substring of a real record (ids in its `EVENTS`).
- `docs/design/detail-prototype.html` — the approved check page: C's visual language × A's three-column structure, Apple system feel. **Visual and layout reference.** It inlines four check snapshots; the real page must read the API.

Design system (from the prototypes, keep it): system font stack `-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Helvetica Neue", sans-serif`; tabular figures for money; background `#f5f5f7`; ink `#1d1d1f`; client blue `#0a63d1`; status colours only for status (red/amber/green); vibrancy sidebar (`backdrop-filter: saturate(180%) blur(20px)`); spring-like easing `cubic-bezier(.2,.8,.2,1)`; no gradients, no emoji, no all-caps eyebrow labels, no "01/02/03". Body ≥14px, labels ≥12px, contrast ≥4.5:1. Must look right at 1440×900 and 1920×1080 (the demo video is recorded from it). Still zero dependencies (the sandbox cannot reach npm) and the UI never calls a model.

## Part 1 — the check page (restyle what exists; keep every behaviour)
1. Restyle `src/ui/index.html` to the detail prototype: top bar (product name, Outbox / Needs you / Ledger, the live ledger line), the business-value strip (documents checked and dollars by verdict state — compute from the API, label them "checked", never "saved"), left vibrancy sidebar with jobs and their documents, centre = verdict card + triggered rules + the patterns that did not fire + document lines, right = evidence in time order (expandable source text) + "Needs your judgment".
2. **Keep everything from 009 / 010 / 010b**: the three verdict states, open questions blocking Clear, the judgment form (effective date prefill, four types with help, has-a-question, several cards, "Nothing to keep", decider warning with one-click fixes, `mode_used` arrows), history, "Judge this record again". The form opens as an Apple-style sheet/drawer from the right panel.
3. Two honesty fixes the reviewer found (API + UI + tests):
   - **Zero evidence is not "all judged"**: when a document's check saw 0 records before its cut-off (e.g. Q-OC-02-v1, `records.seen = 0`), the verdict text must not say "every record in this job is accounted for and judged". Use: "Clear — no records on file before this quote; nothing to check against." (invoice: "…before this invoice…").
   - **Records written after the document**: in the right panel, needs_human / spot-check records written after the document's cut-off are not counted in "Needs your judgment (N)". Show them in a separate, quieter section "Written after this document (N) — not part of this check". The count in the verdict notes and the panel must agree.
4. Tests: zero-evidence verdict text; after-cut-off records excluded from N and listed separately; existing UI/API tests still pass.

Report Part 1 (typecheck, tests, server restarted) and wait for the reviewer's go.

## Part 2 — the home: "the call"
1. `GET /api/story?job=WO-NL-01` returns the story the home plays: two people (contractor-side lead and client reviewer, from `meta`/people), and ordered events `{t-order, side, date (local, as written), who, record_ids, text, price?, version?, mark?}`.
   - For this task the story for **WO-NL-01** is curated: create `data/stories/WO-NL-01.json` from the prototype's `EVENTS` (same sentences, same record ids, same marks). Do not change the words.
   - **A test is the guarantee**: every `text` is an exact substring of one of its `record_ids`' text; every `record_id` exists and belongs to the job; every `price` equals the total of the quote version / invoice it names; dates match the records' local dates; the "said 17 Mar, written 20 Mar" mark matches a card whose `decided_at` and the record's `source_recorded_at` really differ by those dates. If any check fails, the endpoint returns 500 with the reason — never a silently wrong story.
   - Stretch (only if Part 2 is done and time remains): derive the story for any job from records + cards + check results; keep the curated file as the WO-NL-01 golden test.
2. `/` (home) plays the story exactly like the prototype: avatars in the Apple call style (initials, name, organisation, role, handset badge), the price line flowing node by node, one live bubble per side, gatekeeper marks that fold into icons, the price readout under the call, the ending where the line calms and turns green, "Agreed · $2,156 · invoice paid", and the link "Not every call ends like this — Heron Court" which opens the check page on Q-PW-05-v3. Keep the prototype's `render(t)` purity, `window.__seek`, `window.__ready`, `window.__recording`. Click replays. A quiet "Open the outbox" link leads to the check page.
3. Tests: the story endpoint validation above; the home page HTML contains no hard-coded record text (it must come from the API).

## Do not
- Call any model. Install packages. Edit gold, data/records, data/tables, vocab, `RULES`, `review/judgments.jsonl`. Read `.env`.
- Touch the Task 011 files (`src/eval/compare*.ts`, `src/eval/group-a.ts`, `src/cli/eval-compare.ts`, `src/agents/router.ts`, `src/cli/args.ts`, the 011 card) — they are uncommitted and waiting for Ciki's run.
- Commit. The reviewer checks it in a browser first; commits will be separate from 011.

## Done when
- Part 1 and Part 2 each reported with typecheck + test summary and the server restarted at http://127.0.0.1:8095/.
- A short list of anything in the prototypes you could not reproduce exactly, and why.
