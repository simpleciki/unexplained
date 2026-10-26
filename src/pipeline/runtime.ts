// Builds the model client for a run: Meterless Runtime (Nightshift) with the token from .env, or (SAMPLE_MODE)
// no provider at all and the recorded responses in cache/samples/. AI_PROVIDER=nvidia-direct switches to the
// explicit NVIDIA fallback route (src/llm/nvidia-direct.ts); nothing else does. Also chooses model ids and
// writes the trace.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { MeterlessRuntime } from "../llm/meterless.ts";
import { NVIDIA_DIRECT_ID, NVIDIA_DIRECT_ORDER, NvidiaDirect } from "../llm/nvidia-direct.ts";
import { FileCache } from "../llm/cache.ts";
import { DEFAULT_MODE_ORDER, FileDeadModes, parseModeOrder } from "../llm/modes.ts";
import type { CallEvent } from "../llm/client.ts";
import { CallBudget, ModelClient } from "../llm/client.ts";
import type { ChatProvider } from "../llm/provider.ts";
import { createTraceLogger } from "../trace.ts";
import { MODELS } from "../agents/shared.ts";
import type { ModelIds } from "../agents/shared.ts";

export type Route = "nightshift" | "nvidia-direct";
export type Runtime = { client: ModelClient; models: ModelIds; events: CallEvent[]; sampleMode: boolean; modeOrder?: string[]; orderSource?: "env" | "default" | "nvidia-direct"; route?: Route | string; cacheDir?: string; cacheNamespace?: string };

// AI_PROVIDER: "nightshift" (the default, also when unset) or "nvidia-direct". Anything else is an error, so a
// typo never silently changes the route.
export function routeFromEnv(value = process.env.AI_PROVIDER): Route {
  const v = (value ?? "").trim().toLowerCase();
  if (v === "" || v === "nightshift") return "nightshift";
  if (v === NVIDIA_DIRECT_ID) return "nvidia-direct";
  throw new Error(`AI_PROVIDER must be nightshift (the default) or nvidia-direct, not "${value}"`);
}

// The first line of every route printout: which provider this run talks to.
export function providerLine(route: Route | string | undefined): string {
  return route === "nvidia-direct"
    ? "provider: nvidia-direct (Nightshift is NOT used in this run)"
    : route === "nightshift"
      ? "provider: nightshift (Meterless Runtime, the default)"
      : `provider: ${route ?? "none"}`;
}

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
  const order = rt.orderSource === "env" ? "pinned by METERLESS_MODE_ORDER" : rt.orderSource === "nvidia-direct" ? "the nvidia-direct order" : "default order";
  return [providerLine(rt.route), ...(Object.keys(AGENTS) as (keyof ModelIds)[]).flatMap((role) =>
    AGENTS[role].map((agent) => {
      const stuck = rt.client.sticky.get(agent);
      if (stuck) return `${agent}: ${stuck} (after a fallback)`;
      if (rt.modeOrder?.length) return `${agent}: ${rt.modeOrder.join(" > ")} (${order})`;
      return `${agent}: ${rt.models[role]}`;
    }),
  )];
}

export const samplesDir = (root: string) => join(root, "cache/samples");

// meterless/deep for Keeper, Judge and Skeptic when the runtime lists it; meterless/auto otherwise.
export function chooseModels(available: string[]): ModelIds {
  const strong = available.includes(MODELS.deep) ? MODELS.deep : MODELS.auto;
  return { researcher: MODELS.auto, router: MODELS.auto, explainer: MODELS.auto, keeper: strong, judge: strong, skeptic: strong };
}

// Thinking off (NVIDIA_DISABLE_THINKING=1 on the direct route) changes the replies but not the prompts, so such a run
// never shares a cache with thinking on: its keys carry the namespace "thinking-off" and it reads and writes its own
// folder (default cache-thinking-off/), never cache/. cacheDir / cacheNamespace / deadModesFile override the defaults
// (the dry-run probe and tests use them); deadModesFile keeps a run with --out from writing state/.
export const THINKING_OFF = "thinking-off";
export const THINKING_OFF_CACHE = "cache-thinking-off";
export function thinkingOff(env = process.env): boolean {
  return routeFromEnv(env.AI_PROVIDER) === "nvidia-direct" && env.NVIDIA_DISABLE_THINKING === "1";
}
// jsonObject: the direct route sends response_format {"type":"json_object"} (extraction run 3).
export type RuntimeOpts = { maxCalls: number; sampleMode: boolean; teeSamples?: boolean; provider?: ChatProvider; cacheDir?: string; cacheNamespace?: string; deadModesFile?: string; jsonObject?: boolean };

