import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderError } from "./provider.ts";
import {
  DEFAULT_METERLESS_BASE_URL,
  MeterlessRuntime,
  normaliseBaseUrl,
} from "./meterless.ts";

type FetchInput = Parameters<typeof fetch>[0];

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function modelsBody(...ids: string[]) {
  return { data: ids.map((id) => ({ id })) };
}

function chatBody(text: string, model = "meterless/auto") {
  return {
    model,
    choices: [{ message: { role: "assistant", content: text } }],
  };
}

describe("normaliseBaseUrl", () => {
  const cases: Array<[string, string]> = [
    ["http://127.0.0.1:8088/v1", "http://127.0.0.1:8088/v1"],
    ["http://127.0.0.1:8088/v1/", "http://127.0.0.1:8088/v1"],
    ["http://127.0.0.1:8088/v1/chat/completions", "http://127.0.0.1:8088/v1"],
    ["http://127.0.0.1:8088/v1/models", "http://127.0.0.1:8088/v1"],
    ["http://127.0.0.1:8088/healthz", "http://127.0.0.1:8088/v1"],
    ["127.0.0.1:8088", "http://127.0.0.1:8088/v1"],
    ["http://127.0.0.1:8088", "http://127.0.0.1:8088/v1"],
    ["http://127.0.0.1:8088/v1/v1", "http://127.0.0.1:8088/v1"],
    ["https://runtime.example.test:9443/v1/models", "https://runtime.example.test:9443/v1"],
    ["127.0.0.1:8088/v1/chat/completions", "http://127.0.0.1:8088/v1"],
  ];

  it.each(cases)("normalises %s", (input, expected) => {
    expect(normaliseBaseUrl(input)).toBe(expected);
  });

  it("uses the default when input is empty", () => {
    expect(normaliseBaseUrl()).toBe(DEFAULT_METERLESS_BASE_URL);
    expect(normaliseBaseUrl("")).toBe(DEFAULT_METERLESS_BASE_URL);
  });
});

