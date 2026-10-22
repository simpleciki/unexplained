import {
  ProviderError,
  type ChatProvider,
  type ChatRequest,
  type ChatResult,
  type ProviderStatus,
} from "./provider.ts";

export const METERLESS_PROVIDER_ID = "meterless";
export const METERLESS_PROVIDER_NAME = "Meterless Runtime";
export const DEFAULT_METERLESS_BASE_URL = "http://127.0.0.1:8088/v1";
export const PLACEHOLDER_RUNTIME_TOKEN = "rt-local";
export const DEFAULT_APP_ID = "unexplained";

const CHAT_TIMEOUT_MS = 180_000;
const RETRY_DELAY_MS = 2_000;
const MAX_REQUESTS_PER_MINUTE = 30;
const MINUTE_MS = 60_000;

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

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? String(error.name) : "";
  return name === "AbortError" || name === "TimeoutError";
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class SlidingWindowLimiter {
  private stamps: number[] = [];

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number,
    private readonly sleep: (ms: number) => Promise<void>,
  ) {}

  async acquire(): Promise<void> {
    for (;;) {
      const now = this.now();
      this.stamps = this.stamps.filter((t) => now - t < this.windowMs);
      if (this.stamps.length < this.max) {
        this.stamps.push(now);
        return;
      }
      const oldest = this.stamps[0] ?? now;
      await this.sleep(Math.max(1, this.windowMs - (now - oldest)));
    }
  }
}

type ModelsResponse = {
  data?: Array<{ id?: string }>;
};

type ChatCompletionResponse = {
  model?: string;
  choices?: Array<{ message?: { content?: unknown } }>;
};

export class MeterlessRuntime implements ChatProvider {
  readonly id = METERLESS_PROVIDER_ID;
  readonly name = METERLESS_PROVIDER_NAME;
  readonly baseUrl: string;

  private readonly token: string;
  private readonly appId: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timeoutMs: number;
  private readonly limiter: SlidingWindowLimiter;

  constructor(options: MeterlessOptions) {
    this.token = options.token;
    this.appId = options.appId ?? DEFAULT_APP_ID;
    this.baseUrl = normaliseBaseUrl(options.baseUrl);
    this.fetchImpl = options.fetch ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.timeoutMs = options.requestTimeoutMs ?? CHAT_TIMEOUT_MS;
    this.limiter = new SlidingWindowLimiter(
      options.maxRequestsPerMinute ?? MAX_REQUESTS_PER_MINUTE,
      MINUTE_MS,
      options.now ?? Date.now,
      this.sleep,
    );
  }

  async status(): Promise<ProviderStatus> {
    if (this.token === PLACEHOLDER_RUNTIME_TOKEN) {
      return "unauthorized";
    }
    try {
      const response = await this.request(`${this.baseUrl}/models`, { method: "GET" });
      if (response.status === 401 || response.status === 403) {
        return "unauthorized";
      }
      if (response.status !== 200) {
        return "offline";
      }
      const ids = await this.parseModelIds(response);
      return ids.length > 0 ? "online" : "offline";
    } catch {
      return "offline";
    }
  }

  async listModels(): Promise<string[]> {
    this.assertLiveToken();
    const response = await this.request(`${this.baseUrl}/models`, { method: "GET" });
    this.throwIfFailed(response, await this.safeText(response));
    return this.parseModelIds(response);
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    this.assertLiveToken();
    const messages: Array<{ role: string; content: string }> = [];
    if (req.system) {
      messages.push({ role: "system", content: req.system });
    }
    messages.push({ role: "user", content: req.user });
    const body: Record<string, unknown> = { model: req.model, messages };
    if (req.temperature !== undefined) {
      body.temperature = req.temperature;
    }

    const started = Date.now();
    const response = await this.request(
      `${this.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "meterless-scope": "user",
        },
        body: JSON.stringify(body),
      },
      { retryOnTimeoutOr5xx: true },
    );
    const payload = (await response.json()) as ChatCompletionResponse;
    const content = payload.choices?.[0]?.message?.content;
    const text = typeof content === "string" ? content : "";
    return {
      text,
      model: payload.model ?? req.model,
      latencyMs: Date.now() - started,
    };
  }

  private assertLiveToken(): void {
    if (this.token === PLACEHOLDER_RUNTIME_TOKEN) {
      throw new ProviderError(
        "unauthorized",
        "Placeholder runtime token is not allowed",
      );
    }
  }

  private async parseModelIds(response: Response): Promise<string[]> {
    let payload: ModelsResponse;
    try {
      payload = (await response.json()) as ModelsResponse;
    } catch {
      return [];
    }
    const items = Array.isArray(payload.data) ? payload.data : [];
    return items
      .map((item) => item.id)
      .filter((id): id is string => typeof id === "string" && id.startsWith("meterless/"));
  }

  private async request(
    url: string,
    init: RequestInit,
    options: { retryOnTimeoutOr5xx?: boolean } = {},
  ): Promise<Response> {
    const attempt = async (): Promise<Response> => {
      await this.limiter.acquire();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const headers = new Headers(init.headers);
        headers.set("Authorization", `Bearer ${this.token}`);
        headers.set("meterless-app", this.appId);
        return await this.fetchImpl(url, {
          ...init,
          headers,
          signal: controller.signal,
        });
      } catch (error) {
        if (isAbortError(error)) {
          throw new ProviderError("timeout", `Request timed out after ${this.timeoutMs}ms`);
        }
        if (error instanceof ProviderError) {
          throw error;
        }
        throw new ProviderError("offline", error instanceof Error ? error.message : "network error");
      } finally {
        clearTimeout(timer);
      }
    };

    try {
      const first = await attempt();
      if (!options.retryOnTimeoutOr5xx) {
        return first;
      }
      this.throwIfFailed(first, await this.safeText(first));
      return first;
    } catch (error) {
      if (!options.retryOnTimeoutOr5xx || !this.isRetryable(error)) {
        throw error;
      }
      await this.sleep(RETRY_DELAY_MS);
      const second = await attempt();
      this.throwIfFailed(second, await this.safeText(second));
      return second;
    }
  }

  private isRetryable(error: unknown): boolean {
    if (!(error instanceof ProviderError)) return false;
    return error.kind === "timeout" || (error.kind === "http" && (error.status ?? 0) >= 500);
  }

  private throwIfFailed(response: Response, bodyText: string): void {
    if (response.ok) return;
    if (response.status === 401 || response.status === 403) {
      throw new ProviderError("unauthorized", bodyText || `HTTP ${response.status}`, response.status);
    }
    throw new ProviderError("http", bodyText || `HTTP ${response.status}`, response.status);
  }

  private async safeText(response: Response): Promise<string> {
    try {
      return await response.clone().text();
    } catch {
      return "";
    }
  }
}
