# Task 026 — "The call" for WO-PW-05: the video's opening

Decided by Ciki on 2026-10-26: the demo video opens with the home page's "call" animation, told for WO-PW-05 (Heron
Court): three quote versions, three rejections, no reason given, ending on $2,306 on hold. The existing WO-NL-01 call
(agreed, invoice paid) closes the video. No model calls. Do not change the engine, gold, scoring or judgments. Do not
edit README.md. Do not commit.

## 1. The story
`data/stories/WO-PW-05.json` in the same format as `WO-NL-01.json`: contractor (Mira Kell or whoever wrote the quotes)
and client (Otto Gell, Pike Water). Events in date order, each text the **exact words** of its record, picked from the
WO-PW-05 records: the 30 April promise to scope the drain line, the v1 quote sent, "Not approving this one.", the v2
quote ($1,626), "Not this version either.", the v3 quote ($2,026), "Rejected.", and the unbilled stop-gap note if it
fits. Prices on the quote events. Marks where they help ("Promise opened", "No reason given"). Keep it short enough for
about 15 seconds of animation.

## 2. An ending that is not an invoice
WO-PW-05 has no invoice. Add an ending kind for a job on hold, e.g. `{"kind": "on_hold"}`, whose numbers come from
`eval/demo/hero_case.json` (`held_usd` $2,306 = $280 unbilled + $2,026 on hold; 53 days; 3 versions; 0 reasons written),
shown as "3 versions · 0 reasons · $2,306 on hold" in the same type style as "Agreed · $2,156 · invoice paid", the
price line staying unsettled (no green flat line). `validateStory` checks these numbers against `hero_case.json` and the
records, as it checks the invoice today; a wrong number refuses to serve.

## 3. Choosing the story
`/?story=WO-PW-05` plays it; `/` stays WO-NL-01. `window.__seek(t)` and the recording mode work the same for both.

## Done when
typecheck clean, tests pass (a validation test for the new story and the on-hold ending, including a wrong number being
refused), and screenshots at three frames of `/?story=WO-PW-05` (after v1's rejection, after v3's rejection, the ending)
plus one of `/` unchanged. Stop the server. Diff stat. Do not commit.
