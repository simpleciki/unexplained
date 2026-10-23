// Started by `npm run ui [-- --source files|zetaris]` (src/cli/ui.ts).
// The gatekeeper screen on http://127.0.0.1:${UI_PORT:-8095}/ (this machine only). Node's http module and
// one HTML file, no dependencies. It never calls a model: it reads state/, data/ and review/judgments.jsonl,
// and the only thing it writes is a judgment a person submits.
// --source files (the default here) reads data/ directly; --source zetaris reads through Zetaris and fails
// loudly if it is unreachable.
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { loadData } from "../adapters/zetaris.ts";
import type { Dataset } from "../engine/types.ts";
import { check, jobs, ledger, loadCtx, meta, postJudgment, queue } from "./api.ts";
import type { Ctx } from "./api.ts";

export type Reply = { status: number; type: "json" | "html"; body: string };
const json = (status: number, v: unknown): Reply => ({ status, type: "json", body: JSON.stringify(v) });

// Routes one request. ctx is held in a box so a judgment can rebuild it (ledger and engine change).
export function route(box: { ctx: Ctx; html: string }, method: string, url: string, body?: string): Reply {
  const u = new URL(url, "http://127.0.0.1");
  const p = u.pathname;
  if (method === "GET" && (p === "/" || p === "/index.html")) return { status: 200, type: "html", body: box.html };
  if (method === "GET" && p === "/api/ledger") return json(200, ledger(box.ctx));
  if (method === "GET" && p === "/api/meta") return json(200, meta(box.ctx));
  if (method === "GET" && p === "/api/jobs") return json(200, jobs(box.ctx));
  if (method === "GET" && p === "/api/queue") return json(200, queue(box.ctx, u.searchParams.get("job") ?? undefined));
  if (method === "GET" && p === "/api/check") {
    const doc = u.searchParams.get("doc");
    const r = doc ? check(box.ctx, doc) : null;
    return r ? json(200, r) : json(404, { errors: [`unknown document ${doc ?? "(none)"}`] });
  }
  if (method === "POST" && p === "/api/judgments") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body ?? "");
    } catch {
      return json(400, { errors: ["body is not JSON"] });
    }
    const r = postJudgment(box.ctx, parsed);
    if (r.status === 400) return json(400, { errors: r.errors });
    box.ctx = loadCtx(box.ctx.root, box.ctx.data);
    return json(201, { judgment: r.judgment, ledger: ledger(box.ctx) });
  }
  return json(404, { errors: [`no route ${method} ${p}`] });
}

export const uiHtml = (root: string) => readFileSync(join(root, "src/ui/index.html"), "utf8");

export async function startServer(root: string, argv: string[]) {
  const source = argv.includes("--source") ? argv[argv.indexOf("--source") + 1] : "files";
  if (source !== "files" && source !== "zetaris") throw new Error("--source must be files or zetaris");
  const data: Dataset = await loadData(root, source);
  const box = { ctx: loadCtx(root, data), html: uiHtml(root) };
  const port = Number(process.env.UI_PORT ?? 8095);
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > 100_000) req.destroy();
      else chunks.push(c);
    });
    req.on("end", () => {
      let r: Reply;
      try {
        r = route(box, req.method ?? "GET", req.url ?? "/", Buffer.concat(chunks).toString("utf8"));
      } catch (e) {
        r = json(500, { errors: [(e as Error).message] });
      }
      res.writeHead(r.status, { "content-type": r.type === "html" ? "text/html; charset=utf-8" : "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(r.body);
    });
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(box.ctx.view.ledger.line);
    console.log(`gatekeeper screen: http://127.0.0.1:${port}/  (data from ${source}; no model calls)`);
  });
}
