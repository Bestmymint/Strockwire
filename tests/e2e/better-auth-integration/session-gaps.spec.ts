import { randomBytes, randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import {
  journey,
  register,
  verifyByCode,
  login,
  expect,
  type Scenario,
} from "./fixtures";

const origin = "http://localhost:3202";
const cookieName = "stockwise_native.session_token";

async function account(input: Scenario) {
  const registration = await register(input);
  await verifyByCode(input, registration.message.code);
  const user = await input.harness.prisma.user.findUniqueOrThrow({
    where: { email: input.email },
    select: { id: true },
  });
  const organization = await input.harness.prisma.organization.create({
    data: { name: `Private gap ${user.id}` },
  });
  const branch = await input.harness.prisma.branch.create({
    data: {
      organizationId: organization.id,
      code: "GAP",
      name: `Private branch ${user.id}`,
    },
  });
  await input.harness.prisma.organizationMembership.create({
    data: { organizationId: organization.id, userId: user.id, role: "OWNER" },
  });
  return { user, organization, branch };
}

// Read-only observation of the actual mounted QueryClient; no runtime hook,
// fabricated query, authentication state, or successful API response is injected.
// Fail closed if the pinned React provider structure no longer exposes the client.
async function hasPrivateCache(page: Page, marker: string) {
  return page.evaluate((marker) => {
    type Fiber = {
      return?: Fiber;
      memoizedProps?: {
        client?: {
          getQueryCache?: () => {
            getAll: () => Array<{ state: { data: unknown } }>;
          };
        };
      };
    };
    for (const node of document.querySelectorAll("main, nav")) {
      const key = Object.keys(node).find((key) =>
        key.startsWith("__reactFiber$"),
      );
      if (!key) continue;
      let fiber = (node as unknown as Record<string, Fiber>)[key];
      while (fiber) {
        const client = fiber.memoizedProps?.client;
        if (typeof client?.getQueryCache === "function") {
          return client
            .getQueryCache()
            .getAll()
            .some((query) =>
              JSON.stringify(query.state.data)?.includes(marker),
            );
        }
        fiber = fiber.return!;
      }
    }
    throw new Error("query-client-observation-unavailable");
  }, marker);
}

async function mount(
  input: Scenario,
  scope: Awaited<ReturnType<typeof account>>,
  page = input.page,
) {
  await page.goto(
    `/app?organizationId=${scope.organization.id}&branchId=${scope.branch.id}`,
  );
  await expect(page.getByLabel("Branch")).toHaveValue(scope.branch.id);
  await expect(
    page.getByRole("link", { name: "Manage branches", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => hasPrivateCache(page, scope.organization.name))
    .toBe(true);
}

async function denied(page: Page) {
  expect(
    await page.evaluate(
      async () => (await fetch("/api/v1/me/access-context")).status,
    ),
  ).toBe(401);
}

async function recovered(page: Page, marker: string) {
  // Either access-context recovery redirects, or a protected-resource 401
  // presents the explicit guest recovery action. Neither may retain private UI.
  await expect
    .poll(async () => {
      return (
        new URL(page.url()).pathname === "/login" ||
        (await page.getByRole("alert").filter({ hasText: "session" }).count()) >
          0
      );
    })
    .toBe(true);
  await expect(page.getByLabel("Branch")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Manage branches", exact: true }),
  ).toHaveCount(0);
  await expect.poll(() => hasPrivateCache(page, marker)).toBe(false);
  if (new URL(page.url()).pathname !== "/login") {
    await page.getByRole("link", { name: "Sign in", exact: true }).click();
  }
  await expect(page.getByLabel("Email address")).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
}

async function replayDenied(
  input: Scenario,
  cookies: Awaited<ReturnType<Scenario["context"]["cookies"]>>,
) {
  const replay = await input.context.browser()!.newContext({ baseURL: origin });
  try {
    await replay.addCookies(
      cookies.filter((cookie) => cookie.name === cookieName),
    );
    const page = await replay.newPage();
    await page.goto("/login");
    await denied(page);
    await expect(page.getByLabel("Email address")).toBeVisible();
  } finally {
    await replay.close();
  }
}

journey(
  "11 two mounted tabs share native cookies; logout and account switch purge private cache",
  async (input) => {
    const scope = await account(input);
    expect((await login(input)).status()).toBe(200);
    await mount(input, scope);
    const cookies = await input.context.cookies();
    const session =
      await input.harness.prisma.betterAuthSession.findFirstOrThrow({
        where: { userId: scope.user.id },
        select: { id: true },
      });
    const second = await input.context.newPage();
    await mount(input, scope, second);
    for (const page of [input.page, second]) {
      expect(
        await page.evaluate(async () => {
          const response = await fetch("/api/v1/me/access-context");
          return {
            status: response.status,
            id: (await response.json()).data.user.id,
          };
        }),
      ).toEqual({ status: 200, id: scope.user.id });
    }
    expect(
      await input.harness.prisma.betterAuthSession.count({
        where: { userId: scope.user.id },
      }),
    ).toBe(1);
    input.stage = "two-tab-logout";
    await second.getByRole("button", { name: "Log out", exact: true }).click();
    await expect(second).toHaveURL(`${origin}/login`);
    expect(
      await input.harness.prisma.betterAuthSession.findUnique({
        where: { id: session.id },
      }),
    ).toBeNull();
    await denied(input.page);
    await recovered(input.page, scope.organization.name);
    await replayDenied(input, cookies);

    input.stage = "account-switch";
    const other = {
      ...input,
      page: second,
      email: `d4n3-${randomUUID()}@example.invalid`,
      password: randomBytes(24).toString("base64url"),
    };
    input.harness.mailbox.allowAccount(other.email);
    try {
      const otherScope = await account(other);
      expect((await login(other)).status()).toBe(200);
      await expect(second.getByLabel("Branch")).toHaveValue(
        otherScope.branch.id,
      );
      // The first tab stays mounted while another account changes shared cookies.
      await expect(input.page.getByLabel("Branch")).toHaveValue(
        otherScope.branch.id,
      );
      for (const page of [input.page, second]) {
        await expect
          .poll(() => hasPrivateCache(page, scope.organization.name))
          .toBe(false);
        expect(
          await page.evaluate(
            async () =>
              (await (await fetch("/api/v1/me/access-context")).json()).data
                .user.id,
          ),
        ).toBe(otherScope.user.id);
        await expect(
          page
            .getByLabel("Branch")
            .locator(`option[value="${scope.branch.id}"]`),
        ).toHaveCount(0);
      }
    } finally {
      input.harness.mailbox.releaseAccount(other.email);
    }
  },
);

journey(
  "12 password reset invalidates mounted workspaces and every prior native session",
  async (input) => {
    const scope = await account(input);
    expect((await login(input)).status()).toBe(200);
    await mount(input, scope);
    const oldCookies = await input.context.cookies();
    const otherContext = await input.context
      .browser()!
      .newContext({ baseURL: origin });
    try {
      const otherPage = await otherContext.newPage();
      await otherPage.addInitScript(() =>
        localStorage.setItem("stockwise.language", "en"),
      );
      const other = { ...input, page: otherPage, context: otherContext };
      expect((await login(other)).status()).toBe(200);
      await mount(other, scope);
      expect(
        await input.harness.prisma.betterAuthSession.count({
          where: { userId: scope.user.id },
        }),
      ).toBe(2);
      const secondCookies = await otherContext.cookies();
      // Recovery in an unauthenticated context must not replace either mounted workspace.
      const recoveryContext = await input.context
        .browser()!
        .newContext({ baseURL: origin });
      try {
        const recovery = await recoveryContext.newPage();
        await recovery.addInitScript(() =>
          localStorage.setItem("stockwise.language", "en"),
        );
        await recovery.goto("/forgot-password");
        await recovery.getByLabel("Email address").fill(input.email);
        await recovery
          .getByRole("button", { name: "Request password reset" })
          .click();
        await expect(
          recovery.getByRole("status").filter({ hasText: "inbox" }),
        ).toBeVisible();
        const mail = await input.harness.mailbox.next(input.email);
        if (mail.kind !== "password_reset") throw new Error("reset-mail-kind");
        await recovery.goto(mail.url);
        const replacement = randomBytes(24).toString("base64url");
        await recovery.getByLabel("New password").fill(replacement);
        await recovery
          .getByRole("button", { name: "Reset password", exact: true })
          .click();
        await expect(
          recovery.getByText(
            "Your password has been reset. Sign in with your new password.",
            { exact: true },
          ),
        ).toBeVisible();
        expect(
          await input.harness.prisma.betterAuthSession.count({
            where: { userId: scope.user.id },
          }),
        ).toBe(0);
        expect(
          (await recoveryContext.cookies()).some(
            (cookie) => cookie.name === cookieName,
          ),
        ).toBe(false);
        await denied(recovery);
        input.stage = "reset-mounted-operation";
        for (const page of [input.page, otherPage]) {
          const [rejection] = await Promise.all([
            page.waitForResponse(
              (r) =>
                r.url().endsWith("/api/v1/me/access-context") ||
                r
                  .url()
                  .includes(`/organizations/${scope.organization.id}/branches`),
            ),
            page
              .getByRole("link", { name: "Manage branches", exact: true })
              .click(),
          ]);
          input.stage = `reset-operation-http-${rejection.status()}`;
          expect(rejection.status()).toBe(401);
          input.stage = "reset-visible-recovery-cache";
          await recovered(page, scope.organization.name);
          await denied(page);
        }
        await replayDenied(input, oldCookies);
        await replayDenied(input, secondCookies);
        input.stage = "reset-explicit-login";
        expect((await login(input)).status()).toBe(401);
        await expect(
          input.page.getByRole("main").getByRole("alert"),
        ).toBeFocused();
        expect((await login(input, replacement)).status()).toBe(200);
        await expect(input.page.getByLabel("Branch")).toHaveValue(
          scope.branch.id,
        );
        expect(
          await input.page.evaluate(
            async () => (await fetch("/api/v1/me/access-context")).status,
          ),
        ).toBe(200);
      } finally {
        await recoveryContext.close();
      }
    } finally {
      await otherContext.close();
    }
  },
);

for (const [number, state] of [
  ["13", "expired"],
  ["14", "disabled"],
  ["15", "credential-version"],
  ["16", "revoked"],
] as const) {
  journey(
    `${number} ${state} native session denies protected operation and clears mounted private cache`,
    async (input) => {
      const scope = await account(input);
      expect((await login(input)).status()).toBe(200);
      await mount(input, scope);
      const cookies = await input.context.cookies();
      const session =
        await input.harness.prisma.betterAuthSession.findFirstOrThrow({
          where: { userId: scope.user.id },
          select: { id: true },
        });
      input.stage = `${state}-fixture`;
      if (state === "expired") {
        await input.harness.prisma.betterAuthSession.update({
          where: { id: session.id },
          data: { expiresAt: new Date(Date.now() - 1000) },
        });
      } else if (state === "disabled") {
        await input.harness.prisma.user.update({
          where: { id: scope.user.id },
          data: { status: "DISABLED", disabledAt: new Date() },
        });
      } else if (state === "credential-version") {
        await input.harness.prisma.user.update({
          where: { id: scope.user.id },
          data: { credentialVersion: { increment: 1 } },
        });
      } else {
        await input.harness.prisma.betterAuthSession.delete({
          where: { id: session.id },
        });
      }
      input.stage = `${state}-mounted-operation`;
      const [rejection] = await Promise.all([
        input.page.waitForResponse(
          (r) =>
            r.url().endsWith("/api/v1/me/access-context") ||
            r
              .url()
              .includes(`/organizations/${scope.organization.id}/branches`),
        ),
        input.page
          .getByRole("link", { name: "Manage branches", exact: true })
          .click(),
      ]);
      input.stage = `${state}-operation-http-${rejection.status()}`;
      expect(rejection.status()).toBe(401);
      input.stage = `${state}-visible-recovery-cache`;
      await recovered(input.page, scope.organization.name);
      await denied(input.page);
      await replayDenied(input, cookies);
    },
  );
}
