# unexplained

**Before a contractor's quote or invoice goes out, it reads it the way the client will, tells the contractor
what the client is going to push back on, and shows the records that prove it. When it is not sure, it says
so and asks a person. Nothing clears unless the records support it or a person signs off.**

Open Agent Hackathon 2026 · Track 02, *The Agent That Can Explain Why* · Zetaris + Meterless (Nightshift,
H-MEM) + NVIDIA Nemotron · all data in this repository is fictional (`data/README.md`).

**Demo video (2:11):** https://youtu.be/RcWYPKJifgM

> Numbers below are copied from the committed result files named next to them. Anything marked *estimate*
> comes from the builder's own work and was not measured here.

## In 60 seconds

**Who it is for.** The office of a repair contractor that sends quotes and invoices to property clients
through the client's portal: the estimator who writes the quote and the person who sends it.

**The problem.** A quote the client rejects is not one email. It starts a back-and-forth that can run for
weeks, payment slips by days or months, and costs can rise while the job waits. Over time the client starts
to wonder whether another contractor would be less work. The builder of this project does this job: in her
experience (*estimate*), of about 200–250 work orders a month, 15–20 quote disputes reach the last check,
and each takes 1.5–2 hours to piece together. More disputes are settled earlier, out of her sight.

**What it does.** Every outgoing document gets one of three answers on the check page:

| Answer | What the contractor sees |
|---|---|
| **Fix before sending** | the problem by name (one of seven patterns, below), the one step to fix it, and the records that prove it |
| **N left to confirm** | the few records the model could not be sure about, or a first quote to confirm against the client's history, shown in place; most take one click, an open question opens the judgment form |
| **Ready to send** | everything on file is accounted for |

**What we measured** on the 58 fictional documents (`eval/results/value-metrics.json`, definitions
pre-registered in `docs/value-metrics.md` before computing):

- **0 of 33 problem documents** would have gone out unchallenged. 27 were stopped with a named pattern and the
  evidence attached; 6 were stopped and handed to a person. (Whether the named pattern is the designed cause is
  not checked by this metric. The zero also assumes the person reads what they confirm: see *Known limits*.)
- For the 27 problem documents where it named a pattern, a person would go through a **median of 57 records**
  for the client and the job across two systems, or 12 for the job alone. The check cites a **median of 7**.
- The cost: of 25 clean documents, 3 were wrongly flagged and 21 still needed a person, a **median of 1 item**
  each. Only 1 cleared on its own. Section *Value, both sides* explains why.

**Try it** (no key, no Docker; see *Run it*):

```
npm ci
npm run ui -- --demo        # http://127.0.0.1:8095/outbox — judgments go to a throwaway copy
                            # http://127.0.0.1:8095/?story=WO-PW-05 — the job below, as a call
```

## One job, told forward: WO-PW-05

Heron Court, a roof drain rebuild for Pike Water. Three quote versions, three rejections, not one reason given. 53
days after the first quote, **$2,306** is on hold: a $280 stop-gap that was never billed and the latest
quote of $2,026 (`eval/demo/hero_case.json`, computed from the records by `scripts/hero-numbers.ts`).

| Version | What the check said before it was sent | What happened |
|---|---|---|
| v1, $761 | Not cleared: one record nobody had judged, one the model read as empty | Rejected: "Not approving this one." |
| v2, $1,626 | **Fix before sending.** P1: on 30 April the estimator promised to scope the drain line and report back; no report followed. Fix: send Otto the result, or say in the cover note it is still pending. P5: the client already rejected once and never said why. Fix: don't cut the price yet; ask Otto which cause it was | Rejected: "Not this version either." |
| v3, $2,026 | **Fix before sending.** The same two, now "rejected twice", plus +$865 and two new lines | Rejected: "Rejected." |

