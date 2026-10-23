import { cpSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { probeCacheMisses } from "./cache-probe.ts";

describe("cache probe", () => {
  it("with an empty cache every extraction misses, and the probed root is not written to", async () => {
    const root = mkdtempSync(join(tmpdir(), "unexplained-probe-root-"));
    cpSync(join(import.meta.dirname, "../../data"), join(root, "data"), { recursive: true });
    const p = await probeCacheMisses(root);
    expect(p.cached).toBe(0);
    expect(p.byAgent["Researcher.extract"]).toEqual({ hit: 0, miss: 116 });
    expect(existsSync(join(root, "cache"))).toBe(false);
    expect(existsSync(join(root, "state"))).toBe(false);
  }, 60_000);
});
