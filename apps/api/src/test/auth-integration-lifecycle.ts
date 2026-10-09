// Cleanup must continue after an independent failure, without retaining its error.
export async function authBounded<T>(
  work: Promise<T>,
  milliseconds = 10_000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(new Error("Authentication harness operation timed out.")),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function createAuthCleanup() {
  const steps: (() => void | Promise<unknown>)[] = [];
  let stopped: Promise<void> | undefined;
  return {
    add(step: () => void | Promise<unknown>) {
      steps.push(step);
    },
    stop() {
      stopped ??= (async () => {
        let failed = false;
        for (const step of steps.toReversed()) {
          try {
            await authBounded(Promise.resolve().then(step));
          } catch {
            failed = true;
          }
        }
        if (failed)
          throw new Error(
            "Authentication harness cleanup incomplete; review owned resources.",
          );
      })();
      return stopped;
    },
  };
}