export async function makeRuntime(root: string, opts: RuntimeOpts): Promise<Runtime> {
  const events: CallEvent[] = [];
  if (opts.sampleMode) {
    const f = join(samplesDir(root), "models.json");
    const models = existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as ModelIds) : chooseModels([]);
    const client = new ModelClient(null, new FileCache(samplesDir(root), { readOnly: true }), new CallBudget(0), (e) => events.push(e));
    return { client, models, events, sampleMode: true };
  }
  let provider = opts.provider;
  if (!provider) {
    if (routeFromEnv() === "nvidia-direct") {
      const apiKey = process.env.NVIDIA_API_KEY ?? "";
      if (!apiKey) throw new Error("AI_PROVIDER=nvidia-direct needs NVIDIA_API_KEY in .env");
      provider = new NvidiaDirect({ apiKey, disableThinking: process.env.NVIDIA_DISABLE_THINKING === "1", jsonObject: opts.jsonObject });
    } else {
      const token = process.env.METERLESS_RUNTIME_TOKEN ?? "";
      if (!token) throw new Error("METERLESS_RUNTIME_TOKEN is not set: create .env from .env.example, then run with node --env-file=.env");
      provider = new MeterlessRuntime({ token, baseUrl: process.env.METERLESS_BASE_URL, appId: process.env.METERLESS_APP_ID });
    }
  }
  const direct = provider.id === NVIDIA_DIRECT_ID;
  const route = direct ? "nvidia-direct" : provider.id === "meterless" ? "nightshift" : provider.id;
  // Nightshift: METERLESS_MODE_ORDER wins when set (validated before any request), else the default pinned
  // order. The direct route has its own fixed order (lightning only); METERLESS_MODE_ORDER does not apply.
  const fromEnv = direct ? undefined : parseModeOrder(process.env.METERLESS_MODE_ORDER);
  const modeOrder = direct ? NVIDIA_DIRECT_ORDER : (fromEnv ?? DEFAULT_MODE_ORDER);
  const orderSource = direct ? "nvidia-direct" : fromEnv ? "env" : "default";
  const off = direct && process.env.NVIDIA_DISABLE_THINKING === "1";
  const namespace = opts.cacheNamespace ?? (off ? THINKING_OFF : undefined);
  const cacheDir = resolve(root, opts.cacheDir ?? (namespace === THINKING_OFF ? THINKING_OFF_CACHE : "cache"));
  if (namespace && cacheDir === resolve(root, "cache")) throw new Error(`a "${namespace}" run must not use cache/: pass its own --cache-dir`);
  const available = await provider.listModels();
  const models = chooseModels(available);
  const cache = new FileCache(cacheDir, { tee: opts.teeSamples ? samplesDir(root) : undefined });
  if (opts.teeSamples) {
    mkdirSync(samplesDir(root), { recursive: true });
    writeFileSync(join(samplesDir(root), "models.json"), JSON.stringify(models, null, 2) + "\n");
  }
  // The cache key is the prompt plus the mode the agent asked for (meterless/auto, meterless/deep), not the
  // route or the model that answered, so replies cached through Nightshift still hit on the direct route.
  const client = new ModelClient(provider, cache, new CallBudget(opts.maxCalls), (e) => events.push(e), {
    cacheNamespace: namespace,
    availableModels: available,
    modeOrder,
    // Each route remembers its own dead models: lightning being dead through Nightshift says nothing about
    // lightning called directly.
    deadModes: new FileDeadModes(opts.deadModesFile ?? join(root, direct ? "state/dead-modes-nvidia-direct.json" : "state/dead-modes.json")),
    route,
  });
  return { client, models, events, sampleMode: false, modeOrder, orderSource, route, cacheDir, cacheNamespace: namespace };
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
          : `${e.outcome};cache=${e.cache};route=${e.route ?? "none"};requested=${e.requested ?? "none"};model=${e.model_answered || "none"}`,
      retry_count: e.retry_count,
      latency_ms: e.latency_ms,
    });
  }
  return relative(root, trace.path);
}