Before v2 went out, the contractor would have known the one thing to do first: report what the drain scope
found and ask the client why v1 was rejected, instead of sending a bigger quote into the same silence. We make no
claim about what the client would then have done; only about what the contractor would have known.

## The seven patterns

| | Pattern | What the client sees |
|---|---|---|
| P1 | A promise never closed | "You said you'd check that first. Did you?" |
| P2 | Unexplained change between versions | a price or line changed with no note to the client |
| P3 | Going in circles | new versions keep coming while the same open item makes no progress |
| P4 | A client rule still in force is broken | e.g. a pre-approval cap the client set months ago |
| P5 | Rejection blamed on price by default | a rejection with no reason given; the check lists every possible cause instead of assuming price |
| P6 | Off the client's normal structure | categories this client has never approved, or a structure unlike what it usually approves |
| P7 | Invoice does not match what was approved | billing a version that was never approved |

P6 judges a client's usual structure only after 3 approved quote versions; fixed portal categories are
checked regardless of history. P2 needs the Judge model step, which the check page does not run; it is
reported as open, never as passed.

## Value, both sides

From `eval/results/value-metrics.json` (code `802a58a`; definitions `docs/value-metrics.md`,
`docs/value-metrics-amendment-1.md`):

| 33 designed-problem documents | count | money |
|---|---|---|
| stopped, problem named with evidence | 27 | $41,266 |
| stopped, handed to a person | 6 | $3,881 |
| **let through** | **0** | **$0** |

| 25 designed-clean documents | count | money |
|---|---|---|
| wrongly flagged | 3 | $3,547 |
| need a person (median 1 item, range 1–7) | 21 | $27,562 |
| cleared on their own | 1 | $858 |

**Why so few clean documents clear on their own.** Two reasons. The model is not sure often enough: across all
documents, 26 items are records it read as empty that a person has not spot-checked, and 14 are records routed
to a person. And some documents need a person whatever the model does: 9 are first quotes with nothing on file
to check against, and 9 are open questions a person left. We chose to show these as a short to-do rather than
to let them pass. The outbox opens on *A
sample day*: 10 documents drawn at random at the builder's 2-in-10 ratio (seed `20261027`, fixed before the
draw). In the demo copy, confirming what a person can confirm takes 6 of those 10 to *Ready to send*
(`npm run demo:sample-day` replays exactly those confirmations on a throwaway copy and prints before and after). 3 are
*Fix before sending*: the 2 problem documents, and Q-NL-03-v1, a clean document wrongly flagged (P6). The one
left, Q-NL-01-v2, still holds two open questions, a P2 the Judge step has not run, and a record the model read
as empty that actually says *"Studio riser does need an isolated ground. About two hours of labor"*. That is
the reason for the spot-check.

**What these numbers cannot say.** The data is fictional and the problem documents were planted: 57% of
documents are problem documents, far above the builder's 2 in 10. 10 of the 33 "problem" documents are the last
version of a job still waiting for the client when the data ends. All numbers are in-sample: the detectors were
built on this same designed data; the metrics were defined after the last detector change and nothing was tuned
after computing them. No real user has used the tool, and time saved was not measured; the 1.5–2 hours is the
builder's estimate.

## Trust: no silent truth loss

The project's promise is not that it is always right. It is that nothing the records say is silently dropped,
and what it cannot judge goes to a person with the evidence. We measured why this matters: when the model read a
record and said "nothing here", it was wrong on **26 of 59** records (`docs/cursor-tasks/009-no-truth-lost.md`).
So a record the model read as empty never lets a document clear until a person has looked.

We also compared two ways to answer 80 gold questions with pre-registered rules
(`docs/eval-protocol-011.md` and two dated amendments): **A**, one model call that reads every record, and
**C**, this engine. Each answer is correct, confidently wrong, handed to a person, or unscorable.

