// Zetaris SQL client for the local 2.4.3.1 install: login once per run, run one statement, read every
// page, normalise records (objects or arrays) to {column: value}. Credentials, token and org id are
// never logged; trace events carry only the SQL hash, row count, latency and outcome.
import { createHash, randomUUID } from "node:crypto";

export type ZetarisOptions = {
  url?: string;
  username: string;
  password: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  onEvent?: (e: QueryEvent) => void;
};
// target: the table or view the statement reads, so the trace shows which Zetaris object was used.
export type QueryEvent = { action: "login" | "query"; sql_hash: string; rows: number; latency_ms: number; outcome: string; target?: string };
export type Row = Record<string, unknown>;

export class ZetarisError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "ZetarisError";
  }
}

const RUN_QUERY = "/api/proxy/sql-editor/sqls/run-query";
const ROW_LIMIT = 100_000; // far above our largest table; total is checked against what arrives

// A column descriptor may be a plain name or an object carrying one.
export function headerName(h: unknown, i: number): string {
  if (typeof h === "string") return h;
  if (h && typeof h === "object") {
    const o = h as Record<string, unknown>;
    for (const k of ["name", "columnName", "column_name", "label", "field"]) if (typeof o[k] === "string") return o[k] as string;
  }
  throw new ZetarisError(`column header ${i} has no name`);
}

// {headers, data: [[...]], total} -> rows keyed by the caller's columns (matched by header name, any
// case, table prefix ignored). Without a header for a column, the caller's column order is used.
export function readRunQuery(reply: Record<string, unknown>, columns: string[]): Row[] {
  if (reply.error || (reply.message && !("data" in reply))) throw new ZetarisError(`Zetaris query failed: ${String(reply.error ?? reply.message).slice(0, 300)}`);
  const data = reply.data ?? [];
  if (!Array.isArray(data)) throw new ZetarisError("run-query answered without a data array");
  const headers = Array.isArray(reply.headers) ? reply.headers.map(headerName) : [];
  if (typeof reply.total === "number" && reply.total !== data.length) {
    throw new ZetarisError(`run-query returned ${data.length} rows but reports total ${reply.total}: incomplete result`);
  }
  const cols = headers.length ? headers : columns;
  const rows = normaliseRecords(data, cols);
  if (!headers.length || !columns.length) return rows;
  return normaliseRecords(rows.map((r) => Object.fromEntries(headers.map((h) => [h, r[h]]))), columns);
}
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex").slice(0, 16);

// The token and org id field names vary, and ids may be numbers (the live 2.4.3.1 login returns a
// numeric orgId); take the first non-empty one and turn it into a string. Never a hardcoded org.
export function readLogin(body: unknown): { token: string; orgId: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const nested = [b, b.data, b.user, b.result].filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x));
  const pick = (keys: string[]) => {
    for (const o of nested) {
      for (const k of keys) {
        const v = o[k];
        if ((typeof v === "string" && v.trim()) || (typeof v === "number" && Number.isFinite(v))) return String(v);
      }
    }
    return "";
  };
  // Field names only, never values, in the error.
  const present = () => [...new Set(nested.flatMap((o) => Object.keys(o)))].join(", ") || "none";
  const token = pick(["idToken", "token", "accessToken", "access_token"]);
  const orgId = pick(["orgId", "org_id", "organizationId", "organisationId"]);
  if (!token) throw new ZetarisError(`Zetaris login answered without a token (looked for idToken, token, accessToken; keys present: ${present()})`);
  if (!orgId) throw new ZetarisError(`Zetaris login answered without an org id (looked for orgId, org_id, organizationId; keys present: ${present()})`);
  return { token, orgId };
}

// Records may be objects (any key case) or arrays in column order; the caller's columns decide.
export function normaliseRecords(records: unknown, columns: string[]): Row[] {
  if (!Array.isArray(records)) throw new ZetarisError("query answered without a records array");
  return records.map((r, i) => {
    if (Array.isArray(r)) {
      if (r.length !== columns.length) throw new ZetarisError(`record ${i} has ${r.length} values for ${columns.length} columns`);
      return Object.fromEntries(columns.map((c, j) => [c, r[j]]));
    }
    if (r && typeof r === "object") {
      const lower = Object.fromEntries(Object.entries(r as Row).map(([k, v]) => [k.toLowerCase().replace(/^.*\./, ""), v]));
      return Object.fromEntries(columns.map((c) => [c, lower[c.toLowerCase()]]));
    }
    throw new ZetarisError(`record ${i} is neither an object nor an array`);
  });
}

