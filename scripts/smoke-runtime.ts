import { randomUUID } from "node:crypto";
import { MeterlessRuntime, normaliseBaseUrl } from "../src/llm/meterless.ts";
import { createTraceLogger, hashPrompt } from "../src/trace.ts";

const token = process.env.METERLESS_RUNTIME_TOKEN ?? "";
const configuredBase = process.env.METERLESS_BASE_URL;
const appId = process.env.METERLESS_APP_ID;
const baseUrl = normaliseBaseUrl(configuredBase);

console.log(baseUrl);

const runId = randomUUID();
const trace = createTraceLogger(runId);
const provider = new MeterlessRuntime({
  token,
  baseUrl: configuredBase,
  appId,
});

let reply = "";

const statusStarted = Date.now();
const status = await provider.status();
await trace.append({
  phase: "smoke",
  agent: "runtime",
  action: "status",
  input_ref: hashPrompt("status"),
  output_ref: hashPrompt(status),
  outcome: status,
  retry_count: 0,
  latency_ms: Date.now() - statusStarted,
});
console.log(status);

if (status === "online") {
  const modelsStarted = Date.now();
  const models = await provider.listModels();
  await trace.append({
    phase: "smoke",
    agent: "runtime",
    action: "listModels",
    input_ref: hashPrompt("listModels"),
    output_ref: hashPrompt(models.join("\n")),
    outcome: "ok",
    retry_count: 0,
    latency_ms: Date.now() - modelsStarted,
  });
  for (const id of models) {
    console.log(id);
  }

  const user = "Reply with exactly: runtime ok";
  const chatStarted = Date.now();
  try {
    const result = await provider.chat({ model: "meterless/auto", user });
    reply = result.text;
    await trace.append({
      phase: "smoke",
      agent: "runtime",
      action: "chat",
      input_ref: hashPrompt(user),
      output_ref: hashPrompt(result.text),
      outcome: result.text.trim().length > 0 ? "ok" : "empty",
      retry_count: 0,
      latency_ms: result.latencyMs,
    });
    console.log(result.text);
    console.log(result.latencyMs);
  } catch (error) {
    const message = error instanceof Error ? error.message : "chat failed";
    await trace.append({
      phase: "smoke",
      agent: "runtime",
      action: "chat",
      input_ref: hashPrompt(user),
      output_ref: hashPrompt(message),
      outcome: "error",
      retry_count: 0,
      latency_ms: Date.now() - chatStarted,
    });
  }
}

console.log(trace.path);
process.exit(reply.trim().length > 0 ? 0 : 1);
