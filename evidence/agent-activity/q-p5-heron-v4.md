# Agent activity: q-p5-heron-v4

Trace: `evidence/agent-activity/traces/trace-eval-compare-full-2026-10-24T21-44-49-432Z.jsonl` (1028 lines; copied from `logs/` with the scan in README.md). Every row below is a trace line as the run wrote it; every reply is the file in `cache/` that step used. Built by `npm run activity:log` with no model call.

Steps: 5 · trace lines: 10 · replies: 7 (4 from the cache) · marked unusable: 3 · upstream errors: 0 · model latency summed: 144.3 s · Data read in Zetaris order (the run used --source zetaris); strong agents asked for meterless/auto (deep was not listed that day).
Every rebuilt prompt was found in the trace.

The trace `timestamp` is when the run wrote its trace (all lines at the end of the run), not when each call happened; `latency ms` is the measured time of that call. `requested mode` is what the client asked the route for; `model that answered` is what the route reported back.

**Question:** What should Heron Court v4 fix before I send it to Otto?  
**As of:** 2026-06-26T09:00:00-05:00 · **Seats:** job:WO-PW-05, client:cl.pike_water

## How the run scored it (`eval/results/compare-full.json`, written by the same run)

- Group A: **handed_to_person** — cannot tell: The records up to 2026-06-26T09:00:00-05:00 contain no Heron Court v4 quote version. The latest Heron Court quote is Q-PW-05-v3 (rec-0266, sent 2026-06-15), which Otto rejected on 2026-06-24 (rec-0270) without a stated reason. An internal note (rec-0271, dated 2026-06-25) states that v3 is on hold until Otto signs, and an unbilled stop-gap from 6 May (rec-0259, rec-0271) remains off any quote. No record gives Otto's reasons for rejection or defines what Heron Court v4 should fix. (299 records given)
- Group C: **handed_to_person** — not cleared, 2 open; first rec-0254: the model found no decision in this internal note; a person should confirm (299 records given, 0 human cards cited)

## Group A: one model call reading the records

### Step 1: GroupA (compare)

Asked to: You are the gatekeeper in a repair contractor's office, checking a quote or invoice before it goes out to the client.
Prompt named: 299 records and 0 cards
Prompt hash (trace input_ref): `d9e74939b7d2654c…` · reply file: `cache/dc721893d08250e9….json`

| trace line | phase | agent | route | requested mode | model that answered | cache | outcome | latency ms | retry |
|---:|---|---|---|---|---|---|---|---:|---:|
| 220 | compare | GroupA | cache | meterless/auto | nvidia/nemotron-3.5-lightning-30b-a3b | hit | ok | 0 | 0 |

Reply the step used (from the cache; answered by `nvidia/nemotron-3.5-lightning-30b-a3b`, mode `nvidia/nemotron-3.5-lightning-30b-a3b`):

```json
{
  "verdict": "cannot_tell",
  "flags": [],
  "current": null,
  "in_effect": null,
  "reasons": [],
  "cannot_tell_because": "The records up to 2026-06-26T09:00:00-05:00 contain no Heron Court v4 quote version. The latest Heron Court quote is Q-PW-05-v3 (rec-0266, sent 2026-06-15), which Otto rejected on 2026-06-24 (rec-0270) without a stated reason. An internal note (rec-0271, dated 2026-06-25) states that v3 is on hold until Otto signs, and an unbilled stop-gap from 6 May (rec-0259, rec-0271) remains off any quote. No record gives Otto's reasons for rejection or defines what Heron Court v4 should fix."
}
```

Reply cited: rec-0266, rec-0270, rec-0271, rec-0259

## Group C: the engine (Router → Skeptic → Judge → Explainer)

### Step 2: Router (answer)

Asked to: You route a question from a repair contractor's office gatekeeper to the records it is about.
Prompt named: no record or card ids
Prompt hash (trace input_ref): `d8cecbb8deff0026…` · reply file: `cache/195b44560ce70249….json`

| trace line | phase | agent | route | requested mode | model that answered | cache | outcome | latency ms | retry |
|---:|---|---|---|---|---|---|---|---:|---:|
| 723 | answer | Router | cache | meterless/auto | nvidia/nemotron-3.5-super-vl-120b-a12b | hit | ok | 0 | 0 |

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

### Step 3: Judge.explained (answer)

Asked to: You check whether a quote sent to a client explains each change from the previous version.
Prompt named: no record or card ids
Prompt hash (trace input_ref): `36518ec7e2b388a5…` · reply file: `cache/2baa0dac04903c6d….json`

