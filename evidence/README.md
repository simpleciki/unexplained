# Evidence

Files a judge can read to check the sponsor integrations and the sample-day claim without running anything.
Every record behind them is fictional (see `data/README.md`).

## `zetaris-parity-2026-10-25.txt` — Zetaris is the live data layer

- **What it is:** the verbatim output of one live `npm run zetaris:parity`.
- **Produced:** 2026-10-25 23:03 CDT, on the builder's machine, at code commit `2cd25f6`. Zetaris ran
  self-hosted in Docker with 4 healthy containers, and read the two sources registered as `CLIENT_PORTAL` and
  `CONTRACTOR_OPS`. No model call was made.
- **What it shows:** 16 tables and cross-source views. For each, the row count read from `data/` and the row
  count returned through Zetaris SQL, and whether the rows are identical. All 16 are identical, including the two
  cross-source views the engine reads (`v_invoice_vs_approved`, `v_job_evidence_timeline`).
- **What it does not show:** that a judge's own Zetaris gives the same output; how fast Zetaris is; anything
  about the default `--source files` path, which reads `data/` directly.
- **Reproduce:** run `npm run zetaris:parity`. It needs a running Zetaris and its credentials in `.env`. Without
  them the command fails loudly and never falls back to files.

## `zetaris-live-check-2026-10-26.md` — one end-to-end request with Zetaris running

- **What it is:** the check page started with `--source zetaris` (no model call), then one request,
  `GET /api/check?doc=Q-PW-05-v2`, answered from data Zetaris had just read.
- **Produced:** 2026-10-26 16:00 CDT, on the builder's machine, Zetaris self-hosted in Docker.
- **What it shows:** each read Zetaris made from the two source systems during the run (path, rows, status), and
  the request's input and output: two named warnings, each with its one-step fix and the records that prove it.
  The same request against files returned an identical response. No credentials appear.
- **Reproduce:** with Zetaris running and its credentials in `.env`: `npm run sources:serve`, then
  `npm run ui -- --source zetaris` and open `/outbox`.

## `zetaris-live-video-2026-10-27.md` — the live Zetaris request shown in the demo video

- **What it is:** the run recorded for the demo video at 1:30.7–1:36.0: the check page started with
  `--source zetaris` (no model call), every read Zetaris made of the two source systems, and the check page for
  `Q-PW-05-v2`.
- **Produced:** 2026-10-27 09:09 CDT, on the builder's machine, Zetaris self-hosted in Docker; parity checked first.
- **What it shows:** 22 reads with times, paths and row counts, all HTTP 200. The reads are shown at 3× speed in the
  video, marked on screen.
- **Reproduce:** same as the 10-26 check above.

## `nightshift-receipts-summary.jsonl` — the model calls went through Nightshift

- **What it is:** one line per successful Nightshift call made by the app `unexplained`. It is summarised from
  Nightshift's signed compute receipts.
- **Produced:** from the receipts on the builder's machine, covering 2026-10-21 20:28 to 2026-10-23 12:44 CDT.
- **What each line holds:** signed time, receipt id, request id, requested mode, the model that answered,
  provider, egress, cache, input and output tokens, latency, cost and status.
- **What it shows:** 713 successful calls, every one signed by `meterlessd`, `status: ok`, provider and egress
  `nvidia`, cost $0. All 713 record the requested mode `meterless/auto`. They were answered by
  `nvidia/nemotron-3.5-super-vl-120b-a12b` (267), `nvidia/nemotron-3-ultra-550b-a55b` (244) and
  `nvidia/nemotron-3.5-lightning-30b-a3b` (202). Nightshift substituted models, and this was reported to Meterless
  on 2026-10-23.
- **What it does not show:**
  - which agent or which record a call was for (no prompt text is kept);
  - the failed calls;
  - the losing lanes of each race;
  - the signatures themselves.

  The full signed receipts stay on the builder's machine. The losing lanes carry NVIDIA error text with an
  account id, and redacting that text would break the signatures. So this file can be read, but it cannot be
  verified cryptographically from the repo.
- **Reproduce:** it cannot be regenerated without the builder's Nightshift install. Each `request_id` here
  matches a receipt there.

## `npm run demo:sample-day` — "6 of 10 ready" on a sample day

- **What it is:** a script, not a file. It needs no key, no `.env` and no model call. Without a local ingest it
  reads the committed snapshot `snapshot/ingest-2026-10-23/`.
- **What it does:**
  - copies `review/judgments.jsonl` into a temp directory (the real file and `.demo/` are never touched);
  - draws Today's outbox (10 documents, seed `20261027`);
  - makes every confirmation a person can make in the page, through the same judgment path the page uses:
    "Looks fine" on records the model read as empty or routed to a person, and "Checked against this client's
    history — OK to send" on first quotes;
  - leaves alone the open questions (they need a person's answer) and `rec-0007` (its text is a real finding).

  It prints each document before and after, with the clicks it took. Code: `src/ui/sample-day.ts`. A test pins
  the result.
- **Result on the committed code and data:**
  - before: 3 to fix before sending, 7 left to confirm, 0 ready to send;
  - after: 3 to fix before sending, 6 ready to send, 1 left to confirm. The one left is `Q-NL-01-v2`, with 3
    items: `rec-0007` and two open questions.
- **What it does not show:**
  - that a person would make the same calls (the script makes them, as "sample-day script");
  - how long a person takes;
  - anything about real contractors' data.

  The sample day is drawn at the builder's estimate of 2 problem documents in 10.
- **Reproduce:** `npm run demo:sample-day`.