| Run | Route | A: correct / wrong / to a person / unscorable | C: correct / wrong / to a person / unscorable |
|---|---|---|---|
| dev, 12 questions (`eval/results/compare-dev.json`) | Nightshift | 0 / 3 / 5 / 4 | 1 / 1 / 8 / 2 |
| full, 80 questions (`eval/results/compare-full.json`) | NVIDIA direct | 0 / 4 / 5 / 71 | 4 / 11 / 50 / 15 |

What this does and does not show:
- **Waving a problem through** (no warning where a P1–P7 warning was required, and the question not handed to a
  person): A did this once in each run, on the same question (a $2,500 pre-approval cap still in force). C never
  did, in either run. Counting every answer with no warning where one was required, including those handed to a
  person: A 5 in each run (4 handed to a person), C 0 in the dev run and 10 in the full run (all handed to a
  person). Time tags (which rate applies on a date) are not part of these counts, as the protocol says.
- **C's 11 wrong answers in the full run:** in 10, C raised every warning that was required and failed only
  because it could not cite the exact deciding record the rules require. One missed a warning.
- **Not shown: which is more accurate.** In the full run, 86 answers were prose instead of JSON (A's single
  call carries every record on file for the question, up to about 300), so A has only 9 scorable answers. The full run is reported as run, without
  re-runs, as the protocol requires; the two runs used different routes and are not pooled.

## Sponsor technology

- **Zetaris** is the data layer: the client portal and the contractor's job system stay two separate sources,
  registered in Zetaris with three cross-source views, two of which the engine reads: P5 and P7 findings show the
  matching cross-source view row as context. Ingest and the evaluations read through Zetaris by default (their
  Zetaris query traces are in `evidence/agent-activity/traces/`); the check page reads the same data from files by
  default so a judge can run it without Docker, and through Zetaris with `--source zetaris`. Live runs:
  `evidence/zetaris-live-check-2026-10-26.md` (one end-to-end request with Zetaris running, input and output shown)
  and `evidence/zetaris-parity-2026-10-25.txt` (16 tables and views identical through Zetaris and from files).
  Details below.
- **Meterless.** Nightshift (the Meterless Runtime) is the app's default AI provider: 713 successful calls went
  through it from 21 to 23 October, each with a signed compute receipt (summary without account data:
  `evidence/nightshift-receipts-summary.jsonl`); the committed ingest snapshot came through it. **H-MEM** is the memory:
  every accepted decision is written to it with its provenance, and the check page's *What this client told us
  before* panel is recalled from it. H-MEM does not decide the verdict. H-MEM is Meterless's Apache-2.0
  reference implementation, vendored unmodified at commit `1742dec` (`vendor/meterless-hmem/VENDOR.md`). Details below.
- **NVIDIA Nemotron** reads every record and writes the answers: `nemotron-3.5-lightning-30b-a3b` is pinned for
  every agent, with `nemotron-3-super-120b-a12b` as the configured fallback (not available to this account when
  called directly). Through Nightshift some calls were answered by `nemotron-3.5-super-vl-120b-a12b` instead;
  the trace records it. We never request `nemotron-3-ultra-550b-a55b`: in one ingest run it answered 61 extraction
  calls with a plan instead of JSON (`docs/cursor-tasks/006-prose-replies.md`). Nightshift's auto routing still
  answered with it: of the 713 receipts, 267 name super-vl-120b, 244 ultra-550b and 202 lightning-30b. We reported
  the substitution to Meterless on 23 October. The 80-question run sent every new call to NVIDIA directly, lightning
  only; 36 replies came from the cache, 8 of them answered earlier by super-vl through Nightshift. Every model call
  is in the trace with the model that actually answered.

**What is particular about how we use them.** Zetaris keeps the client portal and the contractor's job system as
two separate sources, as they are in real life, so a warning can cite a record from each side of the job. H-MEM's
recall is shown to the person, but checked against the decision table and never allowed to decide: a test runs
the check with an empty H-MEM store and gets the same verdicts. And every model answer, through Nightshift or
direct, is traced with the model that actually answered, which is how we caught and reported the ultra
substitution.

