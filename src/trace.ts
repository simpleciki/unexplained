import { createHash } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

export type TraceEvent = {
  timestamp: string;
  run_id: string;
  phase: string;
  agent: string;
  action: string;
  input_ref: string;
  output_ref: string;
  outcome: string;
  retry_count: number;
  latency_ms: number;
};

export type TraceInput = Omit<TraceEvent, "timestamp" | "run_id"> & {
  timestamp?: string;
  run_id?: string;
};

export function hashPrompt(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function createTraceLogger(runId: string, logsDir = "logs") {
  const filePath = path.join(logsDir, `trace-${runId}.jsonl`);

  return {
    path: filePath,
    async append(event: TraceInput): Promise<void> {
      await mkdir(logsDir, { recursive: true });
      const record: TraceEvent = {
        timestamp: event.timestamp ?? new Date().toISOString(),
        run_id: event.run_id ?? runId,
        phase: event.phase,
        agent: event.agent,
        action: event.action,
        input_ref: event.input_ref,
        output_ref: event.output_ref,
        outcome: event.outcome,
        retry_count: event.retry_count,
        latency_ms: event.latency_ms,
      };
      await appendFile(filePath, `${JSON.stringify(record)}\n`, "utf8");
    },
  };
}
