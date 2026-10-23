import {
  ProviderError,
  type ChatProvider,
  type ChatRequest,
  type ChatResult,
  type ProviderStatus,
} from "./provider.ts";

import {
  CHAT_TIMEOUT_MS,
  DEFAULT_APP_ID,
  MAX_REQUESTS_PER_MINUTE,
  METERLESS_PROVIDER_ID,
  METERLESS_PROVIDER_NAME,
  MINUTE_MS,
  PLACEHOLDER_RUNTIME_TOKEN,
  RETRY_DELAY_MS,
  normaliseBaseUrl,
  type MeterlessOptions,
} from "./meterless-config.ts";
import { SlidingWindowLimiter, defaultSleep, isAbortError } from "./limiter.ts";
import { redactAccount, routeError, isRetryable, parseModelIds, safeText, throwIfFailed, type ChatCompletionResponse } from "./http.ts";

export * from "./meterless-config.ts";

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
      const ids = await parseModelIds(response);
      return ids.length > 0 ? "online" : "offline";
    } catch {
      return "offline";
    }
  }

  async listModels(): Promise<string[]> {
    this.assertLiveToken();
    const response = await this.request(`${this.baseUrl}/models`, { method: "GET" });
    throwIfFailed(response, await safeText(response));
    return parseModelIds(response);
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
    const payload = (await response.json()) as ChatCompletionResponse & { error?: unknown };
    // Some routes answer 200 with an error body; a dead upstream model must still be recognised.
    if (payload.error) {
      const raw = JSON.stringify(payload);
      throw routeError(raw, response.status) ?? new ProviderError("http", redactAccount(raw), response.status);
    }
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
      throwIfFailed(first, await safeText(first));
      return first;
    } catch (error) {
      if (!options.retryOnTimeoutOr5xx || !isRetryable(error)) {
        throw error;
      }
      await this.sleep(RETRY_DELAY_MS);
      const second = await attempt();
      throwIfFailed(second, await safeText(second));
      return second;
    }
  }

}