## Run it

**Dependencies.** Node 26 or later; `npm ci` installs the only packages, all for development: TypeScript, tsx,
vitest, @types/node (no runtime npm dependency). Vendored: Meterless H-MEM reference implementation (`vendor/`).
Optional, for live runs only: Docker with Zetaris 2.4.3.1 (the organisers' hackathon images, self-hosted),
Meterless Nightshift on `127.0.0.1:8088` with a runtime token, or an NVIDIA API key for the direct route.

**Data.** `data/` holds one fictional contractor's records (`data/README.md`): the client portal (clients, quote
versions and lines, submission events, invoices, client messages) and the contractor job system (work orders,
internal notes, field notes), 116 records across 18 jobs for 4 clients. `eval/gold/` holds the hand-written gold
cards and questions; `snapshot/ingest-2026-10-23/` holds the model's cards from one ingest, read-only.

```
npm ci
npm test                                 # 271 tests, no network
npm run eval:oracle -- --source files    # the detectors on gold cards, no model: 80/80
npm run value:metrics -- --out /tmp/value-metrics.json   # the value numbers above, no model
npm run ui -- --demo                     # the check page; judgments go to .demo/
```

**Fresh clone.** No key, `.env` or Docker is needed for any of the above. Without a local ingest (`state/`),
the check page and `value:metrics` read the committed, read-only snapshot `snapshot/ingest-2026-10-23/` and say
so on start; from it, `value:metrics` reproduces every number in `eval/results/value-metrics.json` (only the commit,
time and working-tree fields differ; a test checks this).
What was redacted from the snapshot before it was committed is listed in `snapshot/README.md`. `eval:oracle`
rewrites `eval/results/oracle.json` (only its run id and trace file name change); `git checkout -- eval/results` restores it.

With your own keys (model calls cost tokens): copy `.env.example` to `.env`, set `METERLESS_RUNTIME_TOKEN`
for Nightshift, or `AI_PROVIDER=nvidia-direct` with `NVIDIA_API_KEY`; then `npm run ingest -- --max-calls 300`.
Every command that can call a model requires `--max-calls` and prints a dry-run estimate first, except
`npm run smoke:runtime`, a one-call connection check.

## How it was built

One builder, with Claude Code as the coding tool (the organisers made Cursor optional in their 22 October
announcement). Work went through written task cards, each with acceptance checks; they sit in
`docs/cursor-tasks/` because Cursor was the planned tool when the folder was made. The
A-vs-C protocol, its two amendments and the value-metric definitions were each committed before the result
they govern (`git log --format='%h %ai %s' -- docs/eval-protocol-011*.md docs/value-metrics*.md eval/results/`);
the A-vs-C code itself was committed with the dev result, after the dev run, and `compare-full.json` lists only
the base protocol and amendment 1 in its protocol field although amendment 2 governs it. The pain points come from the builder's own work as a
contractor-side bookkeeper; no employer, client or real record is in this repository.

**Agent activity log.** Every model call is one trace line in `logs/`, with the model that actually answered.
`evidence/agent-activity/` holds two of those traces as the runs wrote them, with the Zetaris query traces that fed
the same runs, and walks three questions on WO-PW-05 from the first model call to the scored answer, and one record
from extraction to decision card. For one input and output of the check itself (quote in; warnings, one-step fixes
and evidence out) with Zetaris running, see `evidence/zetaris-live-check-2026-10-26.md`.

## Known limits

