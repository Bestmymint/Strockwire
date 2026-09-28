export type AiProviderFailureCategory =
  | "TIMEOUT"
  | "TRANSPORT"
  | "RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "AUTHENTICATION"
  | "INVALID_REQUEST"
  | "INVALID_RESPONSE"
  | "PROVIDER_ERROR";

export type AiProviderUsage = Readonly<{
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cost?: string;
}>;

export type AiProviderAttempt = Readonly<{
  provider: "openrouter";
  requestedModel: "openai/gpt-4o-mini" | "openai/gpt-4.1-mini";
  attemptNumber: number;
  durationMilliseconds: number;
  httpStatus?: number;
  failureCategory?: AiProviderFailureCategory;
  actualModel?: string;
  usage?: AiProviderUsage;
}>;

export type AiProviderResult =
  | Readonly<{
      ok: true;
      text: string;
      requestedModel: AiProviderAttempt["requestedModel"];
      actualModel: string;
      usage?: AiProviderUsage;
      attempts: readonly AiProviderAttempt[];
    }>
  | Readonly<{
      ok: false;
      failureCategory: AiProviderFailureCategory;
      attempts: readonly AiProviderAttempt[];
    }>;

export interface AiProvider {
  generate(input: Readonly<{ text: string }>): Promise<AiProviderResult>;
}