export class ZetarisClient {
  readonly url: string;
  private auth?: { token: string; orgId: string };
  private fetchImpl: typeof fetch;
  private sleep: (ms: number) => Promise<void>;

  constructor(private opts: ZetarisOptions) {
    this.url = (opts.url ?? "http://127.0.0.1:3000").replace(/\/$/, "");
    this.fetchImpl = opts.fetch ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  // One HTTP call with a 30 s timeout and one retry on 5xx or timeout. Unreachable = loud, clear error.
  private async call(path: string, init: RequestInit, headers: Record<string, string>): Promise<unknown> {
    const once = async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 30_000);
      try {
        const res = await this.fetchImpl(`${this.url}${path}`, { ...init, headers: { "Content-Type": "application/json", "X-Request-ID": randomUUID(), ...headers }, signal: ctrl.signal });
        const text = await res.text();
        if (!res.ok) throw new ZetarisError(`Zetaris ${path.split("?")[0]} answered HTTP ${res.status}: ${text.slice(0, 300)}`, res.status);
        return text ? JSON.parse(text) : {};
      } catch (e) {
        if (e instanceof ZetarisError) throw e;
        const timeout = (e as Error).name === "AbortError";
        throw new ZetarisError(timeout ? `Zetaris did not answer ${path.split("?")[0]} within ${this.opts.timeoutMs ?? 30_000} ms` : `Zetaris is not reachable at ${this.url} (${(e as Error).message}). Start it, or run with --source files.`, timeout ? 504 : 0);
      } finally {
        clearTimeout(timer);
      }
    };
    try {
      return await once();
    } catch (e) {
      const s = (e as ZetarisError).status ?? 0;
      if (s >= 500 || s === 504) {
        await this.sleep(1000);
        return once();
      }
      throw e;
    }
  }

  async login(): Promise<void> {
    if (this.auth) return;
    const started = Date.now();
    const body = await this.call("/api/auth/login", { method: "POST", body: JSON.stringify({ username: this.opts.username, password: this.opts.password }) }, {});
    this.auth = readLogin(body);
    this.opts.onEvent?.({ action: "login", sql_hash: "", rows: 0, latency_ms: Date.now() - started, outcome: "ok" });
  }

  private authHeaders() {
    return { Authorization: `Bearer ${this.auth!.token}`, "X-Org-ID": this.auth!.orgId };
  }

  // One statement (DDL or SELECT) through the SQL editor endpoint, which runs both. Rows come back as
  // arrays of strings with column descriptors in "headers"; they are mapped by header name. The reply's
  // total must match the rows received, or the result is incomplete and the call fails.
  async query(sql: string, columns: string[] = [], target?: string): Promise<Row[]> {
    await this.login();
    const started = Date.now();
    try {
      const reply = (await this.call(RUN_QUERY, { method: "POST", body: JSON.stringify({ sql, limit: ROW_LIMIT }) }, this.authHeaders())) as Record<string, unknown>;
      const rows = readRunQuery(reply, columns);
      this.opts.onEvent?.({ action: "query", target, sql_hash: sha(sql), rows: rows.length, latency_ms: Date.now() - started, outcome: "ok" });
      return rows;
    } catch (e) {
      this.opts.onEvent?.({ action: "query", target, sql_hash: sha(sql), rows: 0, latency_ms: Date.now() - started, outcome: `error: ${(e as Error).message.slice(0, 200)}` });
      throw e;
    }
  }

}

export function clientFromEnv(onEvent?: (e: QueryEvent) => void): ZetarisClient {
  const username = process.env.ZETARIS_USERNAME ?? "";
  const password = process.env.ZETARIS_PASSWORD ?? "";
  if (!username || !password) throw new ZetarisError("ZETARIS_USERNAME and ZETARIS_PASSWORD must be set in .env");
  return new ZetarisClient({ url: process.env.ZETARIS_URL, username, password, onEvent });
}