| trace line | phase | agent | route | requested mode | model that answered | cache | outcome | latency ms | retry |
|---:|---|---|---|---|---|---|---|---:|---:|
| 724 | answer | Judge.explained | cache | meterless/auto | nvidia/nemotron-3.5-lightning-30b-a3b | hit | ok | 0 | 0 |

Reply the step used (from the cache; answered by `nvidia/nemotron-3.5-lightning-30b-a3b`, mode `nvidia/nemotron-3.5-lightning-30b-a3b`):

```json
{
  "lines": [
    {
      "description": "Reset drain body, flash and seal",
      "explained": false,
      "quote": ""
    },
    {
      "description": "Replace leader to first cleanout",
      "explained": false,
      "quote": ""
    }
  ]
}
```

Reply cited: no record or card ids

### Step 4: Explainer (answer)

Asked to: You write a short answer (3 to 6 sentences) for a repair contractor's office gatekeeper.
Prompt named: 19 records and 5 cards
Prompt hash (trace input_ref): `b36f998a79b02c85…` · reply file: `cache/1f4ada47a4d0d0fb….json`

| trace line | phase | agent | route | requested mode | model that answered | cache | outcome | latency ms | retry |
|---:|---|---|---|---|---|---|---|---:|---:|
| 725 | answer | Explainer | cache | meterless/auto | nvidia/nemotron-3.5-lightning-30b-a3b | hit | ok | 0 | 0 |

Reply the step used (from the cache; answered by `nvidia/nemotron-3.5-lightning-30b-a3b`, mode `nvidia/nemotron-3.5-lightning-30b-a3b`):

```json
{
  "sentences": [
    {
      "text": "Record rec-0250 states 'We'll check that first and tell you what we find.' (decided 2026-04-30) with no confirmed result, so the client will push back on this unresolved open item.",
      "cites": [
        "rec-0250"
      ]
    },
    {
      "text": "Rec-0262 and rec-0266 evidence P2, which records a $400 total labor delta between Q-PW-05-v2 and v3 with qty increases and client_explanation absent, prompting Otto to question the adjustments.",
      "cites": [
        "rec-0262",
        "rec-0266"
      ]
    },
    {
      "text": "Rec-0136 sets a quiet rule of 10 business days no ping, and rec-0269 evidence (P4) shows that rule broken, so v4 must avoid pinging Otto within that window.",
      "cites": [
        "rec-0136",
        "rec-0269"
      ]
    }
  ]
}
```

Reply cited: rec-0250, rec-0266, rec-0262, rec-0269, rec-0136

### Step 5: Skeptic.answer (answer)

Asked to: You check a short answer for an office gatekeeper against the structured findings it was written from.
Prompt named: 19 records and 5 cards
Prompt hash (trace input_ref): `cfb07e25ad45a395…` · reply file: `cache/c89ed7a1767071eb….json`

| trace line | phase | agent | route | requested mode | model that answered | cache | outcome | latency ms | retry |
|---:|---|---|---|---|---|---|---|---:|---:|
| 726 | answer | Skeptic.answer | nvidia-direct | nvidia/nemotron-3.5-lightning-30b-a3b | nvidia/nemotron-3.5-lightning-30b-a3b | miss | ok | 51322 | 0 |
| 727 | answer | Skeptic.answer | nvidia-direct | nvidia/nemotron-3.5-lightning-30b-a3b | nvidia/nemotron-3.5-lightning-30b-a3b | miss | invalid | 0 | 0 |
| 728 | answer | Skeptic.answer | nvidia-direct | nvidia/nemotron-3.5-lightning-30b-a3b | nvidia/nemotron-3.5-lightning-30b-a3b | miss | ok | 43753 | 1 |
| 729 | answer | Skeptic.answer | nvidia-direct | nvidia/nemotron-3.5-lightning-30b-a3b | nvidia/nemotron-3.5-lightning-30b-a3b | miss | invalid | 0 | 1 |
| 730 | answer | Skeptic.answer | nvidia-direct | nvidia/nemotron-3.5-lightning-30b-a3b | nvidia/nemotron-3.5-lightning-30b-a3b | miss | ok | 49239 | 2 |
| 731 | answer | Skeptic.answer | nvidia-direct | nvidia/nemotron-3.5-lightning-30b-a3b | nvidia/nemotron-3.5-lightning-30b-a3b | miss | invalid | 0 | 2 |

No reply used: every attempt came back unusable (see the invalid lines above). Nothing from this step reached the answer.
