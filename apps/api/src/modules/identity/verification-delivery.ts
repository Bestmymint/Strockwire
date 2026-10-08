import type { IdentityEmailProvider } from "./email-provider.ts";
import type { VerificationRepository } from "./verification-repository.ts";
import type { VerificationChallengeMaterial } from "./verification-security.ts";

const MAX_OUTSTANDING_DELIVERIES = 32;
const DELIVERY_TIMEOUT_MILLISECONDS = 10_000;

export interface VerificationResponseDelivery {
  finish(): void;
  abort(): void;
}

export interface VerificationDeliveryReservation {
  release(): void;
  prepare(input: {
    prepared: VerificationChallengeMaterial;
    recipient: string;
  }): VerificationResponseDelivery;
}

export interface VerificationDelivery {
  reserve(): VerificationDeliveryReservation | null;
  drain(): Promise<void>;
}

export function createVerificationDelivery({
  emailProvider,
  publicWebOrigin,
  repository,
  onFailure = () => undefined,
}: {
  emailProvider: IdentityEmailProvider;
  publicWebOrigin: string;
  repository: Pick<VerificationRepository, "canDeliver" | "revokeDelivery">;
  onFailure?: (kind: "verification" | "verification_compensation") => void;
}): VerificationDelivery {
  let outstanding = 0;
  let stopping = false;
  let shutdownExpired = false;
  let drainCompletion: PromiseWithResolvers<void> | null = null;
  const controllers = new Set<AbortController>();
  const jobs = new Set<Promise<void>>();

  function track(job: Promise<void>): void {
    jobs.add(job);
    void job.finally(() => jobs.delete(job)).catch(() => undefined);
  }

  async function compensate(
    challengeId: string,
    reason: "DELIVERY_FAILED" | "RESPONSE_ABORTED",
  ): Promise<void> {
    try {
      await repository.revokeDelivery({ challengeId, reason });
    } catch {
      onFailure("verification_compensation");
    }
  }

  return {
    reserve() {
      if (stopping || outstanding >= MAX_OUTSTANDING_DELIVERIES) return null;
      outstanding += 1;
      let released = false;
      const release = () => {
        if (!released) {
          released = true;
          outstanding -= 1;
          if (outstanding === 0) drainCompletion?.resolve();
        }
      };
      return {
        release,
        prepare({
          prepared: {
            challenge: { id: challengeId },
            code,
            rawLinkToken,
          },
          recipient,
        }) {
          let started = false;
          return {
            finish() {
              if (started || released) return;
              started = true;
              track(
                (async () => {
                  try {
                    if (shutdownExpired)
                      throw new Error("Verification delivery drain expired.");
                    if (!(await repository.canDeliver(challengeId))) return;
                    if (shutdownExpired)
                      throw new Error("Verification delivery drain expired.");
                    const url = new URL("/verify-email", publicWebOrigin);
                    url.searchParams.set("token", rawLinkToken);
                    const controller = new AbortController();
                    controllers.add(controller);
                    let timer: NodeJS.Timeout | undefined;
                    try {
                      await Promise.race([
                        emailProvider.send(
                          {
                            kind: "verification",
                            recipient,
                            url: url.toString(),
                            code,
                          },
                          controller.signal,
                        ),
                        new Promise<never>((_resolve, reject) => {
                          timer = setTimeout(() => {
                            controller.abort();
                            reject(
                              new Error("Verification delivery timed out."),
                            );
                          }, DELIVERY_TIMEOUT_MILLISECONDS);
                        }),
                      ]);
                    } finally {
                      clearTimeout(timer);
                      controllers.delete(controller);
                    }
                  } catch {
                    onFailure("verification");
                    await compensate(challengeId, "DELIVERY_FAILED");
                  } finally {
                    release();
                  }
                })(),
              );
            },
            abort() {
              if (started || released) return;
              started = true;
              track(
                compensate(challengeId, "RESPONSE_ABORTED").finally(release),
              );
            },
          };
        },
      };
    },
    async drain() {
      stopping = true;
      if (outstanding === 0) return;
      drainCompletion ??= Promise.withResolvers<void>();
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          drainCompletion.promise,
          new Promise<void>((resolve) => {
            timer = setTimeout(() => {
              shutdownExpired = true;
              for (const controller of controllers) controller.abort();
              resolve();
            }, DELIVERY_TIMEOUT_MILLISECONDS);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
