// Started by `npm run ui [-- --source files|zetaris] [--demo]` (src/cli/ui.ts).
// The gatekeeper screen on http://127.0.0.1:${UI_PORT:-8095}/ (this machine only). Node's http module and
// one HTML file, no dependencies. It never calls a model: it reads state/, data/ and review/judgments.jsonl,
// and the only thing it writes is a judgment a person submits.
// --source files (the default here) reads data/ directly; --source zetaris reads through Zetaris and fails
// loudly if it is unreachable.
// --demo writes judgments to an isolated copy in .demo/ (src/ui/demo.ts), rebuilt from the real files on every
// start, and labels every page as a demo copy.
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { loadData } from "../adapters/zetaris.ts";
import type { Dataset } from "../engine/types.ts";
import { CURATED_PROBLEMS, check, effective, jobs, ledger, loadCtx, meta, postJudgment, queue, story, summary } from "./api.ts";
import type { Ctx } from "./api.ts";
import { DEMO_DIR, prepareDemoRoot, withDemoLabel } from "./demo.ts";

export type Reply = { status: number; type: "json" | "html"; body: string };
const json = (status: number, v: unknown): Reply => ({ status, type: "json", body: JSON.stringify(v) });

// Routes one request. ctx is held in a box so a judgment can rebuild it (ledger and engine change).
export function route(box: { ctx: Ctx; html: string; home?: string }, method: string, url: string, body?: string): Reply {
  const u = new URL(url, "http://127.0.0.1");
  const p = u.pathname;
  // "/" is the home ("the call"); "/outbox" is the check page.
  if (method === "GET" && p === "/") return { status: 200, type: "html", body: box.home ?? box.html };
  if (method === "GET" && (p === "/outbox" || p === "/index.html")) return { status: 200, type: "html", body: box.html };
  if (method === "GET" && p === "/api/story") {
    // Without a job, the curated home story (the one job told end to end, docs/design/direction-approved.md).
    const r = story(box.ctx, u.searchParams.get("job") ?? "WO-NL-01");
    return r.status === 200 ? json(200, r.body) : json(r.status, { errors: r.errors });
  }
  if (method === "GET" && p === "/api/ledger") return json(200, ledger(box.ctx));
  if (method === "GET" && p === "/api/meta") return json(200, meta(box.ctx));
  if (method === "GET" && p === "/api/jobs") return json(200, jobs(box.ctx));
  if (method === "GET" && p === "/api/summary") {
    const view = u.searchParams.get("view") ?? "all";
    if (view !== "all" && view !== "curated") return json(400, { errors: ["view must be all or curated"] });
    const { states, ...s } = summary(box.ctx, view);
    // The curated view also lists its documents and why each problem example was picked.
    return json(200, view === "curated" ? { ...s, ids: Object.keys(states), picks: CURATED_PROBLEMS } : s);
  }
  if (method === "GET" && p === "/api/queue") return json(200, queue(box.ctx, u.searchParams.get("job") ?? undefined));
  if (method === "GET" && p === "/api/effective") {
    const r = effective(box.ctx, u.searchParams.get("record") ?? "", u.searchParams.get("quote") ?? "");
    return r ? json(200, r) : json(404, { errors: ["unknown record"] });
  }
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
    return json(201, { judgment: r.judgment, warnings: r.warnings, ledger: ledger(box.ctx) });
  }
  return json(404, { errors: [`no route ${method} ${p}`] });
}

export const uiHtml = (root: string) => readFileSync(join(root, "src/ui/index.html"), "utf8");
export const homeHtml = (root: string) => readFileSync(join(root, "src/ui/home.html"), "utf8");

export async function startServer(root: string, argv: string[]) {
  const source = argv.includes("--source") ? argv[argv.indexOf("--source") + 1] : "files";
  if (source !== "files" && source !== "zetaris") throw new Error("--source must be files or zetaris");
  const demo = argv.includes("--demo");
  const data: Dataset = await loadData(root, source);
  const ctxRoot = demo ? prepareDemoRoot(root) : root;
  const label = demo ? withDemoLabel : (h: string) => h;
  const box = { ctx: loadCtx(ctxRoot, data), html: label(uiHtml(root)), home: label(homeHtml(root)) };
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
    if (demo) console.log(`DEMO COPY: judgments go to ${DEMO_DIR}/review/judgments.jsonl, never to review/judgments.jsonl; restart to start over`);
    console.log(box.ctx.view.ledger.line);
    console.log(`home (the call): http://127.0.0.1:${port}/  ·  outbox (the check page): http://127.0.0.1:${port}/outbox  (data from ${source}; no model calls)`);
  });
}
