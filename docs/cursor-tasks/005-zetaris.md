# Task 005 — Zetaris as the data layer (two fragmented sources, one query surface)

Everything below the line is the task.

---

## Why

Official Rules 5.1: every submission must integrate Zetaris. Ours must do real work: the engine reads its tables through Zetaris, not from local files, and the story is the one Track 01/02 asks for — the evidence lives in **two separate systems** and Zetaris joins them:

- **Client portal** (what the client sees): `clients`, `quote_versions`, `quote_lines`, `submission_events`, `invoices`, `invoice_lines`, and records of type `client_message`, `quote_version`, `submission_event`, `invoice`.
- **Contractor job system** (what only the office sees): `work_orders`, and records of type `work_order`, `internal_note`, `field_note`.

## What is already verified (reviewer, 2026-10-22)

- Local Zetaris 2.4.3.1 runs in Docker (`ui` on `127.0.0.1:3000`, all four containers healthy).
- The Zetaris driver and api containers CAN reach a service on this Mac bound to `127.0.0.1` via `http://host.docker.internal:<port>` (probe returned the JSON body from both containers).
- Your sandbox may now reach `127.0.0.1:3000` and bind local ports.

## Facts from Zetaris's own getting-started repo (`zetaris/getting-started` @ `98a2d30`, tested against 2.4.3.1)

- Login: `POST http://127.0.0.1:3000/api/auth/login`, JSON `{"username","password"}`, header `X-Request-ID: <uuid>`. Token in `idToken` (fallback `token` / `accessToken`); `orgId` in the response — never hardcode it.
- Query: `POST http://127.0.0.1:3000/api/proxy/query/sql/start`, headers `Authorization: Bearer <token>`, `X-Org-ID: <orgId>`, `X-Request-ID: <uuid>`, `Content-Type: application/json`, body `{"select": "<sql>", "pageLimit": 100}` (max 100). Response `{records, pageNumber, pageLimit, totalCount, totalPages, queryToken}` — rows come back inline, no polling. More pages: the `query/sql/page?queryToken=&pageLimit=&pageNumber=` route (try it under the same `/api/proxy/` prefix). The shape of each record (object vs array) is NOT documented — detect it at runtime and normalise. Values may arrive as strings; numbers may use exponent format.
- One SQL statement per call. `DESCRIBE BY` text allows only letters, digits, spaces and `_ . - ,`.
- REST table pattern (proven end to end by Zetaris on PokéAPI):
  ```sql
  CREATE LIGHTNING DATABASE <DB> DESCRIBE BY "...";
  CREATE SCHEMASTORE CONTAINER <container>;
  CREATE LIGHTNING REST TABLE <t>_raw FROM <DB> REQUEST(endpoint "http://host.docker.internal:<port>/<path>", method "get", response_type "json", http_encoding "URLENCODED") HEADER () BODY ();
  CREATE SCHEMASTORE VIEW <v> WITH CONTAINER <container> AS SELECT r.* FROM <db>.<t>_raw LATERAL VIEW explode(data) AS r;
  ```
  Cast numeric columns inside the view. A REST table may call the source on every query (`CACHE TABLE` helps). Known limit: an `explode()` view referenced twice in one query fails with `MISSING_ATTRIBUTES.RESOLVED_ATTRIBUTE_APPEAR_IN_OPERATION` — use window functions / separate queries instead.

## Build

1. `src/zetaris/source-server.ts` + `npm run sources:serve`: one local HTTP server bound to `127.0.0.1` only (port from env `SOURCE_PORT`, default 8790), read-only, serving `{"data":[...]}` for every table and record type under two prefixes: `/portal/<name>` and `/ops/<name>`. No other routes; 404 otherwise. Log each request to the trace.
2. `src/zetaris/client.ts`: login (token cached for the run), `query(sql)` with paging, record normalisation, 30 s timeout per call, one retry on 5xx/timeout. Credentials from `.env` (`ZETARIS_USERNAME`, `ZETARIS_PASSWORD`, optional `ZETARIS_URL`, default `http://127.0.0.1:3000`); never logged. Every query writes a trace event (sql hash, rows, latency, outcome).
3. `scripts/zetaris-register.ts` + `npm run zetaris:register -- [--apply]`: databases `CLIENT_PORTAL` and `CONTRACTOR_OPS`, one REST table per served path, flattening views with casts, plus 2–3 cross-source SchemaStore views that the demo can show (e.g. quote versions joined to their work order and trade; invoice lines joined to the approved quote version). Without `--apply` it prints the SQL only. With `--apply` it runs statements one by one, skips ones that already exist (idempotent), and stops on the first real error with the message.
4. `src/adapters/zetaris.ts`: loads the same in-memory `Data` the engine gets from `data.ts`, but through Zetaris queries. Engine/CLI option `--source zetaris|files` (default `files` until parity passes; then `zetaris`). If Zetaris is unreachable: fail loudly with a clear message, never silently fall back (SAMPLE_MODE stays file-based and documented as such).
5. `npm run zetaris:parity`: load via both sources, normalise types, deep-compare; print per-table row counts and the first difference if any. Exit non-zero on any difference.
6. Unit tests with a mocked HTTP layer (login shape variants, record-as-object vs record-as-array, paging, string numbers incl. exponent form, error message on unreachable). Do not hit the live Zetaris from tests.

## Rules

- Do not touch `vendor/`, `data/` or `eval/gold/`. Do not edit files the running ingest uses unless needed; the human may be running `npm run ingest` right now — never delete or rewrite `state/` or `cache/`.
- No model calls in this task.
- Never print credentials, tokens or the org id.

## Done when

typecheck, all tests, `validate:data`, `eval:oracle` green; `zetaris:register` dry-run prints the full SQL. Then report the exact commands the human should run, in order: (1) add the two Zetaris lines to `.env` (tell them which keys), (2) `npm run sources:serve` in one terminal, (3) `npm run zetaris:register -- --apply`, (4) `npm run zetaris:parity`. Stop there. No commit, no push.
