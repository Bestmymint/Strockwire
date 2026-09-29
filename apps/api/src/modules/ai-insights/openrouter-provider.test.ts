import { afterEach, describe, expect, it, vi } from "vitest";

import { createOpenRouterProvider } from "./openrouter-provider.ts";

const key = "test-key-placeholder";
const input = { text: "Approved aggregate summary only" };

function success(model = "example/routed-free-model", text = "Summary") {
  return new Response(
    JSON.stringify({
      object: "chat.completion",
      model,
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: { role: "assistant", content: text },
        },
      ],
      usage: {
        prompt_tokens: 12,
        completion_tokens: 3,
        total_tokens: 15,
        cost: 0.000012,
      },
    }),
    { status: 200 },
  );
}

function client(responses: Array<Response | Error>) {
  const fetchImplementation = vi.fn<typeof fetch>(async () => {
    const next = responses.shift();
    if (next instanceof Error) throw next;
    if (next === undefined) throw new Error("Unexpected provider call");
    return next;
  });
  return {
    fetchImplementation,
    provider: createOpenRouterProvider({ apiKey: key, fetchImplementation }),
  };
}

function requestedModels(
  fetchImplementation: ReturnType<typeof vi.fn<typeof fetch>>,
) {
  return fetchImplementation.mock.calls.map(
    ([, options]) => JSON.parse(String(options?.body)).model,
  );
}

afterEach(() => vi.restoreAllMocks());