- Fictional data, problem documents over-represented, no real user.
- Model extraction recall is the weak point; it is why most clean documents still need a person.
- A person's confirmation is trusted. "Looks fine" on a record the model read as empty clears that record, so
  the "0 let through" holds only if the person reads it. Example: on Heron Court, `rec-0254` ("Voided Heron
  Court v1, the strainer line had the wrong bowl size") gives a reason the client was never told; the model
  produced no card from it, so it waits for a person, and a careless click would wave it through.
- P2 needs the Judge model step, not run on the check page.
- On the gold cards (perfect extraction), the detectors raise 19 warnings beyond those required; P1 is the
  noisiest (`eval/results/oracle.json`).
- We tried to make extraction faster by turning Nemotron's thinking off (pre-registered in
  `docs/extraction-run-2.md`). It was 20 times faster (median 1.3 s per call instead of 26.4 s) with no prose or
  failed replies, but read worse: precision 0.269 instead of 0.438, recall 0.21 instead of 0.32 against the gold
  cards. By the rule fixed before the run, the cards from the 2026-10-23 ingest stay (`evidence/extraction-run-2.txt`).
- We then tried a second, targeted read of the 69 records that produced no card, thinking on (pre-registered in
  `docs/extraction-run-3.md`). It kept 3 new cards, but 30 of the 69 replies came back as prose, and precision fell
  to 0.421 (recall stayed 0.32). By the same rule, the 2026-10-23 cards stay (`evidence/extraction-run-3.txt`).
- The full A-vs-C run cannot rank accuracy (see *Trust*).

## Technical details

### Model runtime

Nightshift, the Meterless Runtime on `127.0.0.1:8088` (`src/llm/meterless.ts`), is the default and
primary provider. `AI_PROVIDER=nvidia-direct` is an explicit second route straight to NVIDIA's endpoint
(`src/llm/nvidia-direct.ts`, key from `NVIDIA_API_KEY`, model `nvidia/nemotron-3.5-lightning-30b-a3b`). It
was added after Nightshift 1.2.1 routed our pinned models to an NVIDIA function this account cannot use and
Nightshift 1.2.2 stopped long requests before their first token, and the full evaluation run uses it (see `docs/eval-protocol-011-amendment-2.md`). Meterless
confirmed in its public help channel on 23 October that calling NVIDIA directly is fine. Either way,
cached replies are reused, and each trace event since 24 October says which route answered (`nightshift`,
`nvidia-direct`, or `cache` for a reused reply); the 23 October ingest trace predates this field. The routing
and pinning below apply to Nightshift.

Routing. Each agent's request carries a Meterless routing mode (`meterless/auto` or `meterless/deep`), used as
its cache key. What is actually sent is the pinned order below. When a pinned model is retired or not allowed
for this account, the client moves to the next entry in that order, keeps the one that works for the rest of
the run, and remembers dead entries for 6 hours in `state/dead-modes.json`. (A seven-mode fallback list exists
in `src/llm/modes.ts` for when no order is set; the CLI always sets one.) `meterless/local` and the image,
video, speech and other media modes are never used.

Pinning. Nightshift's auto router has picked a retired NVIDIA model, so runs pin the upstream model.
By default every agent uses `nvidia/nemotron-3.5-lightning-30b-a3b`, then
`nvidia/nemotron-3-super-120b-a12b` as the fallback; `nvidia/nemotron-3-ultra-550b-a55b` is never used,
pinned or as a fallback. The order comes from the extraction replies of one ingest run on 2026-10-22 that
were a numbered plan instead of JSON: ultra-550b 61 such replies, lightning 4 of 31
(`docs/cursor-tasks/006-prose-replies.md`), super-vl 8 of 16.
`METERLESS_MODE_ORDER` (a comma list of routing modes or NVIDIA model ids) overrides the default; the
entries go to the same runtime endpoint with the same headers.

```
npm run ingest -- --max-calls 300
```

### Data layer: Zetaris

