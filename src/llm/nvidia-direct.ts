// NVIDIA direct: an explicit fallback route straight to NVIDIA's OpenAI-compatible endpoint, used only when
// AI_PROVIDER=nvidia-direct. Nightshift (the Meterless Runtime) stays the primary, default provider; this
// exists because Nightshift 1.2.1 mapped lightning-30b and super-120b to an NVIDIA function this account
// cannot use (404 "Not found for account") while the same model answers when called directly.
// The key comes from NVIDIA_API_KEY in the environment and is only ever put in the Authorization header:
// never logged, never in an error message.
// Reasoning models put their thinking in message.reasoning_content and the answer in message.content. Only
// content is the answer; an empty or missing content is returned as "" (no valid reply), so the normal
// retry / prose path handles it.
import { ProviderError, type ChatProvider, type ChatRequest, type ChatResult, type ProviderStatus } from "./provider.ts";
import { CHAT_TIMEOUT_MS, MAX_REQUESTS_PER_MINUTE, MINUTE_MS, RETRY_DELAY_MS } from "./meterless-config.ts";
import { SlidingWindowLimiter, defaultSleep, isAbortError } from "./limiter.ts";
import { isRetryable, redactAccount, safeText } from "./http.ts";
import { EXCLUDED_MODELS } from "./modes.ts";

export const NVIDIA_DIRECT_ID = "nvidia-direct";
export const NVIDIA_DIRECT_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
// The only model this account can use directly (checked by Ciki on 2026-10-23: super-120b and
// llama-3.1-nemotron-70b return 404 for the account; ultra-550b stays excluded, it answers in prose).
export const NVIDIA_DIRECT_ORDER = ["nvidia/nemotron-3.5-lightning-30b-a3b"];
// Room for the thinking and the answer, so content is not empty because reasoning used the budget.
export const NVIDIA_MAX_TOKENS = 4096;

export type NvidiaDirectOptions = {
  apiKey: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  requestTimeoutMs?: number;
  maxRequestsPerMinute?: number;
  disableThinking?: boolean; // NVIDIA_DISABLE_THINKING=1: chat_template_kwargs.enable_thinking = false
  jsonObject?: boolean; // response_format {"type":"json_object"} on every request (extraction run 3)
};

// NVIDIA refused a request that carries response_format. Not a ProviderError: nothing retries, falls back or skips
// the record on it, so the run stops instead of quietly running without the field (docs/extraction-run-3.md).
export class ResponseFormatRejected extends Error {
  constructor(readonly status: number, detail: string) {
    super(`NVIDIA rejected the request with response_format {"type":"json_object"} (HTTP ${status}): ${detail}; the run stops (the field is not dropped)`);
    this.name = "ResponseFormatRejected";
  }
}

// NVIDIA's own error bodies are not the runtime's provider_error shape: classify by status and text.
function directError(status: number, body: string): ProviderError {
  const text = redactAccount(body) || `HTTP ${status}`;
  if (status === 401 || status === 403) return new ProviderError("unauthorized", text, status);
  if (/not found for account|not entitled/i.test(body)) return new ProviderError("route_unavailable", text, status);
  if (status === 404 || status === 410) return new ProviderError("route_dead", text, status);
  return new ProviderError("http", text, status);
}

export class NvidiaDirect implements ChatProvider {
  readonly id = NVIDIA_DIRECT_ID;
  private readonly key: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timeoutMs: number;
  private readonly limiter: SlidingWindowLimiter;
  private readonly disableThinking: boolean;
  private readonly jsonObject: boolean;

  constructor(o: NvidiaDirectOptions) {
    this.key = o.apiKey;
    this.fetchImpl = o.fetch ?? fetch;
    this.sleep = o.sleep ?? defaultSleep;
    this.timeoutMs = o.requestTimeoutMs ?? CHAT_TIMEOUT_MS;
    this.limiter = new SlidingWindowLimiter(o.maxRequestsPerMinute ?? MAX_REQUESTS_PER_MINUTE, MINUTE_MS, o.now ?? Date.now, this.sleep);
    this.disableThinking = o.disableThinking ?? false;
    this.jsonObject = o.jsonObject ?? false;
  }

  async status(): Promise<ProviderStatus> {
    return this.key ? "online" : "unauthorized";
  }

  // No listing call: the route offers exactly the models in its order.
  async listModels(): Promise<string[]> {
    return [...NVIDIA_DIRECT_ORDER];
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    if (!this.key) throw new ProviderError("unauthorized", "NVIDIA_API_KEY is not set");
    if (EXCLUDED_MODELS.includes(req.model)) throw new ProviderError("route_unavailable", `${req.model} is excluded`);
    if (!req.model.startsWith("nvidia/")) throw new ProviderError("route_unavailable", `${req.model} is not an NVIDIA model id; the direct route takes nvidia/<model> only`);
    const messages: { role: string; content: string }[] = [];
    if (req.system) messages.push({ role: "system", content: req.system });
    messages.push({ role: "user", content: req.user });
    const body: Record<string, unknown> = { model: req.model, messages, max_tokens: NVIDIA_MAX_TOKENS };
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (this.disableThinking) body.chat_template_kwargs = { enable_thinking: false };
    if (this.jsonObject) body.response_format = { type: "json_object" };
    const started = Date.now();
    const response = await this.post(JSON.stringify(body));
    const payload = (await response.json()) as { model?: string; choices?: { message?: { content?: unknown; reasoning_content?: unknown } }[] };
    // The answer is content only; reasoning_content is never read as the answer.
    const content = payload.choices?.[0]?.message?.content;
    return { text: typeof content === "string" ? content : "", model: payload.model ?? req.model, latencyMs: Date.now() - started };
  }

  // One request, retried once after a timeout or a 5xx (as the Meterless client does).
  private async post(body: string): Promise<Response> {
    const attempt = async () => {
      await this.limiter.acquire();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const r = await this.fetchImpl(NVIDIA_DIRECT_URL, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json", Authorization: `Bearer ${this.key}` },
          body,
          signal: controller.signal,
        });
        if (!r.ok) {
          const text = await safeText(r);
          // A 400 or 422 while response_format is set is read as the field being rejected.
          if (this.jsonObject && (r.status === 400 || r.status === 422)) throw new ResponseFormatRejected(r.status, redactAccount(text).slice(0, 300) || `HTTP ${r.status}`);
          throw directError(r.status, text);
        }
        return r;
      } catch (e) {
        if (e instanceof ProviderError || e instanceof ResponseFormatRejected) throw e;
        if (isAbortError(e)) throw new ProviderError("timeout", `Request timed out after ${this.timeoutMs}ms`);
        throw new ProviderError("offline", "network error"); // the message of a fetch error is not echoed
      } finally {
        clearTimeout(timer);
      }
    };
    try {
      return await attempt();
    } catch (e) {
      if (!isRetryable(e)) throw e;
      await this.sleep(RETRY_DELAY_MS);
      return attempt();
    }
  }
}
