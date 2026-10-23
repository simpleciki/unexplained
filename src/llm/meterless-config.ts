// Meterless Runtime constants and base-URL normalisation.

export const METERLESS_PROVIDER_ID = "meterless";
export const METERLESS_PROVIDER_NAME = "Meterless Runtime";
export const DEFAULT_METERLESS_BASE_URL = "http://127.0.0.1:8088/v1";
export const PLACEHOLDER_RUNTIME_TOKEN = "rt-local";
export const DEFAULT_APP_ID = "unexplained";

export const CHAT_TIMEOUT_MS = 180_000;
export const RETRY_DELAY_MS = 2_000;
export const MAX_REQUESTS_PER_MINUTE = 30;
export const MINUTE_MS = 60_000;

export type MeterlessOptions = {
  token: string;
  baseUrl?: string;
  appId?: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  requestTimeoutMs?: number;
  maxRequestsPerMinute?: number;
};

export function normaliseBaseUrl(input?: string): string {
  const raw = (input ?? "").trim();
  const source = raw.length > 0 ? raw : DEFAULT_METERLESS_BASE_URL;
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(source)
    ? source
    : `http://${source}`;
  const url = new URL(withScheme);
  const scheme = url.protocol.replace(/:$/, "");
  const port = url.port || (scheme === "https" ? "443" : "80");
  return `${scheme}://${url.hostname}:${port}/v1`;
}