The evidence lives in two separate systems: the **client portal** (clients, quote versions and lines,
submission events, invoices and lines, client messages) and the **contractor job system** (work orders,
internal notes, field notes). `npm run sources:serve` serves both, read-only, on `127.0.0.1` (port
`SOURCE_PORT`, default 8790); Zetaris registers them as two Lightning databases (`CLIENT_PORTAL`,
`CONTRACTOR_OPS`) of REST tables, flattens each into a SchemaStore view in the `unexplained` container,
and adds three cross-source views (`v_quotes_by_trade`, `v_invoice_vs_approved`,
`v_job_evidence_timeline`). `ingest`, `ask`, `eval:live` and `eval:oracle` read through Zetaris by
default (`--source zetaris`); `npm run zetaris:parity` checks every table and the two cross-source
views the engine reads against `data/`. If Zetaris is unreachable the run fails loudly, it never falls back to files.

To run against Zetaris: start a self-hosted Zetaris (Docker, as in the organisers' setup guide); put
`ZETARIS_URL`, `ZETARIS_USERNAME` and `ZETARIS_PASSWORD` in `.env`; then `npm run sources:serve` (the two
source systems), `npm run zetaris:register -- --apply` (registers both sources and the views; without
`--apply` it only prints the SQL) and `npm run zetaris:parity`. To see the check page on live Zetaris data:
`npm run ui -- --source zetaris` (no model call). Committed live runs: `evidence/zetaris-live-check-2026-10-26.md`
and `evidence/zetaris-parity-2026-10-25.txt`.
The engine uses the cross-source views directly: P7 (invoice vs approved version) shows the
`v_invoice_vs_approved` row for the invoice, and P5 (unexplained rejection) shows the job's
`v_job_evidence_timeline` across both systems. Which version was approved on a date is still worked out
from dated records; the view's approval column is end-of-period state, shown for context only.

`--source files` reads `data/` directly (the views are computed in memory), without Docker or a Zetaris install.

Every command that can call a model needs `--max-calls N`, prints a dry-run estimate first
(`--dry-run` stops there), caches only replies that passed their schema, and writes a trace to `logs/`
with the model that actually answered. The runtime token is read from `.env`
(`METERLESS_RUNTIME_TOKEN`, see `.env.example`) and is never printed.

### Memory: Meterless H-MEM

**What is written.** Every accepted card (model or person) is written into H-MEM with its provenance:
the exact quote, the source record, when it was learned, and the card id (`src/engine/memory.ts`). H-MEM
also guesses on its own which memory supersedes which, from the wording. Those guesses are checked against
the seat table, which is the authority. Every override is logged in H-MEM's trust ledger, and every
remaining drift is reported. `npm run ingest` saves the store to `state/hmem-snapshot.json`
(`saveState` in `src/engine/engine.ts`) for inspection; the engine rebuilds H-MEM from the cards on every start
and does not read that file back. The no-model oracle saves its own copy under `eval/results/oracle-state/`.

**What is read.** The check page's "What this client told us before" panel (`src/ui/client-memory.ts`,
called from `src/ui/api.ts`). For the document's client, it recalls with H-MEM's own `query()`, with no
score threshold and no top-N cut, so a relevance score never drops anything. It then keeps memories that:
- belong to this client or one of its work orders,
- were learned by the document's cut-off, with the source record written by then,
- are not superseded by a memory learned by the cut-off.

Every item shows who, when, the exact words and a link to the source record. Rules come first, then
approvals and rejections, newest first in each. Where H-MEM and the seat table disagree about a
supersession, the item is shown with a "memory and decision table disagree" mark, never hidden. The
panel says how many memories it left out and why.

The same panel is where a person confirms a first quote that has nothing on file to check it against:
"Checked against this client's history — OK to send". This writes a document-level judgment to
`review/judgments.jsonl`, or to the copy under `--demo`, with the reviewer, the time and a required reason
(`src/review/judgments.ts`).

**What H-MEM does not decide.** The verdict. Warnings, "not cleared" and "clear" come from the seat table
and the detectors only. The check gives the same verdict with an empty H-MEM store; a test checks this.
