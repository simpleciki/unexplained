# Task 013 — Home page: make the name and the outbox link visible

Two small visual fixes on `src/ui/home.html` only. No change to the story, the animation timing, the API or `/outbox`.
This lands in the same commit group as 012 (the home page is still uncommitted there).

## Why
- The product name "unexplained" reads like a caption (22px, same weight as the job line). A judge opening the page should see the name first.
- "Open the outbox" bottom-right is grey 16px text with no underline, arrow or shape. Nobody can tell it is clickable, and it is the only way into the check page.

## Change 1 — brand wordmark
- `.brand`: `top: 52px; font-size: 44px; font-weight: 700; letter-spacing: -.03em; display: flex; align-items: center; gap: 14px;`
- Add a glyph before the text: a 44x44 rounded square (`border-radius: 12px; background: var(--ink)`) holding a white wave stroke that echoes the price line:
  `<svg width="26" height="26" viewBox="0 0 26 26"><path d="M2 13c3-9 6-9 8 0s5 9 8 0 4-4 6-2" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/></svg>`
  Mark the glyph `aria-hidden="true"`; the text "unexplained" stays the accessible name.
- `.ctx`: `top: 112px; left: 154px; font-size: 18px;` (aligned under the word, not the glyph).

## Change 2 — outbox becomes a button-looking link
- Keep it an `<a href="/outbox" id="outbox">` (it navigates; it is not a form button).
- Text: `Open the outbox` followed by `<span class="arr" aria-hidden="true">→</span>`.
- `.outbox`: `bottom: 48px; display: inline-flex; align-items: center; gap: 10px; padding: 14px 22px 14px 26px; border-radius: 999px; background: var(--client); color: #fff; font-size: 18px; font-weight: 600; box-shadow: 0 1px 2px rgba(10,99,209,.25), 0 8px 24px rgba(10,99,209,.22); transition: transform .2s cubic-bezier(.2,.8,.2,1), box-shadow .2s;`
- `.outbox:hover`: `color: #fff; transform: translateY(-2px); box-shadow: 0 2px 4px rgba(10,99,209,.3), 0 14px 32px rgba(10,99,209,.3);` and `.outbox:hover .arr { transform: translateX(3px); }` (`.arr` gets `transition: transform .2s`).
- `.outbox:focus-visible`: `outline: 3px solid rgba(10,99,209,.45); outline-offset: 3px;`
- Inside `@media (prefers-reduced-motion: reduce)`: no transform on hover.
- If any script rewrites `#outbox` text or href, keep the arrow span.

## Done when
1. `npm run typecheck` and `npm test` pass (report counts).
2. `npm run ui`, open http://127.0.0.1:8095/ : at `window.__seek(6)` (mid-call) and `window.__seek(999)` (agreed) the button does not overlap a bubble, the price, or the "Heron Court" link; screenshot both.
3. Clicking the button opens `/outbox`.
4. Do not commit. Report the diff stat; Ciki groups the commit with 012.

Reference preview: the hub session injected exactly these styles into the running page on 2026-10-23 and screenshotted both frames; no overlaps seen.
