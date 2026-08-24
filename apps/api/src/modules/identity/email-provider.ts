const RESEND_EMAIL_ENDPOINT = "https://api.resend.com/emails";
const RESEND_TIMEOUT_MILLISECONDS = 10_000;

export type IdentityEmailMessage = Readonly<{
  kind: "invitation" | "password_reset" | "verification";
  recipient: string;
  url: string;
}>;

export interface IdentityEmailProvider {
  send(message: IdentityEmailMessage): Promise<void>;
}

export class EmailDeliveryError extends Error {
  constructor() {
    super("Identity email delivery failed.");
    this.name = "EmailDeliveryError";
  }
}

export const nonDeliveryEmailProvider: IdentityEmailProvider = {
  async send() {
    // Development intentionally performs no delivery and retains no token data.
  },
};

export function createRecordingEmailProvider(): IdentityEmailProvider & {
  readonly messages: IdentityEmailMessage[];
} {
  const messages: IdentityEmailMessage[] = [];

  return {
    messages,
    async send(message) {
      messages.push(Object.freeze({ ...message }));
    },
  };
}

export function createResendEmailProvider({
  apiKey,
  fetchImplementation = fetch,
  from,
}: {
  apiKey: string;
  fetchImplementation?: typeof fetch;
  from: string;
}): IdentityEmailProvider {
  return {
    async send(message) {
      const isVerification = message.kind === "verification";
      const isInvitation = message.kind === "invitation";
      const subject = isVerification
        ? "Verify your StockWise email"
        : isInvitation
          ? "Accept your StockWise invitation"
          : "Reset your StockWise password";
      const action = isVerification
        ? "verify your email"
        : isInvitation
          ? "accept your organization invitation"
          : "reset your password";

      try {
        const response = await fetchImplementation(RESEND_EMAIL_ENDPOINT, {
          body: JSON.stringify({
            from,
            subject,
            text: `Use this link to ${action}: ${message.url}`,
            to: [message.recipient],
          }),
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "User-Agent": "stockwise-api/1.0",
          },
          method: "POST",
          signal: AbortSignal.timeout(RESEND_TIMEOUT_MILLISECONDS),
        });

        if (!response.ok) {
          throw new EmailDeliveryError();
        }
      } catch {
        throw new EmailDeliveryError();
      }
    },
  };
}
