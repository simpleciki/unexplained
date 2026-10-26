# Agent activity: q-p5-heron-why

Trace: `evidence/agent-activity/traces/trace-eval-compare-full-2026-10-24T21-44-49-432Z.jsonl` (1028 lines; copied from `logs/` with the scan in README.md). Every row below is a trace line as the run wrote it; every reply is the file in `cache/` that step used. Built by `npm run activity:log` with no model call.

Steps: 5 · trace lines: 15 · replies: 9 (2 from the cache) · marked unusable: 6 · upstream errors: 0 · model latency summed: 335.4 s · Data read in Zetaris order (the run used --source zetaris); strong agents asked for meterless/auto (deep was not listed that day).
Every rebuilt prompt was found in the trace.

The trace `timestamp` is when the run wrote its trace (all lines at the end of the run), not when each call happened; `latency ms` is the measured time of that call. `requested mode` is what the client asked the route for; `model that answered` is what the route reported back.

**Question:** Otto has turned down all three Heron Court quotes. Why?  
**As of:** 2026-06-25T09:00:00-05:00 · **Seats:** job:WO-PW-05, client:cl.pike_water

## How the run scored it (`eval/results/compare-full.json`, written by the same run)

- Group A: **unscorable** — no usable reply: reply was prose, not JSON (297 records given)
- Group C: **handed_to_person** — not cleared, 1 open; first rec-0254: the model found no decision in this internal note; a person should confirm (297 records given, 0 human cards cited)

## Group A: one model call reading the records

### Step 1: GroupA (compare)

Asked to: You are the gatekeeper in a repair contractor's office, checking a quote or invoice before it goes out to the client.
Prompt named: 297 records and 0 cards
Prompt hash (trace input_ref): `7efbaa7725997405…` · reply file: `cache/3a8ca30a4c016bd6….json`

| trace line | phase | agent | route | requested mode | model that answered | cache | outcome | latency ms | retry |
|---:|---|---|---|---|---|---|---|---:|---:|
| 214 | compare | GroupA | nvidia-direct | nvidia/nemotron-3.5-lightning-30b-a3b | nvidia/nemotron-3.5-lightning-30b-a3b | miss | ok | 45292 | 0 |
| 215 | compare | GroupA | nvidia-direct | nvidia/nemotron-3.5-lightning-30b-a3b | nvidia/nemotron-3.5-lightning-30b-a3b | miss | invalid | 0 | 0 |
| 216 | compare | GroupA | nvidia-direct | nvidia/nemotron-3.5-lightning-30b-a3b | nvidia/nemotron-3.5-lightning-30b-a3b | miss | ok | 45265 | 1 |
| 217 | compare | GroupA | nvidia-direct | nvidia/nemotron-3.5-lightning-30b-a3b | nvidia/nemotron-3.5-lightning-30b-a3b | miss | invalid | 0 | 1 |
| 218 | compare | GroupA | nvidia-direct | nvidia/nemotron-3.5-lightning-30b-a3b | nvidia/nemotron-3.5-lightning-30b-a3b | miss | ok | 45422 | 2 |
| 219 | compare | GroupA | nvidia-direct | nvidia/nemotron-3.5-lightning-30b-a3b | nvidia/nemotron-3.5-lightning-30b-a3b | miss | invalid | 0 | 2 |

No reply used: every attempt came back unusable (see the invalid lines above). Nothing from this step reached the answer.

## Group C: the engine (Router → Skeptic → Judge → Explainer)

### Step 2: Router (answer)

Asked to: You route a question from a repair contractor's office gatekeeper to the records it is about.
Prompt named: no record or card ids
Prompt hash (trace input_ref): `2ef6fbb006dcf820…` · reply file: `cache/fdf2416bcf927bc0….json`

| trace line | phase | agent | route | requested mode | model that answered | cache | outcome | latency ms | retry |
|---:|---|---|---|---|---|---|---|---:|---:|
| 714 | answer | Router | cache | meterless/auto | nvidia/nemotron-3.5-lightning-30b-a3b | hit | ok | 0 | 0 |

Reply the step used (from the cache; answered by `nvidia/nemotron-3.5-lightning-30b-a3b`, mode `nvidia/nemotron-3.5-lightning-30b-a3b`):

```json
{
  "question_type": "why_rejected",
  "seats": [
    "job:WO-PW-05",
    "client:cl.pike_water"
  ],
  "topic": "the records do not say",
  "facets": [],
  "as_of": "2026-06-25T09:00:00-05:00"
}
```

