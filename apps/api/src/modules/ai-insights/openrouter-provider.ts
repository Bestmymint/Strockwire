import { z } from "zod";

import type {
  AiProvider,
  AiProviderAttempt,
  AiProviderFailureCategory,
  AiProviderResult,
  AiProviderUsage,
} from "./ai-provider.ts";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const PRIMARY_MODEL = "openai/gpt-4o-mini";
const FALLBACK_MODEL = "openai/gpt-4.1-mini";
const TIMEOUT_MILLISECONDS = 15_000;
const REQUEST_LIMIT_BYTES = 16 * 1024;
const RESPONSE_TEXT_LIMIT_BYTES = 4 * 1024;
const RESPONSE_BODY_LIMIT_BYTES = 32 * 1024;

const tokenCount = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER)
  .nullable()
  .optional();

const usageSchema = z
  .object({
    prompt_tokens: tokenCount,
    completion_tokens: tokenCount,
    total_tokens: tokenCount,
    cost: z.number().finite().nonnegative().nullable().optional(),
  })
  .passthrough();

const completionSchema = z.object({
  object: z.literal("chat.completion"),
  model: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9_./:-]+$/),
  choices: z
    .array(
      z.object({
        index: z.literal(0),
        finish_reason: z.literal("stop"),
        message: z.object({
          role: z.literal("assistant"),
          content: z.string().min(1),
        }),
      }),
    )
    .length(1),
  usage: usageSchema.optional(),
});

function bodyFor(model: AiProviderAttempt["requestedModel"], text: string) {
  return JSON.stringify({
    model,
    messages: [{ role: "user", content: text }],
    max_tokens: 512,
    usage: { include: true },
  });
}

function classifyStatus(status: number): AiProviderFailureCategory {
  if (status === 408) return "TIMEOUT";
  if (status === 429) return "RATE_LIMITED";
  if (status === 503) return "PROVIDER_UNAVAILABLE";
  if (status === 401 || status === 403) return "AUTHENTICATION";
  if ([400, 413, 422].includes(status)) return "INVALID_REQUEST";
  if (status >= 400 && status < 500 && status !== 402 && status !== 404)
    return "INVALID_REQUEST";
  return "PROVIDER_ERROR";
}

function retryable(category: AiProviderFailureCategory, status?: number) {
  return (
    category === "TIMEOUT" ||
    category === "TRANSPORT" ||
    category === "RATE_LIMITED" ||
    (status !== undefined && status >= 500)
  );
}

async function readBounded(response: Response): Promise<string | null> {
  if (response.body === null) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > RESPONSE_BODY_LIMIT_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks, length),
    );
  } catch {
    return null;
  }
}

function normalizeUsage(
  usage: z.infer<typeof usageSchema> | undefined,
): AiProviderUsage | undefined {
  if (usage === undefined) return undefined;
  return {
    ...(usage.prompt_tokens == null
      ? {}
      : { promptTokens: usage.prompt_tokens }),
    ...(usage.completion_tokens == null
      ? {}
      : { completionTokens: usage.completion_tokens }),
    ...(usage.total_tokens == null ? {} : { totalTokens: usage.total_tokens }),
    ...(usage.cost == null ? {} : { cost: String(usage.cost) }),
  };
}

