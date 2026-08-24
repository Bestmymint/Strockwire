import { z } from "zod";

import { API_HEALTH_PATH } from "./api-proxy";

const apiHealthResponseSchema = z.object({
  status: z.literal("ok"),
});

export type ApiHealthResponse = z.infer<typeof apiHealthResponseSchema>;

export async function fetchApiHealth(): Promise<ApiHealthResponse> {
  const response = await fetch(API_HEALTH_PATH, {
    headers: { accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error("The API health check was unavailable.");
  }

  return apiHealthResponseSchema.parse(await response.json());
}

const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
  }),
});

const safeApiErrorCodes = new Set([
  "ALREADY_HAS_ORGANIZATION_ACCESS",
  "ALREADY_ONBOARDED",
  "INVALID_CREDENTIALS",
  "INVALID_TOKEN",
  "RATE_LIMITED",
  "VALIDATION_ERROR",
]);

export type AuthApiErrorKind =
  | "already_has_organization_access"
  | "already_onboarded"
  | "invalid_credentials"
  | "invalid_token"
  | "rate_limited"
  | "validation"
  | "unavailable";

export class AuthApiError extends Error {
  readonly kind: AuthApiErrorKind;
  readonly retryAfterSeconds: number | null;

  constructor(kind: AuthApiErrorKind, retryAfterSeconds: number | null = null) {
    super(kind);
    this.kind = kind;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function retryAfterSeconds(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) {
    return null;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 86_400
    ? parsed
    : null;
}

function authErrorFromResponse(
  response: Response,
  body: unknown,
): AuthApiError {
  const parsed = apiErrorSchema.safeParse(body);
  const code =
    parsed.success && safeApiErrorCodes.has(parsed.data.error.code)
      ? parsed.data.error.code
      : undefined;

  if (response.status === 429 || code === "RATE_LIMITED") {
    return new AuthApiError(
      "rate_limited",
      retryAfterSeconds(response.headers.get("Retry-After")),
    );
  }

  if (code === "INVALID_CREDENTIALS") {
    return new AuthApiError("invalid_credentials");
  }

  if (code === "INVALID_TOKEN") {
    return new AuthApiError("invalid_token");
  }

  if (code === "ALREADY_ONBOARDED") {
    return new AuthApiError("already_onboarded");
  }

  if (code === "ALREADY_HAS_ORGANIZATION_ACCESS") {
    return new AuthApiError("already_has_organization_access");
  }

  if (response.status === 400 || code === "VALIDATION_ERROR") {
    return new AuthApiError("validation");
  }

  return new AuthApiError("unavailable");
}

async function readResponseBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

async function postAuth(
  path: string,
  body: Record<string, string> | undefined = undefined,
): Promise<unknown> {
  let response: Response;

  try {
    response = await fetch(`/api/v1/auth/${path}`, {
      credentials: "same-origin",
      headers:
        body === undefined
          ? { accept: "application/json" }
          : { accept: "application/json", "content-type": "application/json" },
      method: "POST",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new AuthApiError("unavailable");
  }

  if (response.status === 204) {
    return undefined;
  }

  const responseBody = await readResponseBody(response);
  if (!response.ok) {
    throw authErrorFromResponse(response, responseBody);
  }

  return responseBody;
}

const acceptedResponseSchema = z.object({
  data: z.object({ status: z.literal("accepted") }),
});
const registrationResponseSchema = z.object({
  data: z.object({
    nextStep: z.literal("verify_email"),
    status: z.literal("accepted"),
  }),
});
const loginResponseSchema = z.object({
  data: z.object({
    user: z.object({
      displayName: z.string().nullable(),
      email: z.string().email(),
      id: z.string(),
    }),
  }),
});
const verificationResponseSchema = z.object({
  data: z.object({ status: z.literal("verified") }),
});
const resetResponseSchema = z.object({
  data: z.object({ status: z.literal("password_reset") }),
});
const firstOrganizationOnboardingResponseSchema = z.object({
  data: z.object({
    user: z.object({
      id: z.string(),
      displayName: z.string(),
      phone: z.string().nullable(),
    }),
    organization: z.object({ id: z.string(), name: z.string() }),
    branch: z.object({
      id: z.string(),
      name: z.string(),
      code: z.literal("MAIN"),
      phone: z.string().nullable(),
      address: z.string().nullable(),
    }),
    role: z.literal("OWNER"),
    nextStep: z.literal("app"),
  }),
});

function parseSuccess<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new AuthApiError("unavailable");
  }

  return parsed.data;
}

export async function register(input: { email: string; password: string }) {
  return parseSuccess(
    registrationResponseSchema,
    await postAuth("register", input),
  );
}

export async function login(input: { email: string; password: string }) {
  return parseSuccess(loginResponseSchema, await postAuth("login", input));
}

export async function resendVerification(input: { email: string }) {
  return parseSuccess(
    acceptedResponseSchema,
    await postAuth("verification-resend", input),
  );
}

export async function verifyEmail(input: { token: string }) {
  return parseSuccess(
    verificationResponseSchema,
    await postAuth("verify-email", input),
  );
}

export async function forgotPassword(input: { email: string }) {
  return parseSuccess(
    acceptedResponseSchema,
    await postAuth("forgot-password", input),
  );
}

export async function resetPassword(input: {
  newPassword: string;
  token: string;
}) {
  return parseSuccess(
    resetResponseSchema,
    await postAuth("reset-password", input),
  );
}

export async function logout() {
  await postAuth("logout");
}

export interface FirstOrganizationOnboardingRequest {
  branchAddress?: string;
  branchName: string;
  branchPhone?: string;
  displayName: string;
  organizationName: string;
  phone?: string;
}

export async function completeFirstOrganizationOnboarding(
  input: FirstOrganizationOnboardingRequest,
) {
  let response: Response;

  try {
    response = await fetch("/api/v1/organizations", {
      body: JSON.stringify(input),
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      method: "POST",
    });
  } catch {
    throw new AuthApiError("unavailable");
  }

  const responseBody = await readResponseBody(response);
  if (!response.ok) {
    throw authErrorFromResponse(response, responseBody);
  }

  return parseSuccess(firstOrganizationOnboardingResponseSchema, responseBody);
}
