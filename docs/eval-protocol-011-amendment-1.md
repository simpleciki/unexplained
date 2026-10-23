# Evaluation protocol 011 — Amendment 1 (2026-10-23, before any A/C run)

Amends `docs/eval-protocol-011.md` (commit 0d8bc73). That file is left unchanged, as it requires ("any later
change is a new, dated protocol file, never an edit of this one"); this file is read together with it.

## The change

In "Outcomes", the `unscorable` rule for group C becomes:

> C — the Router had no usable reply (prose after retries, upstream failure or invalid shape), **or an
> upstream failure in any later step of C's answer path (Judge, Explainer, Skeptic) leaves no answer to
> score.**

This mirrors group A, whose single call already counts an upstream failure as `unscorable`. Everything else
in the protocol is unchanged.

## Why it was added

Found while building `eval:compare`: when the model service fails inside a later step of C's answer path,
the run has no answer for that question at all, so it can be neither right nor wrong. The original text named
only the Router for C. The builder flagged the gap instead of handling it silently; the reviewer approved
this amendment.

## When

Written and committed on 2026-10-23 at 09:31 CDT (America/Chicago), before any A/C run: no
`eval/results/compare-*.json` existed when it was written, and no comparison had been run.