describe("OpenRouter AI provider", () => {
  it("reserves before each HTTP call and stops when attempt persistence fails", async () => {
    const { fetchImplementation, provider } = client([
      new Response("", { status: 503 }),
      success(),
    ]);
    const events: string[] = [];
    await expect(
      provider.generate(input, {
        beforeAttempt: async ({ attemptNumber }) => {
          events.push(`before-${attemptNumber}`);
        },
        afterAttempt: async ({ attemptNumber }) => {
          events.push(`after-${attemptNumber}`);
          throw new Error("persistence unavailable");
        },
      }),
    ).rejects.toThrow("persistence unavailable");
    expect(events).toEqual(["before-1", "after-1"]);
    expect(fetchImplementation).toHaveBeenCalledOnce();

    await expect(
      provider.generate(input, {
        beforeAttempt: async () => {
          throw new Error("reservation unavailable");
        },
        afterAttempt: async () => undefined,
      }),
    ).rejects.toThrow("reservation unavailable");
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it("requests the free router and retains the routed model and reported usage", async () => {
    const { fetchImplementation, provider } = client([
      success("example/routed-model:free"),
    ]);
    const result = await provider.generate(input);
    expect(result).toMatchObject({
      ok: true,
      text: "Summary",
      requestedModel: "openrouter/free",
      actualModel: "example/routed-model:free",
      usage: {
        promptTokens: 12,
        completionTokens: 3,
        totalTokens: 15,
        cost: "0.000012",
      },
      attempts: [{ attemptNumber: 1, provider: "openrouter", httpStatus: 200 }],
    });
    expect(fetchImplementation).toHaveBeenCalledOnce();
    const [url, options] = fetchImplementation.mock.calls[0]!;
    const body = JSON.parse(String(options?.body));
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(options).toMatchObject({
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
    });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(body).toEqual({
      model: "openrouter/free",
      messages: [{ role: "user", content: input.text }],
      max_tokens: 512,
      usage: { include: true },
    });
    expect(body).not.toHaveProperty("models");
  });

  it("classifies a per-call timeout and retries primary once", async () => {
    vi.spyOn(AbortSignal, "timeout")
      .mockImplementationOnce(() =>
        AbortSignal.abort(new DOMException("secret", "TimeoutError")),
      )
      .mockImplementationOnce(() => new AbortController().signal);
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async (_url, options) => {
        expect(options?.signal?.aborted).toBe(true);
        throw new Error("raw timeout secret");
      })
      .mockImplementationOnce(async (_url, options) => {
        expect(options?.signal?.aborted).toBe(false);
        return success();
      });
    const result = await createOpenRouterProvider({
      apiKey: key,
      fetchImplementation,
    }).generate(input);
    expect(result.ok).toBe(true);
    expect(result.attempts[0]).toMatchObject({ failureCategory: "TIMEOUT" });
    expect(AbortSignal.timeout).toHaveBeenCalledTimes(2);
    expect(AbortSignal.timeout).toHaveBeenNthCalledWith(1, 15_000);
    expect(AbortSignal.timeout).toHaveBeenNthCalledWith(2, 15_000);
    expect(requestedModels(fetchImplementation)).toEqual([
      "openrouter/free",
      "openrouter/free",
    ]);
  });

  it("classifies transport failure and retries primary", async () => {
    const { fetchImplementation, provider } = client([
      new Error("raw network secret"),
      success(),
    ]);
    const result = await provider.generate(input);
    expect(result.ok).toBe(true);
    expect(result.attempts[0]?.failureCategory).toBe("TRANSPORT");
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it.each([
    [429, "RATE_LIMITED"],
    [500, "PROVIDER_ERROR"],
    [503, "PROVIDER_UNAVAILABLE"],
  ] as const)("retries transient HTTP %i as %s", async (status, category) => {
    const { fetchImplementation, provider } = client([
      new Response("raw provider secret", { status }),
      success(),
    ]);
    const result = await provider.generate(input);
    expect(result.ok).toBe(true);
    expect(result.attempts[0]).toMatchObject({
      failureCategory: category,
      httpStatus: status,
    });
    expect(requestedModels(fetchImplementation)).toEqual([
      "openrouter/free",
      "openrouter/free",
    ]);
  });

  it("retries the free router three times after transient failures", async () => {
    const { fetchImplementation, provider } = client([
      new Response("", { status: 429 }),
      new Response("", { status: 502 }),
      success("example/another-free-model:free"),
    ]);
    const result = await provider.generate(input);
    expect(result).toMatchObject({
      ok: true,
      requestedModel: "openrouter/free",
      actualModel: "example/another-free-model:free",
    });
    expect(requestedModels(fetchImplementation)).toEqual([
      "openrouter/free",
      "openrouter/free",
      "openrouter/free",
    ]);
    expect(result.attempts.map((attempt) => attempt.attemptNumber)).toEqual([
      1, 2, 3,
    ]);
  });

  it("stops after three failed actual calls", async () => {
    const { fetchImplementation, provider } = client([
      new Response("", { status: 500 }),
      new Response("", { status: 500 }),
      new Response("", { status: 429 }),
    ]);
    const result = await provider.generate(input);
    expect(result).toMatchObject({
      ok: false,
      failureCategory: "RATE_LIMITED",
    });
    expect(result.attempts).toHaveLength(3);
    expect(fetchImplementation).toHaveBeenCalledTimes(3);
  });

  it.each([
    [400, "INVALID_REQUEST"],
    [401, "AUTHENTICATION"],
    [403, "AUTHENTICATION"],
    [402, "PROVIDER_ERROR"],
    [404, "PROVIDER_ERROR"],
    [409, "INVALID_REQUEST"],
    [422, "INVALID_REQUEST"],
  ] as const)(
    "stops without retry or fallback for HTTP %i",
    async (status, category) => {
      const { fetchImplementation, provider } = client([
        new Response("raw provider secret", { status }),
      ]);
      const result = await provider.generate(input);
      expect(result).toMatchObject({ ok: false, failureCategory: category });
      expect(fetchImplementation).toHaveBeenCalledOnce();
      expect(JSON.stringify(result)).not.toContain("raw provider secret");
    },
  );

  it("rejects oversized UTF-8 request before network I/O", async () => {
    const { fetchImplementation, provider } = client([]);
    const result = await provider.generate({ text: "é".repeat(8192) });
    expect(result).toEqual({
      ok: false,
      failureCategory: "INVALID_REQUEST",
      attempts: [],
    });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("accepts a 16 KiB serialized request and rejects one byte more", async () => {
    const emptyBody = JSON.stringify({
      model: "openrouter/free",
      messages: [{ role: "user", content: "" }],
      max_tokens: 512,
      usage: { include: true },
    });
    const text = "x".repeat(16 * 1024 - Buffer.byteLength(emptyBody));
    expect(Buffer.byteLength(emptyBody) + text.length).toBe(16 * 1024);
    const accepted = client([success()]);
    expect((await accepted.provider.generate({ text })).ok).toBe(true);
    expect(accepted.fetchImplementation).toHaveBeenCalledOnce();

    const rejected = client([]);
    expect(await rejected.provider.generate({ text: `${text}x` })).toEqual({
      ok: false,
      failureCategory: "INVALID_REQUEST",
      attempts: [],
    });
    expect(rejected.fetchImplementation).not.toHaveBeenCalled();
  });

  it.each([
    [[408, 400], "INVALID_REQUEST", 2],
    [[500, 401], "AUTHENTICATION", 2],
    [[429, "malformed"], "INVALID_RESPONSE", 2],
    [[500, 500, "malformed"], "INVALID_RESPONSE", 3],
  ] as const)(
    "stops mixed failures after the first non-retryable result",
    async (sequence, category, count) => {
      const responses = sequence.map((status) =>
        status === "malformed"
          ? new Response(JSON.stringify({ choices: [] }))
          : new Response("raw provider detail", { status }),
      );
      const { fetchImplementation, provider } = client(responses);
      const result = await provider.generate(input);
      expect(result).toMatchObject({ ok: false, failureCategory: category });
      expect(fetchImplementation).toHaveBeenCalledTimes(count);
      expect(requestedModels(fetchImplementation)).toEqual(
        count === 3
          ? ["openrouter/free", "openrouter/free", "openrouter/free"]
          : ["openrouter/free", "openrouter/free"],
      );
    },
  );

  it("accepts exactly 4 KiB of text and rejects one additional byte", async () => {
    const accepted = await client([
      success("openrouter/free", "\0".repeat(4096)),
    ]).provider.generate(input);
    expect(accepted.ok).toBe(true);
    if (accepted.ok)
      expect(Buffer.byteLength(accepted.text, "utf8")).toBe(4096);

    const rejected = await client([
      success("openrouter/free", "x".repeat(4097)),
    ]).provider.generate(input);
    expect(rejected).toMatchObject({
      ok: false,
      failureCategory: "INVALID_RESPONSE",
    });
  });

  it.each([
    success("openrouter/free", "é".repeat(2049)),
    new Response(JSON.stringify({ choices: [] }), { status: 200 }),
    new Response("not JSON", { status: 200 }),
    success("openrouter/free", ""),
    new Response(
      JSON.stringify({
        object: "chat.completion",
        model: "openrouter/free",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content: ["bad"] },
          },
        ],
      }),
      { status: 200 },
    ),
  ])(
    "rejects oversized, malformed, or empty provider text without retry",
    async (response) => {
      const { fetchImplementation, provider } = client([response]);
      const result = await provider.generate(input);
      expect(result).toMatchObject({
        ok: false,
        failureCategory: "INVALID_RESPONSE",
      });
      expect(fetchImplementation).toHaveBeenCalledOnce();
    },
  );

  it("rejects a malformed usage field and a bounded raw body", async () => {
    const raw = JSON.parse(await success().text());
    raw.usage.cost = "unknown";
    for (const response of [
      new Response(JSON.stringify(raw)),
      new Response("x".repeat(32 * 1024 + 1)),
    ]) {
      const { provider } = client([response]);
      expect(await provider.generate(input)).toMatchObject({
        ok: false,
        failureCategory: "INVALID_RESPONSE",
      });
    }
  });

  it("rejects a truncated completion but accepts a valid routed model", async () => {
    const truncated = JSON.parse(await success().text());
    truncated.choices[0].finish_reason = "length";
    const incomplete = await client([
      new Response(JSON.stringify(truncated)),
    ]).provider.generate(input);
    expect(incomplete).toMatchObject({
      ok: false,
      failureCategory: "INVALID_RESPONSE",
    });

    const routed = await client([
      success("example/dated-free-model-2024-07-18:free"),
    ]).provider.generate(input);
    expect(routed).toMatchObject({
      ok: true,
      requestedModel: "openrouter/free",
      actualModel: "example/dated-free-model-2024-07-18:free",
    });
  });

  it("allows absent usage but never invents a cost", async () => {
    const raw = JSON.parse(await success().text());
    delete raw.usage;
    const { provider } = client([new Response(JSON.stringify(raw))]);
    const result = await provider.generate(input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.usage).toBeUndefined();
  });

  it("omits null usage values and rejects a malformed returned model", async () => {
    const raw = JSON.parse(await success().text());
    raw.usage.cost = null;
    const valid = await client([
      new Response(JSON.stringify(raw)),
    ]).provider.generate(input);
    expect(valid.ok).toBe(true);
    if (valid.ok) expect(valid.usage?.cost).toBeUndefined();

    raw.model = "invalid model";
    const invalid = await client([
      new Response(JSON.stringify(raw)),
    ]).provider.generate(input);
    expect(invalid).toMatchObject({
      ok: false,
      failureCategory: "INVALID_RESPONSE",
    });
  });

  it("fails safely without a key or with invalid input and never leaks secrets", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const provider = createOpenRouterProvider({
      apiKey: undefined,
      fetchImplementation,
    });
    expect(await provider.generate(input)).toEqual({
      ok: false,
      failureCategory: "AUTHENTICATION",
      attempts: [],
    });
    const withKey = createOpenRouterProvider({
      apiKey: key,
      fetchImplementation,
    });
    const result = await withKey.generate({ text: " " });
    expect(result).toMatchObject({
      ok: false,
      failureCategory: "INVALID_REQUEST",
    });
    expect(JSON.stringify(result)).not.toContain(key);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});
