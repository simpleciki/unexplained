# Value metrics — Amendment 1 (2026-10-25, before computing)

Amends `docs/value-metrics.md` (commit `36483de`), read together with it; that file is not edited. Decided with
Ciki on 2026-10-25 (07:32 CDT): "Not cleared" reads as a wall of blocked documents, while most of them wait on one
or two confirmations by a person. This amendment adds a count of that work and fixes how the home page's sample
day is drawn. No rule of the check changes: a document that is not cleared stays not cleared.

## 4. What a person has to confirm

For every document whose state is `not_cleared`, with records up to its cut-off, one **item** is each of:
- a record routed to a person and not yet judged (`needs_human`);
- a record the model read as empty and no person has spot-checked;
- an open question a person left on a card they kept;
- a first quote with nothing to check it against (no job records and not enough client history): one item,
  "confirm this first quote".

A pattern that needs the Judge model step (P2) is not a person's item; count those documents separately.
Documents in state `warnings` are not counted here; they need a fix, not a confirmation, and are reported as such.

Report: total items over all 58 documents; over the 25 designed-clean documents; per not-cleared document the
median, range and distribution (how many documents need 1, 2, 3, more); and the same split by designed outcome.
Clicks in the interface are measured separately in the demo and reported as observed, not as part of this count.

## 5. The sample day on the home page

"Today's outbox" shows 10 documents: 2 drawn from the 33 designed-problem documents and 8 from the 25
designed-clean ones (the builder's estimate: about 2 in 10 quotes have a problem). The draw is uniform without
replacement, with a fixed seed `20261027`, over each list sorted by document id, using a seeded PRNG written in the
code. The rule is fixed here before the draw is run; the picked documents are not swapped afterwards. The page says
so on screen ("A sample day: 10 documents, drawn at random at the builder's 2-in-10 ratio. See all 58."). All
documents stay one click away.
