// Demo mode: judgments go to .demo/review/judgments.jsonl, never to the real file; normal mode is unchanged.
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadDataset } from "../engine/data.ts";
import { extractableRecords } from "../pipeline/ingest.ts";
import { loadCtx } from "./api.ts";
import { DEMO_LABEL, prepareDemoRoot, withDemoLabel } from "./demo.ts";
import { route } from "./server.ts";

const repo = join(import.meta.dirname, "../..");

// A temporary repo copy with data/, a small invented state/ and a real-looking review/judgments.jsonl.
function setup() {
  const root = mkdtempSync(join(tmpdir(), "unexplained-demo-"));
  cpSync(join(repo, "data"), join(root, "data"), { recursive: true });
  const data = loadDataset(root);
  const records = extractableRecords(data.records);
  mkdirSync(join(root, "state"));
  writeFileSync(join(root, "state/cards.json"), "[]");
  writeFileSync(join(root, "state/edges.json"), "[]");
  writeFileSync(join(root, "state/ingest-report.json"), JSON.stringify({ records_total: records.length, records_done: records.length, records_rejected: [], records_prose_reply: [], records_failed_upstream: [], cards_gate_rejected: [], cards_dropped_by_skeptic: [] }));
  mkdirSync(join(root, "review"));
  writeFileSync(join(root, "review/judgments.jsonl"), "");
  return { root, data };
}
const judge = (record_id: string) => JSON.stringify({ record_id, verdict: "no_decision", cards: [], reason: "spot-checked: a work log", reviewer: "Ciki" });
const lines = (f: string) => readFileSync(f, "utf8").split("\n").filter(Boolean).length;

describe("demo mode", () => {
  it("writes a judgment to the copy, never to review/judgments.jsonl; a restart starts over from the real file", () => {
    const { root, data } = setup();
    const real = join(root, "review/judgments.jsonl");
    const before = readFileSync(real, "utf8");
    const dir = prepareDemoRoot(root);
    expect(lstatSync(join(dir, "data")).isSymbolicLink()).toBe(true);
    expect(lstatSync(join(dir, "review")).isSymbolicLink()).toBe(false);
    const box = { ctx: loadCtx(dir, data), html: "" };
    const doc = "INV-RM-03";
    const open = JSON.parse(route(box, "GET", `/api/check?doc=${doc}`).body).queue.spot_check;
    expect(open.length).toBeGreaterThan(0);
    for (const x of open) expect(route(box, "POST", "/api/judgments", judge(x.record_id)).status).toBe(201);
    expect(lines(join(dir, "review/judgments.jsonl"))).toBe(open.length);
    expect(readFileSync(real, "utf8")).toBe(before);
    expect(JSON.parse(route(box, "GET", `/api/check?doc=${doc}`).body).records.spot_check).toBe(0);
    // Restart: the copy is rebuilt from the real file, so the demo judgments are gone.
    prepareDemoRoot(root);
    expect(readFileSync(join(dir, "review/judgments.jsonl"), "utf8")).toBe(before);
  });

  it("normal mode is unchanged: a judgment goes to review/judgments.jsonl and no .demo/ is made", () => {
    const { root, data } = setup();
    const box = { ctx: loadCtx(root, data), html: "" };
    expect(route(box, "POST", "/api/judgments", judge("rec-0005")).status).toBe(201);
    expect(lines(join(root, "review/judgments.jsonl"))).toBe(1);
    expect(existsSync(join(root, ".demo"))).toBe(false);
  });

  it("serves the WO-PW-05 story with its on-hold ending: eval/ is linked, so hero_case.json is found", () => {
    const { root, data } = setup();
    cpSync(join(repo, "eval/demo"), join(root, "eval/demo"), { recursive: true });
    const dir = prepareDemoRoot(root);
    expect(lstatSync(join(dir, "eval")).isSymbolicLink()).toBe(true);
    const r = route({ ctx: loadCtx(dir, data), html: "" }, "GET", "/api/story?job=WO-PW-05");
    expect(r.status, r.body).toBe(200);
    expect(JSON.parse(r.body).ending).toMatchObject({ kind: "on_hold", held_usd: 2306 });
  });

  it("labels every page it serves as a demo copy", () => {
    for (const f of ["index.html", "home.html"]) {
      const html = withDemoLabel(readFileSync(join(repo, "src/ui", f), "utf8"));
      expect(html).toMatch(new RegExp(`<body[^>]*><div role="status"[^>]*>${DEMO_LABEL}</div>`));
    }
  });
});