describe("MeterlessRuntime", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const token = "rt-test-not-placeholder";

  function provider(fetchImpl: typeof fetch, extras: Partial<ConstructorParameters<typeof MeterlessRuntime>[0]> = {}) {
    return new MeterlessRuntime({
      token,
      fetch: fetchImpl,
      sleep: async () => undefined,
      ...extras,
    });
  }

  it("exposes provider id and name", () => {
    const p = provider(vi.fn());
    expect(p.id).toBe("meterless");
    expect(p.name).toBe("Meterless Runtime");
  });

  it("maps GET /v1/models 200 with meterless ids to online", async () => {
    const fetchImpl = vi.fn(async (input: FetchInput) => {
      expect(String(input)).toBe("http://127.0.0.1:8088/v1/models");
      return jsonResponse(200, modelsBody("meterless/auto", "other/model"));
    }) as unknown as typeof fetch;
    expect(await provider(fetchImpl).status()).toBe("online");
  });

  it("maps GET /v1/models 200 without meterless ids to offline", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, modelsBody("gpt-4"))) as unknown as typeof fetch;
    expect(await provider(fetchImpl).status()).toBe("offline");
  });

  it("maps GET /v1/models 401 to unauthorized", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(401, { error: "nope" })) as unknown as typeof fetch;
    expect(await provider(fetchImpl).status()).toBe("unauthorized");
  });

  it("maps GET /v1/models 403 to unauthorized", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(403, { error: "nope" })) as unknown as typeof fetch;
    expect(await provider(fetchImpl).status()).toBe("unauthorized");
  });

  it("maps GET /v1/models 500 to offline", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(500, { error: "boom" })) as unknown as typeof fetch;
    expect(await provider(fetchImpl).status()).toBe("offline");
  });

  it("maps network errors on GET /v1/models to offline", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(await provider(fetchImpl).status()).toBe("offline");
  });

  it("never calls /healthz when deciding status", async () => {
    const fetchImpl = vi.fn(async (input: FetchInput) => {
      expect(String(input)).not.toContain("healthz");
      return jsonResponse(200, modelsBody("meterless/auto"));
    }) as unknown as typeof fetch;
    await provider(fetchImpl).status();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("sends Authorization and meterless-app on every request", async () => {
    const fetchImpl = vi.fn(async (_input: FetchInput, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBe(`Bearer ${token}`);
      expect(headers.get("meterless-app")).toBe("unexplained");
      expect(headers.get("meterless-scope")).toBeNull();
      return jsonResponse(200, modelsBody("meterless/auto"));
    }) as unknown as typeof fetch;
    await provider(fetchImpl).listModels();
  });

  it("sends meterless-scope user on chat requests", async () => {
    const fetchImpl = vi.fn(async (_input: FetchInput, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("meterless-scope")).toBe("user");
      return jsonResponse(200, chatBody("runtime ok"));
    }) as unknown as typeof fetch;
    await provider(fetchImpl).chat({ model: "meterless/auto", user: "hi" });
  });

  it("keeps recognised and unrecognised meterless/* model ids", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        200,
        modelsBody(
          "meterless/auto",
          "meterless/fast",
          "meterless/reason.deep",
          "openai/ignored",
        ),
      ),
    ) as unknown as typeof fetch;
    await expect(provider(fetchImpl).listModels()).resolves.toEqual([
      "meterless/auto",
      "meterless/fast",
      "meterless/reason.deep",
    ]);
  });

  it("rejects the rt-local placeholder before sending", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const p = new MeterlessRuntime({
      token: "rt-local",
      fetch: fetchImpl,
      sleep: async () => undefined,
    });
    expect(await p.status()).toBe("unauthorized");
    await expect(p.listModels()).rejects.toMatchObject({
      name: "ProviderError",
      kind: "unauthorized",
    });
    await expect(p.chat({ model: "meterless/auto", user: "hi" })).rejects.toBeInstanceOf(
      ProviderError,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("retries chat once after 5xx then succeeds", async () => {
    const sleep = vi.fn(async () => undefined);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(503, { error: "loading" }))
      .mockResolvedValueOnce(jsonResponse(200, chatBody("ok"))) as unknown as typeof fetch;
    const result = await provider(fetchImpl, { sleep }).chat({
      model: "meterless/auto",
      user: "hi",
    });
    expect(result.text).toBe("ok");
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("throws ProviderError http after a 5xx retry is exhausted", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(500, { error: "down" })) as unknown as typeof fetch;
    await expect(
      provider(fetchImpl).chat({ model: "meterless/auto", user: "hi" }),
    ).rejects.toMatchObject({ kind: "http", status: 500 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries chat once after timeout then succeeds", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(abort)
      .mockResolvedValueOnce(jsonResponse(200, chatBody("ok"))) as unknown as typeof fetch;
    const result = await provider(fetchImpl).chat({ model: "meterless/auto", user: "hi" });
    expect(result.text).toBe("ok");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("throws ProviderError timeout after a timeout retry is exhausted", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    const fetchImpl = vi.fn().mockRejectedValue(abort) as unknown as typeof fetch;
    await expect(
      provider(fetchImpl).chat({ model: "meterless/auto", user: "hi" }),
    ).rejects.toMatchObject({ kind: "timeout" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry unauthorized chat responses", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(401, { error: "bad" })) as unknown as typeof fetch;
    await expect(
      provider(fetchImpl).chat({ model: "meterless/auto", user: "hi" }),
    ).rejects.toMatchObject({ kind: "unauthorized", status: 401 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("maps chat network errors to offline without retry", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(
      provider(fetchImpl).chat({ model: "meterless/auto", user: "hi" }),
    ).rejects.toMatchObject({ kind: "offline" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("sends OpenAI-style chat completions with string content", async () => {
    const fetchImpl = vi.fn(async (input: FetchInput, init?: RequestInit) => {
      expect(String(input)).toBe("http://127.0.0.1:8088/v1/chat/completions");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual({
        model: "meterless/auto",
        messages: [
          { role: "system", content: "be brief" },
          { role: "user", content: "hello" },
        ],
        temperature: 0.2,
      });
      expect(typeof body.messages[1].content).toBe("string");
      return jsonResponse(200, chatBody("hello"));
    }) as unknown as typeof fetch;
    const result = await provider(fetchImpl).chat({
      model: "meterless/auto",
      system: "be brief",
      user: "hello",
      temperature: 0.2,
    });
    expect(result.model).toBe("meterless/auto");
    expect(result.text).toBe("hello");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
