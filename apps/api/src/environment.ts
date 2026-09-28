import { z } from "zod";

export const databaseUrlSchema = z
  .string()
  .url()
  .refine((value) => new URL(value).protocol === "postgresql:", {
    message: "must be a postgresql:// connection URL",
  });

const analyticsCursorKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/, "must be canonical base64url")
  .refine(
    (value) => {
      const bytes = Buffer.from(value, "base64url");
      return bytes.length >= 32 && bytes.toString("base64url") === value;
    },
    { message: "must encode at least 32 bytes" },
  );

export const apiEnvironmentSchema = z
  .object({
    DATABASE_URL: databaseUrlSchema,
    OPENROUTER_API_KEY: z
      .string()
      .regex(/^[\x21-\x7e]+$/)
      .optional(),
    RESEND_API_KEY: z.string().min(1).optional(),
    STOCKWISE_ANALYTICS_CURSOR_HMAC_KEY: analyticsCursorKeySchema,
    STOCKWISE_RUNTIME_ENV: z.enum(["development", "test", "production"]),
    STOCKWISE_API_PORT: z.coerce.number().int().min(1).max(65_535),
    STOCKWISE_EMAIL_FROM: z.string().min(1).max(320).optional(),
    STOCKWISE_PUBLIC_WEB_ORIGIN: z
      .string()
      .url()
      .refine(
        (value) => ["http:", "https:"].includes(new URL(value).protocol),
        { message: "must be an HTTP(S) origin" },
      )
      .transform((value) => new URL(value).origin),
    STOCKWISE_SESSION_ABSOLUTE_TIMEOUT_MINUTES: z.coerce
      .number()
      .int()
      .positive()
      .default(7 * 24 * 60),
    STOCKWISE_SESSION_IDLE_TIMEOUT_MINUTES: z.coerce
      .number()
      .int()
      .positive()
      .default(24 * 60),
    STOCKWISE_SESSION_TOUCH_INTERVAL_MINUTES: z.coerce
      .number()
      .int()
      .positive()
      .default(15),
  })
  .strict()
  .superRefine((environment, context) => {
    if (environment.STOCKWISE_RUNTIME_ENV === "production") {
      if (environment.RESEND_API_KEY === undefined) {
        context.addIssue({
          code: "custom",
          message: "Resend API key is required in production.",
          path: ["RESEND_API_KEY"],
        });
      }
      if (environment.STOCKWISE_EMAIL_FROM === undefined) {
        context.addIssue({
          code: "custom",
          message: "Email sender is required in production.",
          path: ["STOCKWISE_EMAIL_FROM"],
        });
      }
    }

    if (
      environment.STOCKWISE_SESSION_IDLE_TIMEOUT_MINUTES >
      environment.STOCKWISE_SESSION_ABSOLUTE_TIMEOUT_MINUTES
    ) {
      context.addIssue({
        code: "custom",
        message: "Session idle timeout must not exceed absolute timeout.",
        path: ["STOCKWISE_SESSION_IDLE_TIMEOUT_MINUTES"],
      });
    }

    if (
      environment.STOCKWISE_SESSION_TOUCH_INTERVAL_MINUTES >
      environment.STOCKWISE_SESSION_IDLE_TIMEOUT_MINUTES
    ) {
      context.addIssue({
        code: "custom",
        message: "Session touch interval must not exceed idle timeout.",
        path: ["STOCKWISE_SESSION_TOUCH_INTERVAL_MINUTES"],
      });
    }
  });

export type ApiEnvironment = z.infer<typeof apiEnvironmentSchema>;

export function loadApiEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ApiEnvironment {
  return apiEnvironmentSchema.parse({
    DATABASE_URL: environment.DATABASE_URL,
    OPENROUTER_API_KEY: environment.OPENROUTER_API_KEY,
    RESEND_API_KEY: environment.RESEND_API_KEY,
    STOCKWISE_ANALYTICS_CURSOR_HMAC_KEY:
      environment.STOCKWISE_ANALYTICS_CURSOR_HMAC_KEY,
    STOCKWISE_RUNTIME_ENV: environment.STOCKWISE_RUNTIME_ENV,
    STOCKWISE_API_PORT: environment.STOCKWISE_API_PORT,
    STOCKWISE_EMAIL_FROM: environment.STOCKWISE_EMAIL_FROM,
    STOCKWISE_PUBLIC_WEB_ORIGIN: environment.STOCKWISE_PUBLIC_WEB_ORIGIN,
    STOCKWISE_SESSION_ABSOLUTE_TIMEOUT_MINUTES:
      environment.STOCKWISE_SESSION_ABSOLUTE_TIMEOUT_MINUTES,
    STOCKWISE_SESSION_IDLE_TIMEOUT_MINUTES:
      environment.STOCKWISE_SESSION_IDLE_TIMEOUT_MINUTES,
    STOCKWISE_SESSION_TOUCH_INTERVAL_MINUTES:
      environment.STOCKWISE_SESSION_TOUCH_INTERVAL_MINUTES,
  });
}
