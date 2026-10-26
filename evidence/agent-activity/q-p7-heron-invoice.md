# Agent activity: q-p7-heron-invoice

Trace: `evidence/agent-activity/traces/trace-eval-compare-full-2026-10-24T21-44-49-432Z.jsonl` (1028 lines; copied from `logs/` with the scan in README.md). Every row below is a trace line as the run wrote it; every reply is the file in `cache/` that step used. Built by `npm run activity:log` with no model call.

Steps: 4 · trace lines: 8 · replies: 6 (3 from the cache) · marked unusable: 2 · upstream errors: 0 · model latency summed: 150.9 s · Data read in Zetaris order (the run used --source zetaris); strong agents asked for meterless/auto (deep was not listed that day).
Every rebuilt prompt was found in the trace.

The trace `timestamp` is when the run wrote its trace (all lines at the end of the run), not when each call happened; `latency ms` is the measured time of that call. `requested mode` is what the client asked the route for; `model that answered` is what the route reported back.

**Question:** Can we invoice anything on Heron Court yet?  
**As of:** 2026-06-26T09:00:00-05:00 · **Seats:** job:WO-PW-05

## How the run scored it (`eval/results/compare-full.json`, written by the same run)

- Group A: **confidently_wrong** — missing warning P7 (299 records given)
- Group C: **handed_to_person** — not cleared, 2 open; first rec-0254: the model found no decision in this internal note; a person should confirm (299 records given, 0 human cards cited)

## Group A: one model call reading the records

### Step 1: GroupA (compare)

Asked to: You are the gatekeeper in a repair contractor's office, checking a quote or invoice before it goes out to the client.
Prompt named: 299 records and 0 cards
Prompt hash (trace input_ref): `5987aeb246cd2d39…` · reply file: `cache/d2ef5385560f22b0….json`

| trace line | phase | agent | route | requested mode | model that answered | cache | outcome | latency ms | retry |
|---:|---|---|---|---|---|---|---|---:|---:|
| 221 | compare | GroupA | cache | meterless/auto | nvidia/nemotron-3.5-lightning-30b-a3b | hit | ok | 0 | 0 |

Reply the step used (from the cache; answered by `nvidia/nemotron-3.5-lightning-30b-a3b`, mode `nvidia/nemotron-3.5-lightning-30b-a3b`):

```json
{
  "verdict": "warn",
  "flags": [
    "P1"
  ],
  "current": {
    "record_id": "rec-0271",
    "quote": "Heron Court: Wes's stop-gap from 6 May ($280, 3 hours and the temporary cover) is still unbilled, and the rebuild, $2,026 on v3, is on hold until Otto signs something. Crew is off the job.",
    "mode": "mentions"
  },
  "in_effect": null,
  "reasons": [
    {
      "record_id": "rec-0271",
      "quote": "Heron Court: Wes's stop-gap from 6 May ($280, 3 hours and the temporary cover) is still unbilled, and the rebuild, $2,026 on v3, is on hold until Otto signs something. Crew is off the job.",
      "mode": "mentions"
    },
    {
      "record_id": "rec-0270",
      "quote": "Rejected.",
      "mode": "gives_reason"
    },
    {
      "record_id": "rec-0265",
      "quote": "Not this version either.",
      "mode": "gives_reason"
    }
  ],
  "cannot_tell_because": null
}
```

Reply cited: rec-0271, rec-0270, rec-0265

## Group C: the engine (Router → Skeptic → Judge → Explainer)

### Step 2: Router (answer)

Asked to: You route a question from a repair contractor's office gatekeeper to the records it is about.
Prompt named: no record or card ids
Prompt hash (trace input_ref): `0ac08e919ae712a0…` · reply file: `cache/61eb0e0acd1aaea6….json`

| trace line | phase | agent | route | requested mode | model that answered | cache | outcome | latency ms | retry |
|---:|---|---|---|---|---|---|---|---:|---:|
| 732 | answer | Router | cache | meterless/auto | nvidia/nemotron-3.5-super-vl-120b-a12b | hit | ok | 0 | 0 |

Reply the step used (from the cache; answered by `nvidia/nemotron-3.5-super-vl-120b-a12b`, mode `nvidia/nemotron-3.5-lightning-30b-a3b`):

```json
{
  "question_type": "send_check",
  "seats": [
    "job:WO-PW-05",
    "client:cl.pike_water"
  ],
  "topic": "client_rule",
  "facets": [
    "client_rule.submission",
    "submission.process"
  ],
  "as_of": "2026-06-26T09:00:00-05:00"
}
```

