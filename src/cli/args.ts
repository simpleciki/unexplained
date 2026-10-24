// Command-line flags shared by every command that can call a model.
// --max-calls N is required (the call budget is a hard limit); --dry-run prints the estimate and exits.
export type Args = {
  maxCalls: number | null;
  dryRun: boolean;
  question?: string;
  asOf?: string;
  subset?: "dev" | "full";
  sample?: string;
  records?: string[]; // ingest sample mode: only these record ids (needs --out)
  out?: string; // ingest sample mode: output directory, never state/ itself
  groups?: string[]; // eval:compare: which groups to run, in order (default a,c)
  source: "files" | "zetaris"; // where the engine reads data/ tables and records from
};

export function parseArgs(argv: string[]): Args {
  const out: Args = { maxCalls: null, dryRun: false, source: "zetaris" }; // --source files: no Docker needed
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--max-calls") out.maxCalls = Number(next());
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--question") out.question = next();
    else if (a === "--as-of") out.asOf = next();
    else if (a === "--subset") {
      const s = next();
      if (s !== "dev" && s !== "full") throw new Error("--subset must be dev or full");
      out.subset = s;
    } else if (a === "--sample") out.sample = next();
    else if (a === "--records") out.records = next().split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--out") out.out = next();
    else if (a === "--group") out.groups = next().split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    else if (a === "--source") {
      const s = next();
      if (s !== "files" && s !== "zetaris") throw new Error("--source must be files or zetaris");
      out.source = s;
    }
    else throw new Error(`unknown flag ${a}`);
  }
  return out;
}

export function requireMaxCalls(a: Args): number {
  if (a.maxCalls === null || !Number.isInteger(a.maxCalls) || a.maxCalls < 0) {
    throw new Error("refusing to run without --max-calls N (the call budget is a hard limit)");
  }
  return a.maxCalls;
}

export const root = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");

export async function main(run: () => Promise<void>) {
  try {
    await run();
  } catch (e) {
    console.error(`error: ${(e as Error).message}`);
    process.exit(1);
  }
}
