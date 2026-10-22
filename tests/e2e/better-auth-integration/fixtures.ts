import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import {
  test as base,
  expect,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import {
  localDatabaseFromEnvironment,
  startHarness,
  type IdentityHarness,
} from "./runtime.ts";
const webOrigin = "http://localhost:3202";

export type Scenario = {
  page: Page;
  context: BrowserContext;
  harness: IdentityHarness;
  email: string;
  password: string;
  scenarioId: string;
  stage: string;
};

export const test = base.extend<
  { scenario: Scenario },
  { harness: IdentityHarness }
>({
  harness: [
    async ({ browserName }, use) => {
      if (browserName !== "chromium")
        throw new Error("D4N3_STAGE:unsupported-browser");
      const localDatabase = localDatabaseFromEnvironment();
      const harness = await startHarness(
        localDatabase === undefined ? {} : { localDatabase },
      );
      try {
        await use(harness);
      } finally {
        await harness.stop();
        const directory = "test-results/better-auth-integration/operator";
        await mkdir(directory, { recursive: true });
        await writeFile(
          `${directory}/resource-cleanup.json`,
          JSON.stringify(
            {
              ownedDatabaseCleanup:
                localDatabase === undefined
                  ? "complete"
                  : "delegated-to-local-runner",
              apiShutdown: "complete",
              nextShutdown: "complete",
              prismaDisconnect: "complete",
              mailboxCleanup: "complete",
            },
            null,
            2,
          ),
        );
      }
    },
    { scope: "worker", timeout: 180_000 },
  ],
  scenario: async ({ browser, harness }, use) => {
    const email = `d4n3-${randomUUID()}@example.invalid`;
    const password = randomBytes(24).toString("base64url");
    harness.mailbox.allowAccount(email);
    const context = await browser.newContext({ baseURL: webOrigin });
    const page = await context.newPage();
    try {
      await page.addInitScript(() =>
        localStorage.setItem("stockwise.language", "en"),
      );
      await use({
        page,
        context,
        harness,
        email,
        password,
        scenarioId: "00",
        stage: "setup",
      });
    } finally {
      harness.mailbox.releaseAccount(email);
      await context.close().catch(() => undefined);
    }
  },
});

export function journey(
  name: string,
  body: (input: Scenario) => Promise<void>,
) {
  test(name, async ({ scenario: input }) => {
    const id = name.match(/^([0-9]{2})/)?.[1] ?? "00";
    if (id === "08") test.setTimeout(330_000);
    if (Number(id) >= 11) test.setTimeout(120_000);
    input.scenarioId = id;
    input.stage = "scenario";
    const failedAt = await body(input).then(
      () => null,
      (error: unknown) =>
        error instanceof Error
          ? (error.stack?.match(/session-gaps\.spec\.ts:(\d+):\d+/)?.[1] ??
            "unknown")
          : "unknown",
    );
    if (failedAt !== null)
      throw new Error(
        `D4N3_STAGE:journey-${input.scenarioId}-${input.stage}-line-${failedAt}`,
      );
  });
}
export async function register(input: Scenario) {
  input.stage = "registration";
  await input.page.goto("/register");
  await input.page.getByLabel("Email address").fill(input.email);
  await input.page.getByLabel("Password", { exact: true }).fill(input.password);
  const response = input.page.waitForResponse(
    (r) =>
      r.url().endsWith("/auth/register") && r.request().method() === "POST",
  );
  await input.page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  expect((await response).status()).toBe(202);
  await expect(input.page).toHaveURL(`${webOrigin}/verify-email`);
  await expect(
    input.page.getByLabel("6-digit verification code"),
  ).toBeVisible();
  const message = await input.harness.mailbox.next(input.email);
  if (message.kind !== "verification") throw new Error("D4N3_STAGE:mail-kind");
  const pending =
    await input.harness.prisma.pendingRegistration.findUniqueOrThrow({
      where: { email: input.email },
      select: { id: true, challengeId: true, expiresAt: true },
    });
  if (pending.challengeId === null)
    throw new Error("D4N3_STAGE:missing-challenge");
  return {
    message,
    pendingId: pending.id,
    challengeId: pending.challengeId,
    expiresAt: pending.expiresAt,
  };
}

export async function verifyByCode(input: Scenario, code: string) {
  input.stage = "verification";
  await input.page.getByLabel("6-digit verification code").fill(code);
  await input.page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(
    input.page.getByText("Your email has been verified. You can now sign in.", {
      exact: true,
    }),
  ).toBeVisible();
}

export async function post(
  input: Scenario,
  path: string,
  body: Record<string, unknown>,
) {
  input.stage =
    path === "auth/logout"
      ? "logout"
      : path.startsWith("auth/verify")
        ? "verification-api"
        : "auth-api";
  return input.page.evaluate(
    async ({ path, body }) => {
      const response = await fetch(`/api/v1/${path}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return {
        status: response.status,
        data: response.status === 204 ? null : await response.json(),
      };
    },
    { path, body },
  );
}

export async function login(input: Scenario, password = input.password) {
  input.stage = "login";
  await input.page.goto("/login");
  await input.page.getByLabel("Email address").fill(input.email);
  await input.page.getByLabel("Password", { exact: true }).fill(password);
  const response = input.page.waitForResponse(
    (r) => r.url().endsWith("/auth/login") && r.request().method() === "POST",
  );
  await input.page
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  return response;
}

export async function assertNoAuthority(input: Scenario) {
  expect(
    (await input.context.cookies()).some(
      (cookie) => cookie.name === "stockwise_native.session_token",
    ),
  ).toBe(false);
  expect(
    await input.harness.prisma.betterAuthSession.count({
      where: { user: { email: input.email } },
    }),
  ).toBe(0);
  expect(
    await input.page.evaluate(
      async () => (await fetch("/api/v1/me/access-context")).status,
    ),
  ).toBe(401);
}

export { expect };