Reply cited: no record or card ids

### Step 3: Explainer (answer)

Asked to: You write a short answer (3 to 6 sentences) for a repair contractor's office gatekeeper.
Prompt named: rec-0136, rec-0260, rec-0265, rec-0270, m.rec-0136.0.1, m.rec-0260.0.0, m.rec-0265.0.0, m.rec-0270.0.0
Prompt hash (trace input_ref): `97fb523de0e659f0…` · reply file: `cache/ddf335ca09e2a4bc….json`

| trace line | phase | agent | route | requested mode | model that answered | cache | outcome | latency ms | retry |
|---:|---|---|---|---|---|---|---|---:|---:|
| 733 | answer | Explainer | cache | meterless/auto | nvidia/nemotron-3.5-lightning-30b-a3b | hit | ok | 0 | 0 |

Reply the step used (from the cache; answered by `nvidia/nemotron-3.5-lightning-30b-a3b`, mode `nvidia/nemotron-3.5-lightning-30b-a3b`):

```json
{
  "sentences": [
    {
      "text": "The client will push back on any invoice because rec-0260 states \"Not approving this one.\", rec-0265 states \"Not this version either.\", and rec-0270 states \"Rejected.\", leaving no approved version to bill against.",
      "cites": [
        "rec-0260",
        "rec-0265",
        "rec-0270"
      ]
    },
    {
      "text": "The records further show the client said, \"He asked us not to ping him for ten business days after a send.\" (rec-0136), which may affect the timing of invoice follow-up.",
      "cites": [
        "rec-0136"
      ]
    },
    {
      "text": "Before sending an invoice, an approved version must be confirmed, as the records do not show any version approved for billing.",
      "cites": [
        "rec-0260",
        "rec-0265",
        "rec-0270"
      ]
    }
  ]
}
```

Reply cited: rec-0260, rec-0265, rec-0270, rec-0136

### Step 4: Skeptic.answer (answer)

Asked to: You check a short answer for an office gatekeeper against the structured findings it was written from.
Prompt named: rec-0136, rec-0260, rec-0265, rec-0270, m.rec-0136.0.1, m.rec-0260.0.0, m.rec-0265.0.0, m.rec-0270.0.0
Prompt hash (trace input_ref): `b1cc6e4ebb27c0dc…` · reply file: `cache/74769af4cbcb1d00….json`

| trace line | phase | agent | route | requested mode | model that answered | cache | outcome | latency ms | retry |
|---:|---|---|---|---|---|---|---|---:|---:|
| 734 | answer | Skeptic.answer | nvidia-direct | nvidia/nemotron-3.5-lightning-30b-a3b | nvidia/nemotron-3.5-lightning-30b-a3b | miss | ok | 54767 | 0 |
| 735 | answer | Skeptic.answer | nvidia-direct | nvidia/nemotron-3.5-lightning-30b-a3b | nvidia/nemotron-3.5-lightning-30b-a3b | miss | invalid | 0 | 0 |
| 736 | answer | Skeptic.answer | nvidia-direct | nvidia/nemotron-3.5-lightning-30b-a3b | nvidia/nemotron-3.5-lightning-30b-a3b | miss | ok | 62720 | 1 |
| 737 | answer | Skeptic.answer | nvidia-direct | nvidia/nemotron-3.5-lightning-30b-a3b | nvidia/nemotron-3.5-lightning-30b-a3b | miss | invalid | 0 | 1 |
| 738 | answer | Skeptic.answer | nvidia-direct | nvidia/nemotron-3.5-lightning-30b-a3b | nvidia/nemotron-3.5-lightning-30b-a3b | miss | ok | 33459 | 2 |

Reply the step used (from the cache; answered by `nvidia/nemotron-3.5-lightning-30b-a3b`, mode `nvidia/nemotron-3.5-lightning-30b-a3b`):

```json
{
  "verdicts": [
    {
      "id": "1",
      "supported": false,
      "why": "findings show specific rejections but do not state the client will push back on any invoice"
    },
    {
      "id": "2",
      "supported": false,
      "why": "findings do not state the quote affects invoice follow-up timing"
    },
    {
      "id": "3",
      "supported": false,
      "why": "findings do not state an approved version must be confirmed before sending an invoice"
    }
  ]
}
```

Reply cited: no record or card ids
