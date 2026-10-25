# unexplained

The last check before a repair contractor's quote or invoice goes out: it reads the document the way
the client will, against what this client already approved, flags what the client will push back on
with evidence, and says "the records do not say" instead of guessing. All data in `data/` is fictional
(see `data/README.md`).

## Model runtime

Nightshift, the Meterless Runtime on `127.0.0.1:8088` (`src/llm/meterless.ts`), is the default and
primary provider. `AI_PROVIDER=nvidia-direct` is an explicit second route straight to NVIDIA's endpoint
(`src/llm/nvidia-direct.ts`, key from `NVIDIA_API_KEY`, model `nvidia/nemotron-3.5-lightning-30b-a3b`). It
was added after Nightshift 1.2.1 and 1.2.2 routed our pinned models to an NVIDIA function this account
cannot use, and the full evaluation run uses it (see `docs/eval-protocol-011-amendment-2.md`). Meterless
confirmed that calling NVIDIA directly is fine (Sam Cummings, Help Meterless, 2026-10-23). Either way,
cached replies are reused and each trace event says which route answered (`nightshift`, `nvidia-direct`,
or `cache` for a reused reply). The routing and pinning below apply to Nightshift.

Routing. Each agent asks for a Meterless routing mode (`meterless/auto` or `meterless/deep`). When the
runtime routes a request to an upstream model that is retired or that this account may not use, the
client switches to the next mode (auto, deep, text, fusion, code, judge, cluster), keeps the one that
works for the rest of the run, and remembers dead modes for 6 hours in `state/dead-modes.json`.
`meterless/local` and the image, video, speech and other media modes are never used.

Pinning. Nightshift's auto router has picked a retired NVIDIA model, so runs pin the upstream model.
By default every agent uses `nvidia/nemotron-3.5-lightning-30b-a3b`, then
`nvidia/nemotron-3-super-120b-a12b` as the fallback; `nvidia/nemotron-3-ultra-550b-a55b` is never used,
pinned or as a fallback. The order comes from the extraction prose rate measured on 2026-10-22 (replies
that were a numbered plan instead of JSON): ultra-550b 63/63, super-vl 8/16, lightning 4/33.
`METERLESS_MODE_ORDER` (a comma list of routing modes or NVIDIA model ids) overrides the default; the
entries go to the same runtime endpoint with the same headers.

```
npm run ingest -- --max-calls 300
```

## Data layer: Zetaris

The evidence lives in two separate systems: the **client portal** (clients, quote versions and lines,
submission events, invoices and lines, client messages) and the **contractor job system** (work orders,
internal notes, field notes). `npm run sources:serve` serves both, read-only, on `127.0.0.1` (port
`SOURCE_PORT`, default 8790); Zetaris registers them as two Lightning databases (`CLIENT_PORTAL`,
`CONTRACTOR_OPS`) of REST tables, flattens each into a SchemaStore view in the `unexplained` container,
and adds three cross-source views (`v_quotes_by_trade`, `v_invoice_vs_approved`,
`v_job_evidence_timeline`). `ingest`, `ask`, `eval:live` and `eval:oracle` read through Zetaris by
default (`--source zetaris`); `npm run zetaris:parity` checks every table and both cross-source views
against `data/`. If Zetaris is unreachable the run fails loudly, it never falls back to files.
The engine uses the cross-source views directly: P7 (invoice vs approved version) shows the
`v_invoice_vs_approved` row for the invoice, and P5 (unexplained rejection) shows the job's
`v_job_evidence_timeline` across both systems. Which version was approved on a date is still worked out
from dated records; the view's approval column is end-of-period state, shown for context only.

`--source files` reads `data/` directly (the views are computed in memory). SAMPLE_MODE always uses it:
judges replay the three sample questions without Docker or a Zetaris install.

Every command that can call a model needs `--max-calls N`, prints a dry-run estimate first
(`--dry-run` stops there), caches only replies that passed their schema, and writes a trace to `logs/`
with the model that actually answered. The runtime token is read from `.env`
(`METERLESS_RUNTIME_TOKEN`, see `.env.example`) and is never printed.

## Memory: Meterless H-MEM

**What is written.** Every accepted card (model or person) is written into H-MEM with its provenance:
the exact quote, the source record, when it was learned, and the card id (`src/engine/memory.ts`). H-MEM
also guesses on its own which memory supersedes which, from the wording. Those guesses are checked against
the seat table, which is the authority. Every override is logged in H-MEM's trust ledger, and every
remaining drift is reported. `npm run ingest` saves the store to `state/hmem-snapshot.json`
(`saveState` in `src/engine/engine.ts`); the no-model oracle saves its own copy under `eval/results/oracle-state/`.

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
