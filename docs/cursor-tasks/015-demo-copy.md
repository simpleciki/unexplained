# Task 015 — Demo mode: judge on an isolated copy, watch one document turn green

Decided by Ciki on 2026-10-24 (10:16 CDT): the demo shows a person spot-checking a document and the document
turning green, on an isolated copy. The real `review/judgments.jsonl` is never written by the demo.

Why: after Task 014 no real document is green until a person spot-checks it (0 of 58). The demo has to show the
other half of "no truth is silently lost": once a person checks what the model could not, the document clears.

Scope: the UI server and pages (`src/ui/*`, `src/cli/ui.ts`), their tests, `.gitignore`. Do not touch `src/eval/*`,
gold data, scoring, or `review/judgments.jsonl` itself. No model calls, no eval commands; do not touch the running
`eval-compare --subset full` process. Do not commit.

## Change
- A demo mode, e.g. `npm run ui -- --demo` (pick the flag name that fits `src/cli/args.ts`). On start it copies
  `review/judgments.jsonl` (and any other file the judgment form writes) into a fresh demo directory that git
  ignores, and every write in that run goes to the copy. The normal `npm run ui` is unchanged.
- The page says it is a demo copy, plainly and visibly on every page (e.g. a small "Demo copy — judgments here are
  not saved to the record" label). It must be honest on screen, since it will be in the video.
- A way to start the demo over from the real file (restart is enough; a reset endpoint is optional).

## Done when
1. Tests: in demo mode a judgment is written to the copy and not to the real file; normal mode is unchanged.
2. `npm run typecheck` clean, `npm test` all pass (counts).
3. Live check with `npm run ui -- --demo` on 8095: spot-check `INV-RM-03` (one record the model read as empty)
   through the existing form so it turns Clear; the outbox totals move by that document; then do the same for
   `Q-OC-05-v1` if it also clears. Report what the person had to fill in and how many clicks it took.
4. `shasum -a 256 review/judgments.jsonl` printed before and after the live check: identical.
5. Stop the server after the check. Report the diff stat. Do not commit.
