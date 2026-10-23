// Zetaris layer against a mocked HTTP layer and a local source server on a random port.
// Nothing here talks to the live Zetaris.
import type { AddressInfo } from "node:net";
import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadDataset } from "../engine/data.ts";
import { loadDatasetFromZetaris, selectFor } from "../adapters/zetaris.ts";
import { ZetarisClient, normaliseRecords, readLogin, readRunQuery } from "./client.ts";
import type { QueryEvent } from "./client.ts";
import { compareDatasets } from "./parity.ts";
import { applyStatements, describeBy, registerStatements } from "./register-sql.ts";
import { TABLES, formatValue, qualified, viewName } from "./schema.ts";
import { VIEWS, computeViews, selectView } from "./views.ts";
import { rowsFor, startSourceServer } from "./source-server.ts";

const root = join(import.meta.dirname, "../..");
// The oracle writes results and a trace; run it on a copy so the repo's eval/results and logs stay as they are.
function tempCopy() {
  const dir = mkdtempSync(join(tmpdir(), "unexplained-zetaris-"));
  for (const d of ["data", "eval/gold"]) cpSync(join(root, d), join(dir, d), { recursive: true });
  return dir;
}
const files = loadDataset(root);
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

// A fake Zetaris SQL editor endpoint: login, then answers SELECTs from the files dataset the way
// run-query does (rows as arrays of strings, column headers as names or objects, any case).
function fakeZetaris(opts: { headerStyle?: "string" | "object"; total?: (n: number) => number; loginBody?: unknown; failOn?: RegExp; failWith?: string } = {}) {
  const calls: { url: string; headers: Record<string, string>; body?: string }[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const u = String(url);
    calls.push({ url: u, headers: Object.fromEntries(new Headers(init?.headers).entries()), body: init?.body as string | undefined });
    if (u.endsWith("/api/auth/login")) return json(200, opts.loginBody ?? { idToken: "TOKEN-xyz", refreshToken: "R", orgId: 123 });
    if (u.endsWith("/api/proxy/sql-editor/sqls/run-query")) {
      const sql = JSON.parse(String(init?.body)).sql as string;
      if (opts.failOn?.test(sql)) return json(400, { message: opts.failWith ?? "boom" });
      const v = VIEWS.find((x) => selectView(x) === sql);
      if (v) {
        const rows = computeViews(files)[v.name].map((r) => v.columns.map(([c]) => r[c]));
        return json(200, { headers: v.columns.map(([c]) => c.toUpperCase()), data: rows, total: rows.length, timeUsed: 20 });
      }
      const t = TABLES.find((x) => selectFor(x) === sql);
      if (!t) return json(200, { headers: [], data: [], total: 0, timeUsed: 3 }); // DDL
      const headers = t.columns.map(([c]) => (opts.headerStyle === "object" ? { name: c.toUpperCase(), type: "string" } : c));
      const data = rowsFor(files, t).map((r) => t.columns.map(([c, type]) => (type === "money" ? Number(r[c]).toExponential() : type === "number" ? `${r[c]}.0` : r[c])));
      return json(200, { headers, data, total: opts.total ? opts.total(data.length) : data.length, timeUsed: 12 });
    }
    return json(404, {});
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

describe("Zetaris client", () => {
  it("reads the token and org id under their different names, and refuses a login without them", () => {
    expect(readLogin({ idToken: "a", orgId: "o" })).toEqual({ token: "a", orgId: "o" });
    expect(readLogin({ token: "b", org_id: "o" })).toEqual({ token: "b", orgId: "o" });
    expect(readLogin({ data: { accessToken: "c", organizationId: "o" } })).toEqual({ token: "c", orgId: "o" });
    expect(() => readLogin({ orgId: "o" })).toThrow(/without a token/);
    expect(() => readLogin({ idToken: "a" })).toThrow(/without an org id/);
  });

  it("normalises records given as objects (any key case) or as arrays", () => {
    expect(normaliseRecords([{ QUOTE_ID: "Q1", "q.TOTAL": 5 }], ["quote_id", "total"])).toEqual([{ quote_id: "Q1", total: 5 }]);
    expect(normaliseRecords([["Q1", 5]], ["quote_id", "total"])).toEqual([{ quote_id: "Q1", total: 5 }]);
    expect(() => normaliseRecords([["Q1"]], ["quote_id", "total"])).toThrow(/1 values for 2 columns/);
  });

  it("formats string numbers, including exponent form, exactly as data/ does", () => {
    expect(formatValue("1.104E3", "money")).toBe("1104.00");
    expect(formatValue(1104, "money")).toBe("1104.00");
    expect(formatValue("3.0", "int")).toBe("3");
    expect(formatValue("1.4e1", "number")).toBe("14");
  });

  it("logs in once, runs SQL through run-query with the auth headers and a high limit, and keeps secrets out of events", async () => {
    const z = fakeZetaris();
    const events: QueryEvent[] = [];
    const client = new ZetarisClient({ username: "u", password: "SECRET-PW", fetch: z.fetch, onEvent: (e) => events.push(e) });
    const t = TABLES.find((x) => x.path === "quote_lines")!;
    const rows = await client.query(selectFor(t), t.columns.map(([c]) => c));
    await client.query(selectFor(t), t.columns.map(([c]) => c));
    expect(rows).toHaveLength(rowsFor(files, t).length);
    expect(z.calls.filter((c) => c.url.endsWith("/login"))).toHaveLength(1);
    const run = z.calls.find((c) => c.url.endsWith("/run-query"))!;
    expect(run.headers.authorization).toBe("Bearer TOKEN-xyz");
    expect(run.headers["x-org-id"]).toBe("123");
    expect(run.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(run.body!)).toEqual({ sql: selectFor(t), limit: 100000 });
    expect(z.calls.some((c) => c.url.includes("/query/sql/"))).toBe(false); // one path only
    expect(JSON.stringify(events)).not.toMatch(/SECRET-PW|TOKEN-xyz/);
  });

  it("maps columns by header name (plain or object, any case), and refuses a short result", () => {
    expect(readRunQuery({ headers: ["TOTAL", "quote_id"], data: [["5.0", "Q1"]], total: 1 }, ["quote_id", "total"])).toEqual([{ quote_id: "Q1", total: "5.0" }]);
    expect(readRunQuery({ headers: [{ name: "q.QUOTE_ID" }, { columnName: "total" }], data: [["Q1", "1E1"]], total: 1 }, ["quote_id", "total"])).toEqual([{ quote_id: "Q1", total: "1E1" }]);
    expect(readRunQuery({ headers: [{ name: "one" }], data: [["1"]], total: 1, timeUsed: 941 }, [])).toEqual([{ one: "1" }]);
    expect(() => readRunQuery({ headers: ["a"], data: [["1"]], total: 2 }, ["a"])).toThrow(/returned 1 rows but reports total 2: incomplete/);
    expect(() => readRunQuery({ message: "Bad Select SQL" }, [])).toThrow(/Zetaris query failed: Bad Select SQL/);
    expect(() => readRunQuery({ headers: ["a", "b"], data: [["1"]], total: 1 }, ["a"])).toThrow(/1 values for 2 columns/);
  });

  it("registers through run-query: creates, skips what exists, stops on the first real error", async () => {
    const statements = registerStatements(8790);
    const ok = fakeZetaris({ failOn: /CREATE SCHEMASTORE CONTAINER/, failWith: "Container unexplained already exists" });
    const client = new ZetarisClient({ username: "u", password: "p", fetch: ok.fetch });
    const r = await applyStatements((sql) => client.query(sql), statements);
    expect(r).toEqual({ created: statements.length - 1, skipped: 1 });
    const bad = fakeZetaris({ failOn: /CREATE LIGHTNING REST TABLE quote_lines_raw/, failWith: "Unknown option endpoint" });
    const r2 = await applyStatements((sql) => new ZetarisClient({ username: "u", password: "p", fetch: bad.fetch }).query(sql), statements);
    expect(r2.failed?.label).toBe("REST table CLIENT_PORTAL.quote_lines_raw");
    expect(r2.failed?.message).toMatch(/HTTP 400: .*Unknown option endpoint/);
  });

  it("fails loudly with a clear message when Zetaris is unreachable, and retries a 5xx once", async () => {
    const down = new ZetarisClient({ username: "u", password: "p", fetch: (async () => { throw new TypeError("fetch failed"); }) as typeof fetch, sleep: async () => {} });
    await expect(down.query("SELECT 1")).rejects.toThrow(/Zetaris is not reachable at http:\/\/127\.0\.0\.1:3000 .*--source files/);
    let n = 0;
    const flaky = new ZetarisClient({ username: "u", password: "p", sleep: async () => {}, fetch: (async () => (++n === 1 ? json(503, {}) : json(200, { idToken: "t", orgId: "o" }))) as typeof fetch });
    await flaky.login();
    expect(n).toBe(2);
  });
});

describe("adapter and parity", () => {
  it("loads the same dataset through Zetaris as from files (string rows, exponent numbers, object headers)", async () => {
    const z = fakeZetaris({ headerStyle: "object" });
    const viaZetaris = await loadDatasetFromZetaris(new ZetarisClient({ username: "u", password: "p", fetch: z.fetch }));
    const parity = compareDatasets(files, viaZetaris);
    expect(parity.filter((r) => r.firstDifference)).toEqual([]);
    expect(parity.map((r) => r.table)).toEqual(expect.arrayContaining(["v_invoice_vs_approved", "v_job_evidence_timeline"]));
    expect(viaZetaris.views?.job_evidence_timeline?.length).toBe(116); // 52 client messages + 28 internal + 36 field notes
    expect(viaZetaris.tables.quoteLines).toEqual(files.tables.quoteLines);
    expect(viaZetaris.records).toEqual(files.records);
  });

  it("the engine answers the same when Zetaris returns rows in key order instead of file order", async () => {
    const keyOrdered = structuredClone(files);
    for (const t of TABLES.filter((x) => !x.key.startsWith("records_"))) {
      const rows = keyOrdered.tables[t.key as keyof typeof keyOrdered.tables];
      const key = (r: Record<string, string>) => t.orderBy.map((c) => r[c].padStart(12, "0")).join("|");
      rows.sort((a, b) => key(a).localeCompare(key(b)));
      rows.reverse(); // and then backwards, to be sure order carries no meaning
    }
    const { runOracle } = await import("../eval/oracle.ts");
    const out = await runOracle(tempCopy(), keyOrdered);
    expect(out.failing).toEqual([]);
  });

  it("parity reports the first difference", () => {
    const changed = structuredClone(files);
    changed.tables.invoices[0].total = "9999.00";
    const diff = compareDatasets(files, changed).find((r) => r.firstDifference)!;
    expect(diff.table).toBe("/portal/invoices");
    expect(diff.firstDifference).toMatch(/total files="2156.00" zetaris="9999.00"/);
  });
});

describe("source server and registration SQL", () => {
  it("serves both systems read-only on 127.0.0.1 and nothing else", async () => {
    const seen: string[] = [];
    const server = await startSourceServer(root, 0, (m, p, s) => seen.push(`${m} ${p} ${s}`));
    const port = (server.address() as AddressInfo).port;
    const get = (p: string, method = "GET") => fetch(`http://127.0.0.1:${port}${p}`, { method });
    const quotes = (await (await get("/portal/quote_versions")).json()) as { data: unknown[] };
    expect(quotes.data).toHaveLength(files.tables.quotes.length);
    const notes = (await (await get("/ops/records_internal_note")).json()) as { data: { source_type: string }[] };
    expect(notes.data.every((r) => r.source_type === "internal_note")).toBe(true);
    expect((await get("/ops/quote_versions")).status).toBe(404);
    expect((await get("/portal/quote_versions", "POST")).status).toBe(405);
    expect((server.address() as AddressInfo).address).toBe("127.0.0.1");
    expect(seen[0]).toBe("GET /portal/quote_versions 200");
    server.close();
  });

  it("prints every statement: 2 databases, a container, a REST table and a view per path, 3 cross-source views", () => {
    const s = registerStatements(8790);
    expect(s).toHaveLength(3 + TABLES.length * 2 + 3);
    expect(s.filter((x) => x.sql.startsWith("CREATE LIGHTNING REST TABLE"))).toHaveLength(TABLES.length);
    expect(s.find((x) => x.label === "view portal_quote_lines")!.sql).toMatch(/CAST\(r\.`amount` AS DECIMAL\(12,2\)\)/);
    for (const v of ["v_quotes_by_trade", "v_invoice_vs_approved", "v_job_evidence_timeline"]) {
      const sql = s.find((x) => x.label.endsWith(v))!.sql;
      for (const t of TABLES) expect(sql.split(qualified(viewName(t))).length - 1).toBeLessThanOrEqual(1);
    }
    expect(() => describeBy("bad: colon")).toThrow(/refuses/);
  });
});

describe("the engine reads the cross-source views", () => {
  it("P7 shows the joined invoice row and P5 the two-system timeline; conclusions match the in-memory path", async () => {
    const { buildEngine } = await import("../engine/engine.ts");
    const { answerQuestion } = await import("../engine/answer.ts");
    const { parseJsonl } = await import("../engine/data.ts");
    const { readFileSync } = await import("node:fs");
    const gold = (f: string) => parseJsonl<never>(readFileSync(join(root, "eval/gold", f), "utf8"));
    const z = fakeZetaris({ headerStyle: "object" });
    const viaZetaris = await loadDatasetFromZetaris(new ZetarisClient({ username: "u", password: "p", fetch: z.fetch }));
    const withViews = buildEngine(root, gold("gold_cards.jsonl"), gold("gold_edges.jsonl"), undefined, viaZetaris);
    const plain = buildEngine(root, gold("gold_cards.jsonl"), gold("gold_edges.jsonl"), undefined, files);
    const qs = gold("gold_questions.jsonl") as unknown as { question_id: string; question: string; as_of: string | null; seats: string[] }[];
    const q = (id: string) => qs.find((x) => x.question_id === id)!;

    const inv = answerQuestion(withViews, q("q-p7-pw03-inv"));
    const p7 = inv.flags.find((f) => f.pattern === "P7")!;
    expect(p7.details.cross_source).toEqual([expect.objectContaining({ invoice_id: "INV-PW-03", trade: "roofing", billed_quote_id: "Q-PW-03-v2", approved_quote_id: "Q-PW-03-v1" })]);
    expect(p7.details.approved_version).toBe("Q-PW-03-v1"); // decided from dated records, not the view

    const why = answerQuestion(withViews, q("q-p5-heron-why"));
    const timeline = why.flags.find((f) => f.pattern === "P5")!.details.timeline as { system: string }[];
    expect(new Set(timeline.map((t) => t.system))).toEqual(new Set(["client portal", "contractor ops"]));

    for (const id of ["q-p7-pw03-inv", "q-p5-heron-why", "q-ctrl-nl01-inv", "q-p7-heron-invoice"]) {
      const a = answerQuestion(withViews, q(id));
      const b = answerQuestion(plain, q(id));
      expect(a.flags.map((f) => [f.pattern, f.evidence])).toEqual(b.flags.map((f) => [f.pattern, f.evidence]));
      expect([a.current_card, a.in_effect_card]).toEqual([b.current_card, b.in_effect_card]);
    }
  });
});
