import type { ApiEnvironment } from "../../environment.ts";
import {
  createResendEmailProvider,
  type IdentityEmailProvider,
  nonDeliveryEmailProvider,
} from "./email-provider.ts";

export function createIdentityEmailProvider(
  environment: Pick<
    ApiEnvironment,
    "RESEND_API_KEY" | "STOCKWISE_EMAIL_FROM" | "STOCKWISE_EMAIL_PROVIDER"
  >,
): IdentityEmailProvider {
  if (environment.STOCKWISE_EMAIL_PROVIDER === "non_delivery") {
    return nonDeliveryEmailProvider;
  }

  if (
    environment.RESEND_API_KEY === undefined ||
    environment.STOCKWISE_EMAIL_FROM === undefined
  ) {
    throw new Error("Resend email configuration is incomplete.");
  }

  return createResendEmailProvider({
    apiKey: environment.RESEND_API_KEY,
    from: environment.STOCKWISE_EMAIL_FROM,
  });
}
