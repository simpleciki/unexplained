# 027 — One step to fix, at the top of the check page

Decided with Ciki on 2026-10-26 (12:42 CDT). Why: she is the target user, and her test of the product was "I don't feel I'd have to use it". What she wants from a helper is a quote that is right the first time, and, when the client pushes back, the one correct change, fast. The check names the problem and shows the records; the last step, what to change, is still left to the person. This card adds that step.

## What to build
1. **A one-step fix for every warning that fired**, built from the evidence the detector already holds (`Flag.details`, `Flag.evidence`, the sentences in `src/ui/findings.ts`). No model call. Every name, date, amount and quote in a fix comes from the records; a fix cites the record(s) it rests on, as the findings already do.
2. **Warnings first.** On the check page (`src/ui/index.html` check view), the red "Fix before sending" box lists each fired pattern as: pattern id and name, then its one-step fix, then a link to its evidence. The caveats now in that box (records not judged yet, records read as empty, P2 not run) move under the warnings. "Triggered rules" detail and "What this client told us before" (H-MEM) come after. Nothing is removed.
3. If a fix needs a detail the flag does not carry, show no fix line for that warning (the warning and its evidence still show). Never fill a gap with generic advice that looks specific.

## The fix wording, per pattern (approved by Ciki, 2026-10-26 12:42)
Fill the brackets from the flag; keep the wording otherwise. English, as the UI.

| Pattern | One-step fix |
|---|---|
| P1 A promise never closed | Before sending: send [client person] the result of [what was promised] that [who] promised on [date], or add one line to the cover note saying it is still pending and when it will be done. |
| P2 Unexplained change between versions | Add a change note: what changed since [previous version] and why ([total change], [lines added / removed]). Only when the Judge step has run and P2 fired. |
| P3 Going in circles | Don't send another version yet. Close the open item first: [the open item, quoted]. |
| P4 A client rule still in force is broken | [What the rule requires, from the rule's own words]: e.g. "This quote is over $2,500: attach the one-line note [client person] asked for on [date] before you submit." |
| P5 Rejection blamed on price by default | Don't cut the price yet. Ask [client person] which it was: [the inferred causes P5 already lists, joined with "or"]. |
| P6 Off the client's normal structure | Restructure to this client's usual shape: [the usual structure the detector found]. Check unit prices against the company's standard price list. (There is no price list in `data/`; that second sentence is a reminder with no citation. Say nothing else about prices.) |
| P7 Invoice does not match what was approved | Get written approval from [client person] for the difference ([amount]) before invoicing. (Ciki: do not suggest invoicing the approved version instead; the client must confirm first.) |

## Acceptance
- `src/ui/findings.test.ts` (or a new `fix` test file): one test per pattern that has a fired example in the data, checking the exact fix text on a named document (Q-PW-05-v2 for P1 and P5; find real documents for P4, P6, P7, and P3 if one fires; P2 only if a fixture with a Judge result exists). One test that a flag missing a needed detail gets no fix line.
- No verdict changes: `npm run eval:oracle -- --source files` still 80/80 (restore `eval/results/oracle.json` afterwards with `git checkout -- eval/results`), `npm run value:metrics -- --out /tmp/v.json` prints the same numbers as `eval/results/value-metrics.json`, `npm run demo:sample-day` still ends at 3 / 1 / 6.
- `npm test` and `npm run typecheck` pass.
- Check in the browser (`npm run ui -- --demo`, open Q-PW-05-v2, Q-NL-03-v1 and one document per other fired pattern): the warnings and their fixes are the first thing in the check view, no horizontal scroll at 1920x1080.

## Boundaries
No model call. Do not change detectors, verdicts, the seat table, H-MEM or evaluation code. Do not touch README.md, evidence/ or eval/results/. Do not commit; report the diff and the outputs to the hub session.
