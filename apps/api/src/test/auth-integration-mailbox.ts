import {
  EmailDeliveryError,
  type IdentityEmailProvider,
  type IdentityEmailMessage,
} from "../modules/identity/email-provider.ts";

type VerificationMail = Extract<IdentityEmailMessage, { kind: "verification" }>;

export function createPrivateVerificationMailbox() {
  const accounts = new Set<string>();
  const messages = new Map<string, VerificationMail[]>();
  const waiters = new Map<
    string,
    {
      resolve: (message: VerificationMail) => void;
      reject: () => void;
      timer: NodeJS.Timeout;
    }
  >();
  let closed = false;
  const provider: IdentityEmailProvider = {
    async send(message, signal) {
      if (
        closed ||
        signal?.aborted ||
        message.kind !== "verification" ||
        !accounts.has(message.recipient)
      )
        throw new EmailDeliveryError();
      const captured = Object.freeze({ ...message });
      const waiter = waiters.get(message.recipient);
      if (waiter !== undefined) {
        clearTimeout(waiter.timer);
        waiters.delete(message.recipient);
        waiter.resolve(captured);
      } else {
        const queue = messages.get(message.recipient) ?? [];
        if (queue.length >= 3) throw new EmailDeliveryError();
        queue.push(captured);
        messages.set(message.recipient, queue);
      }
    },
  };
  function clear() {
    closed = true;
    messages.clear();
    accounts.clear();
    for (const waiter of waiters.values()) {
      clearTimeout(waiter.timer);
      waiter.reject();
    }
    waiters.clear();
  }
  return {
    provider,
    allowAccount(email: string) {
      if (closed || !/^t02a-[a-f0-9-]+@example\.invalid$/.test(email))
        throw new Error("Synthetic account admission refused.");
      accounts.add(email);
    },
    next(email: string, timeoutMs = 5_000): Promise<VerificationMail> {
      if (
        closed ||
        !accounts.has(email) ||
        waiters.has(email) ||
        !Number.isInteger(timeoutMs) ||
        timeoutMs < 1 ||
        timeoutMs > 10_000
      )
        return Promise.reject(new Error("Private delivery wait refused."));
      const ready = messages.get(email)?.shift();
      if (ready !== undefined) return Promise.resolve(ready);
      return new Promise((resolve, reject) => {
        const fail = () =>
          reject(new Error("Private verification delivery unavailable."));
        const timer = setTimeout(() => {
          waiters.delete(email);
          fail();
        }, timeoutMs);
        waiters.set(email, { resolve, reject: fail, timer });
      });
    },
    clear,
    releaseAccount(email: string) {
      accounts.delete(email);
      messages.delete(email);
      const waiter = waiters.get(email);
      if (waiter) {
        clearTimeout(waiter.timer);
        waiters.delete(email);
        waiter.reject();
      }
    },
  };
}
