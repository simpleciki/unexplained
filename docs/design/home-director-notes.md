# 导演稿 — home: "the call" (WO-NL-01)

Length ≈ 26 s, loops on the home page; plays once when recorded (`window.__recording`). 1920×1080 composition, also fits 1440×900.
Backend: single HTML, vanilla JS + SVG, pure `render(t)` with `window.__seek(t)`, `window.__ready` on the first tick. No external engine.

## Hero elements (persist across the whole piece — no scene cuts)
1. **The line**: one SVG path running left → right in time, between the contractor's side (bottom-left) and the client's side (top-right). Its vertical position is the price; it is drawn progressively ("flows") as time passes. Amplitude = how unsettled the deal is: big swings early, calm near the end, a straight line after the invoice is paid.
2. **Two people**: Mira Kell (estimator, Harbor & Wick) bottom-left; Ria Moth (client reviewer, North Loft Holdings) top-right. Simple abstract avatars (initial in a circle + a handset glyph drawn in SVG), not illustrated people.
3. **Price tag** riding the head of the line: $1,804 → $1,988 → $2,156, counting up with a spring.
4. **Gatekeeper marks**: small round marks that land on the line at the moment the product notices something.

## Beats (t in seconds)
| t | Line / price | Mira says (left bubble) | Ria says (right bubble) | Gatekeeper mark |
|---|---|---|---|---|
| 0–2 | line starts at Mira, price $1,804 | 4 Mar — "Built v1 on the usual North Loft electrical split." | — | — |
| 2–5 | wave crosses to Ria | — | 5 Mar — "Approved as sent at $92 an hour. Do not add trip fees." | ✓ Client rule noted: no trip fees |
| 5–8 | wave swings | 6 Mar — "Once he opens the gutter we'll see if the studio riser needs its own isolated ground. I'll tell you either way before we requote." | — | ● Promise opened |
| 8–10 | | — | 10 Mar — "Anything over $2500 needs a one-line note from me before you submit. No exceptions." | ✓ Rule noted: over $2,500 needs a note |
| 10–13 | price springs to $1,988 | 11–12 Mar — Cal: "Studio riser does need an isolated ground. About two hours of labor." → v2 $1,988 | — | ✓ Promise closed (Cal, 11 Mar) |
| 13–15 | | — | 13 Mar — "Ok on the extra ground hours. Approved." | |
| 15–18 | price springs to $2,156 | 16 Mar — Inspector wants a surge device → v3 $2,156 | — | ✓ $2,156 is under the $2,500 cap |
| 18–21 | amplitude collapses | — | 17 Mar (call) — "Q-NL-01-v3 is approved now that the surge device is on the quote." | ⏱ Said 17 Mar, written 20 Mar — dated to the call |
| 21–24 | line goes straight | 3 Apr — Invoice $2,156 | — | ✓ Invoice matches approved v3 |
| 24–26 | hold | "Agreed · $2,156 · paid" centred under the straight line; below in small text: "Every turn on the record. Nothing lost." + link "Not every call ends like this → Heron Court" | | |

## Visual density clause
- At any moment the frame shows: both people, the line drawn so far, the current price tag, at most ONE bubble per side (the previous one fades to 35% and shrinks into the line as a dot with a date), and all gatekeeper marks so far. Never an empty frame; never more than two live bubbles.
- Typography: SF Pro (system) — display 44px for the price, 20px for bubbles, 13px for dates; tabular figures for money.
- Colour: light background (#F5F5F7), ink #1D1D1F, Mira's side neutral graphite, Ria's side system blue (#0A84FF) for her words, gatekeeper marks green (#30D158) for "noted/closed", amber (#FF9F0A) for "open"/"two clocks". No gradients, no emoji.
- Motion: spring easing for the price and bubbles (overshoot ~6%), line drawn with stroke-dashoffset at constant speed, marks pop with a 120 ms scale 0.6→1.

## Acceptance frames
0.0 s (Mira + start of line + $1,804) · 4.0 s (Ria's first bubble) · 11.5 s ($1,988, promise closed) · 19.5 s (two-clocks mark) · 25.0 s (straight line + "Agreed").
