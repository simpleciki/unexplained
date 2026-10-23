// Builds the model client for a run: Meterless Runtime with the token from .env, or (SAMPLE_MODE) no
// provider at all and the recorded responses in cache/samples/. Also chooses model ids and writes the trace.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, relative } from "node:path";
import { MeterlessRuntime } from "../llm/meterless.ts";
import { FileCache } from "../llm/cache.ts";
import { DEFAULT_MODE_ORDER, FileDeadModes, parseModeOrder } from "../llm/modes.ts";
import type { CallEvent } from "../llm/client.ts";
import { CallBudget, ModelClient } from "../llm/client.ts";
import type { ChatProvider } from "../llm/provider.ts";
import { createTraceLogger } from "../trace.ts";
import { MODELS } from "../agents/shared.ts";
import type { ModelIds } from "../agents/shared.ts";

export type Runtime = { client: ModelClient; models: ModelIds; events: CallEvent[]; sampleMode: boolean; modeOrder?: string[]; orderSource?: "env" | "default" };

// Which call names each role uses (the agent field of a call).
const AGENTS: Record<keyof ModelIds, string[]> = {
  researcher: ["Researcher.extract"],
  skeptic: ["Skeptic.cards", "Skeptic.answer"],
  keeper: ["Keeper.relate"],
  router: ["Router"],
  judge: ["Judge.explained"],
  explainer: ["Explainer"],
};

// The route each agent really uses: a fallback that stuck, else the pinned order, else its own mode.
export function routeLines(rt: Runtime): string[] {
  return (Object.keys(AGENTS) as (keyof ModelIds)[]).flatMap((role) =>
    AGENTS[role].map((agent) => {
      const stuck = rt.client.sticky.get(agent);
      if (stuck) return `${agent}: ${stuck} (after a fallback)`;
      if (rt.modeOrder?.length) return `${agent}: ${rt.modeOrder.join(" > ")} (${rt.orderSource === "env" ? "pinned by METERLESS_MODE_ORDER" : "default order"})`;
      return `${agent}: ${rt.models[role]}`;
    }),
  );
}

export const samplesDir = (root: string) => join(root, "cache/samples");

// meterless/deep for Keeper, Judge and Skeptic when the runtime lists it; meterless/auto otherwise.
export function chooseModels(available: string[]): ModelIds {
  const strong = available.includes(MODELS.deep) ? MODELS.deep : MODELS.auto;
  return { researcher: MODELS.auto, router: MODELS.auto, explainer: MODELS.auto, keeper: strong, judge: strong, skeptic: strong };
}

export async function makeRuntime(root: string, opts: { maxCalls: number; sampleMode: boolean; teeSamples?: boolean; provider?: ChatProvider }): Promise<Runtime> {
  const events: CallEvent[] = [];
  if (opts.sampleMode) {
    const f = join(samplesDir(root), "models.json");
    const models = existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as ModelIds) : chooseModels([]);
    const client = new ModelClient(null, new FileCache(samplesDir(root), { readOnly: true }), new CallBudget(0), (e) => events.push(e));
    return { client, models, events, sampleMode: true };
  }
  // METERLESS_MODE_ORDER wins when set (validated before any request); otherwise the default pinned order.
  const fromEnv = parseModeOrder(process.env.METERLESS_MODE_ORDER);
  const modeOrder = fromEnv ?? DEFAULT_MODE_ORDER;
  const orderSource = fromEnv ? "env" : "default";
  let provider = opts.provider;
  if (!provider) {
    const token = process.env.METERLESS_RUNTIME_TOKEN ?? "";
    if (!token) throw new Error("METERLESS_RUNTIME_TOKEN is not set: create .env from .env.example, then run with node --env-file=.env");
    provider = new MeterlessRuntime({ token, baseUrl: process.env.METERLESS_BASE_URL, appId: process.env.METERLESS_APP_ID });
  }
  const available = await provider.listModels();
  const models = chooseModels(available);
  const cache = new FileCache(join(root, "cache"), { tee: opts.teeSamples ? samplesDir(root) : undefined });
  if (opts.teeSamples) {
    mkdirSync(samplesDir(root), { recursive: true });
    writeFileSync(join(samplesDir(root), "models.json"), JSON.stringify(models, null, 2) + "\n");
  }
  const client = new ModelClient(provider, cache, new CallBudget(opts.maxCalls), (e) => events.push(e), {
    availableModels: available,
    modeOrder,
    deadModes: new FileDeadModes(join(root, "state/dead-modes.json")),
  });
  return { client, models, events, sampleMode: false, modeOrder, orderSource };
}

// One trace line per model call. The model that answered goes into outcome; no prompt text, no token.
export async function writeTrace(root: string, name: string, events: CallEvent[]): Promise<string> {
  const runId = `${name}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const trace = createTraceLogger(runId, join(root, "logs"));
  for (const e of events) {
    await trace.append({
      phase: e.stage,
      agent: e.agent,
      action: e.action ?? "model_call",
      input_ref: e.prompt_hash,
      output_ref: "",
      outcome:
        e.action === "route_fallback"
          ? `requested=${e.requested_mode};dead=${e.dead_model};used=${e.mode_used};model=${e.model_answered}`
          : `${e.outcome};cache=${e.cache};model=${e.model_answered || "none"}`,
      retry_count: e.retry_count,
      latency_ms: e.latency_ms,
    });
  }
  return relative(root, trace.path);
}