Reply cited: no record or card ids

### Step 3: Judge.explained (answer)

Asked to: You check whether a quote sent to a client explains each change from the previous version.
Prompt named: no record or card ids
Prompt hash (trace input_ref): `36518ec7e2b388a5…` · reply file: `cache/2baa0dac04903c6d….json`

| trace line | phase | agent | route | requested mode | model that answered | cache | outcome | latency ms | retry |
|---:|---|---|---|---|---|---|---|---:|---:|
| 715 | answer | Judge.explained | nvidia-direct | nvidia/nemotron-3.5-lightning-30b-a3b | nvidia/nemotron-3.5-lightning-30b-a3b | miss | ok | 33063 | 0 |

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
Prompt hash (trace input_ref): `b5ed5b0c2ea72a55…` · reply file: `cache/a61cbcbb524adbaf….json`

| trace line | phase | agent | route | requested mode | model that answered | cache | outcome | latency ms | retry |
|---:|---|---|---|---|---|---|---|---:|---:|
| 716 | answer | Explainer | cache | meterless/auto | nvidia/nemotron-3.5-lightning-30b-a3b | hit | ok | 0 | 0 |

Reply the step used (from the cache; answered by `nvidia/nemotron-3.5-lightning-30b-a3b`, mode `nvidia/nemotron-3.5-lightning-30b-a3b`):

```json
{
  "sentences": [
    {
      "text": "Otto recorded three rejections of Heron Court quotes: \"Not approving this one.\" (rec-0260), \"Not this version either.\" (rec-0265), and \"Rejected.\" (rec-0270).",
      "cites": [
        "rec-0260",
        "rec-0265",
        "rec-0270"
      ]
    },
    {
      "text": "The client will push back on the unconfirmed contractor promise \"We'll check that first and tell you what we find.\" (rec-0250), as the findings show no result has been recorded.",
      "cites": [
        "rec-0250"
      ]
    },
    {
      "text": "The client will also push back on the $400 change from Q-PW-05-v2 to v3 (rec-0262, rec-0266), since the records show client_explanation: absent.",
      "cites": [
        "rec-0262",
        "rec-0266"
      ]
    },
    {
      "text": "Before sending new quotes, confirm the open item from rec-0250 and replace abbreviated rejection phrases with specific findings or cost details.",
      "cites": [
        "rec-0250"
      ]
    }
  ]
}
```

Reply cited: rec-0260, rec-0265, rec-0270, rec-0250, rec-0262, rec-0266

### Step 5: Skeptic.answer (answer)

Asked to: You check a short answer for an office gatekeeper against the structured findings it was written from.
Prompt named: 19 records and 5 cards
Prompt hash (trace input_ref): `662a1cf8de593a6e…` · reply file: `cache/4b2922dfb829f2b6….json`

| trace line | phase | agent | route | requested mode | model that answered | cache | outcome | latency ms | retry |
|---:|---|---|---|---|---|---|---|---:|---:|
| 717 | answer | Skeptic.answer | nvidia-direct | nvidia/nemotron-3.5-lightning-30b-a3b | nvidia/nemotron-3.5-lightning-30b-a3b | miss | ok | 61623 | 0 |
| 718 | answer | Skeptic.answer | nvidia-direct | nvidia/nemotron-3.5-lightning-30b-a3b | nvidia/nemotron-3.5-lightning-30b-a3b | miss | invalid | 0 | 0 |
| 719 | answer | Skeptic.answer | nvidia-direct | nvidia/nemotron-3.5-lightning-30b-a3b | nvidia/nemotron-3.5-lightning-30b-a3b | miss | ok | 53571 | 1 |
| 720 | answer | Skeptic.answer | nvidia-direct | nvidia/nemotron-3.5-lightning-30b-a3b | nvidia/nemotron-3.5-lightning-30b-a3b | miss | invalid | 0 | 1 |
| 721 | answer | Skeptic.answer | nvidia-direct | nvidia/nemotron-3.5-lightning-30b-a3b | nvidia/nemotron-3.5-lightning-30b-a3b | miss | ok | 51211 | 2 |
| 722 | answer | Skeptic.answer | nvidia-direct | nvidia/nemotron-3.5-lightning-30b-a3b | nvidia/nemotron-3.5-lightning-30b-a3b | miss | invalid | 0 | 2 |

No reply used: every attempt came back unusable (see the invalid lines above). Nothing from this step reached the answer.
