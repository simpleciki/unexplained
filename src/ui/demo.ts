// Demo mode (`npm run ui -- --demo`): judgments go to an isolated copy, never to review/judgments.jsonl.
// On every start, .demo/ is rebuilt from the real files: review/ is copied (the only folder the judgment form
// writes), data/, state/, eval/ (hero_case.json for the WO-PW-05 story) and the committed snapshot are links to the
// real ones (the UI only reads them; only npm run eval:oracle writes under eval/, never the UI); a link
// is made only for a folder that exists, so a fresh clone with no state/ reads the snapshot. The server then runs with
// .demo/ as its root, so a restart starts the demo over from the real record. .demo/ is git-ignored.
import { cpSync, existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";

export const DEMO_DIR = ".demo";
export const DEMO_LABEL = "Demo copy — judgments made here are not saved to the record";

export function prepareDemoRoot(root: string): string {
  const dir = join(root, DEMO_DIR);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "review"), { recursive: true });
  for (const d of ["data", "state", "eval", "snapshot"]) if (existsSync(join(root, d))) symlinkSync(join(root, d), join(dir, d), "dir");
  if (existsSync(join(root, "review"))) cpSync(join(root, "review"), join(dir, "review"), { recursive: true });
  return dir;
}

// A fixed label on every page the demo serves, so it is plain on screen (and in a recording) that this is a copy.
export function withDemoLabel(html: string): string {
  const label = `<div role="status" style="position:fixed;bottom:12px;left:50%;transform:translateX(-50%);z-index:9999;background:#1d1d1f;color:#fff;font:600 13px/1.3 -apple-system,BlinkMacSystemFont,'Helvetica Neue',sans-serif;padding:7px 14px;border-radius:999px;box-shadow:0 2px 8px rgba(0,0,0,.2)">${DEMO_LABEL}</div>`;
  return html.replace(/<body[^>]*>/, (m) => m + label);
}
