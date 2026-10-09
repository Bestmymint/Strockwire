import assert from "node:assert/strict";

export function assertMailboxOnlyTerminalState(
  challenge: { consumedAt: Date | null; failedOtpAttempts: number | null },
  user: { emailVerifiedAt: Date | null },
  sessionCount: number,
) {
  assert(challenge.consumedAt === null, "Mailbox-only challenge was consumed.");
  assert(user.emailVerifiedAt === null, "Mailbox-only user was verified.");
  assert(
    challenge.failedOtpAttempts === 1,
    "Mailbox-only OTP failure count changed.",
  );
  assert(sessionCount === 0, "Mailbox-only session authority was created.");
}
