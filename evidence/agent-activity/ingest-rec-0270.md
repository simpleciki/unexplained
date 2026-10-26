# Agent activity: ingest of rec-0270

Trace: `evidence/agent-activity/traces/trace-ingest-2026-10-23T06-42-45-515Z.jsonl` (387 lines; copied from `logs/` with the scan in README.md). Every row below is a trace line as the run wrote it; every reply is the file in `cache/` that step used. Built by `npm run activity:log` with no model call.

Steps: 4 · trace lines: 6 · replies: 5 (3 from the cache) · marked unusable: 1 · upstream errors: 0 · model latency summed: 81.9 s · Data read in data/ file order; strong agents asked for meterless/deep.
Every rebuilt prompt was found in the trace.

The trace `timestamp` is when the run wrote its trace (all lines at the end of the run), not when each call happened; `latency ms` is the measured time of that call. `requested mode` is what the client asked the route for; `model that answered` is what the route reported back.

## The record

```json
{
  "record_id": "rec-0270",
  "source_version": "v1",
  "source_type": "client_message",
  "text": "Rejected.",
  "author": "p.pw.otto_gell",
  "source_recorded_at": "2026-06-24T16:50:00-05:00",
  "thread_id": "WO-PW-05"
}
```

### Step 1: Researcher.extract (ingest)

Asked to: You extract decision cards from one record of a repair contractor's job file.
Prompt named: rec-0270
Prompt hash (trace input_ref): `d337718e9222a4f8…` · reply file: `cache/19b075c64f031a41….json`

| trace line | phase | agent | route | requested mode | model that answered | cache | outcome | latency ms | retry |
|---:|---|---|---|---|---|---|---|---:|---:|
| 300 | ingest | Researcher.extract | — | — | nvidia/nemotron-3.5-super-vl-120b-a12b | miss | ok | 46541 | 0 |
| 301 | ingest | Researcher.extract | — | — | nvidia/nemotron-3.5-super-vl-120b-a12b | miss | invalid | 0 | 0 |
| 302 | ingest | Researcher.extract | — | — | nvidia/nemotron-3.5-super-vl-120b-a12b | miss | ok | 35337 | 1 |

Reply the step used (from the cache; answered by `nvidia/nemotron-3.5-super-vl-120b-a12b`, mode `nvidia/nemotron-3.5-lightning-30b-a3b`):

```json
{
  "cards": [
    {
      "mode": "decides",
      "topic": "approval",
      "facets": [
        "approval.status"
      ],
      "scope": "job:WO-PW-05",
      "decided_at": "2026-06-24T16:50:00-05:00",
      "effective": "2026-06-24T16:50:00-05:00",
      "decided_by": "p.pw.otto_gell",
      "quote": "Rejected."
    }
  ]
}
```

Reply cited: no record or card ids

### Step 2: Skeptic.cards (ingest)

Asked to: You check extracted decision cards against the record they came from.
Prompt named: rec-0270, m.rec-0270.0.0
Prompt hash (trace input_ref): `058afca54b92ac5a…` · reply file: `cache/3b6bbbc9ec1d2854….json`

| trace line | phase | agent | route | requested mode | model that answered | cache | outcome | latency ms | retry |
|---:|---|---|---|---|---|---|---|---:|---:|
| 303 | ingest | Skeptic.cards | — | — | nvidia/nemotron-3.5-lightning-30b-a3b | hit | ok | 0 | 0 |

Reply the step used (from the cache; answered by `nvidia/nemotron-3.5-lightning-30b-a3b`, mode `nvidia/nemotron-3.5-lightning-30b-a3b`):

```json
{
  "verdicts": [
    {
      "id": "m.rec-0270.0.0",
      "supported": true,
      "why": "Quote matches exactly, mode decides fits approval declaration, speaker matches"
    }
  ]
}
```

Reply cited: rec-0270, m.rec-0270.0.0

### Step 3: Keeper.relate (ingest)

Asked to: You compare two decisions made on the same subject (same topic, facet and scope).
Prompt named: rec-0260, rec-0270, m.rec-0260.0.0, m.rec-0270.0.0
Prompt hash (trace input_ref): `dba763dc709b33f3…` · reply file: `cache/926f9d4e1f758819….json`

| trace line | phase | agent | route | requested mode | model that answered | cache | outcome | latency ms | retry |
|---:|---|---|---|---|---|---|---|---:|---:|
| 386 | ingest | Keeper.relate | — | — | nvidia/nemotron-3.5-lightning-30b-a3b | hit | ok | 0 | 0 |

Reply the step used (from the cache; answered by `nvidia/nemotron-3.5-lightning-30b-a3b`, mode `nvidia/nemotron-3.5-lightning-30b-a3b`):

```json
{
  "relation": "SAME",
  "reason": "The newer restates the same non-approval position in different words."
}
```

Reply cited: no record or card ids

### Step 4: Keeper.relate (ingest)

Asked to: You compare two decisions made on the same subject (same topic, facet and scope).
Prompt named: rec-0265, rec-0270, m.rec-0265.0.0, m.rec-0270.0.0
Prompt hash (trace input_ref): `f877495142c7064f…` · reply file: `cache/4f684f4f48862e88….json`

| trace line | phase | agent | route | requested mode | model that answered | cache | outcome | latency ms | retry |
|---:|---|---|---|---|---|---|---|---:|---:|
| 387 | ingest | Keeper.relate | — | — | nvidia/nemotron-3.5-super-vl-120b-a12b | hit | ok | 0 | 0 |

Reply the step used (from the cache; answered by `nvidia/nemotron-3.5-super-vl-120b-a12b`, mode `nvidia/nemotron-3.5-lightning-30b-a3b`):

```json
{
  "relation": "SAME",
  "reason": "The newer restates the same rejection in different words."
}
```

Reply cited: no record or card ids

## What the ingest kept (`state/cards.json`, written by this ingest)

```json
[
  {
    "card_id": "m.rec-0270.0.0",
    "record_id": "rec-0270",
    "quote": "Rejected.",
    "mode": "decides",
    "topic": "approval",
    "facets": [
      "approval.status"
    ],
    "scope": "job:WO-PW-05",
    "decided_at": "2026-06-24T16:50:00-05:00",
    "effective": "2026-06-24T16:50:00-05:00",
    "decided_by": "p.pw.otto_gell"
  }
]
```