export function createOpenRouterProvider({
  apiKey,
  fetchImplementation = fetch,
}: {
  apiKey?: string | undefined;
  fetchImplementation?: typeof fetch;
}): AiProvider {
  return {
    async generate(input): Promise<AiProviderResult> {
      const attempts: AiProviderAttempt[] = [];
      if (apiKey === undefined || !/^[\x21-\x7e]+$/.test(apiKey)) {
        return { ok: false, failureCategory: "AUTHENTICATION", attempts };
      }
      if (typeof input.text !== "string" || input.text.trim().length === 0) {
        return { ok: false, failureCategory: "INVALID_REQUEST", attempts };
      }
      const primaryBody = bodyFor(PRIMARY_MODEL, input.text);
      const fallbackBody = bodyFor(FALLBACK_MODEL, input.text);
      if (
        Buffer.byteLength(primaryBody, "utf8") > REQUEST_LIMIT_BYTES ||
        Buffer.byteLength(fallbackBody, "utf8") > REQUEST_LIMIT_BYTES
      ) {
        return { ok: false, failureCategory: "INVALID_REQUEST", attempts };
      }

      async function call(
        model: AiProviderAttempt["requestedModel"],
        body: string,
      ): Promise<AiProviderResult> {
        const started = performance.now();
        const signal = AbortSignal.timeout(TIMEOUT_MILLISECONDS);
        let status: number | undefined;
        let failureCategory: AiProviderFailureCategory | undefined;
        let completion: z.infer<typeof completionSchema> | undefined;

        try {
          const response = await fetchImplementation(ENDPOINT, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body,
            signal,
            redirect: "error",
          });
          status = response.status;
          if (!response.ok) {
            // OpenRouter does not document a stable model-specific unavailable
            // code; a generic 404 cannot safely trigger model fallback.
            failureCategory = classifyStatus(status);
          } else {
            const raw = await readBounded(response);
            if (raw === null) {
              failureCategory = "INVALID_RESPONSE";
            } else {
              let parsed: unknown;
              try {
                parsed = JSON.parse(raw);
              } catch {
                failureCategory = "INVALID_RESPONSE";
              }
              if (failureCategory === undefined) {
                const checked = completionSchema.safeParse(parsed);
                if (!checked.success) {
                  failureCategory = "INVALID_RESPONSE";
                } else if (
                  // The accepted fallback alias has this canonical slug in
                  // OpenRouter's public model record; no arbitrary suffixes.
                  checked.data.model !== model &&
                  !(
                    model === FALLBACK_MODEL &&
                    checked.data.model === "openai/gpt-4.1-mini-2025-04-14"
                  )
                ) {
                  failureCategory = "INVALID_RESPONSE";
                } else if (
                  Buffer.byteLength(
                    checked.data.choices[0]!.message.content,
                    "utf8",
                  ) > RESPONSE_TEXT_LIMIT_BYTES
                ) {
                  failureCategory = "INVALID_RESPONSE";
                } else {
                  completion = checked.data;
                }
              }
            }
          }
        } catch {
          failureCategory = signal.aborted ? "TIMEOUT" : "TRANSPORT";
        }

        const usage = normalizeUsage(completion?.usage);
        attempts.push({
          provider: "openrouter",
          requestedModel: model,
          attemptNumber: attempts.length + 1,
          durationMilliseconds: performance.now() - started,
          ...(status === undefined ? {} : { httpStatus: status }),
          ...(failureCategory === undefined ? {} : { failureCategory }),
          ...(completion === undefined
            ? {}
            : {
                actualModel: completion.model,
                ...(usage === undefined ? {} : { usage }),
              }),
        });

        if (completion !== undefined) {
          return {
            ok: true,
            text: completion.choices[0]!.message.content,
            requestedModel: model,
            actualModel: completion.model,
            ...(usage === undefined ? {} : { usage }),
            attempts,
          };
        }
        return {
          ok: false,
          failureCategory: failureCategory ?? "INVALID_RESPONSE",
          attempts,
        };
      }

      const first = await call(PRIMARY_MODEL, primaryBody);
      if (
        first.ok ||
        !retryable(first.failureCategory, first.attempts.at(-1)?.httpStatus)
      )
        return first;

      const second = await call(PRIMARY_MODEL, primaryBody);
      if (
        second.ok ||
        !retryable(second.failureCategory, second.attempts.at(-1)?.httpStatus)
      )
        return second;

      return call(FALLBACK_MODEL, fallbackBody);
    },
  };
}
