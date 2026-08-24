import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import {
  applicationContextUrl,
  clearPreviousBranchQueries,
  resolveApplicationContext,
} from "./application-context";
import type { AccessContext } from "./branch-api-client";

const context: AccessContext = {
  organizations: [
    {
      branches: [
        { code: "A", id: "10000000-0000-4000-8000-000000000001", name: "A" },
        { code: "B", id: "10000000-0000-4000-8000-000000000002", name: "B" },
      ],
      id: "20000000-0000-4000-8000-000000000001",
      name: "One",
      role: "OWNER",
    },
  ],
  user: {
    displayName: null,
    email: "owner@example.com",
    id: "30000000-0000-4000-8000-000000000001",
  },
};

describe("application context resolution", () => {
  it("keeps valid URL context and falls back deterministically for stale values", () => {
    expect(
      resolveApplicationContext(
        context,
        context.organizations[0]?.id ?? null,
        context.organizations[0]?.branches[1]?.id ?? null,
      ).branch?.code,
    ).toBe("B");
    expect(
      resolveApplicationContext(context, "stale", "stale").branch?.code,
    ).toBe("A");
  });

  it("requires a chooser when several organizations exist without a valid URL", () => {
    const many: AccessContext = {
      ...context,
      organizations: [
        ...context.organizations,
        {
          ...context.organizations[0]!,
          id: "20000000-0000-4000-8000-000000000002",
        },
      ],
    };
    expect(resolveApplicationContext(many, null, null)).toEqual({
      branch: null,
      organization: null,
    });
  });

  it("encodes only organization and branch in the application URL", () => {
    expect(applicationContextUrl("org id", "branch/id")).toBe(
      "/app?organizationId=org+id&branchId=branch%2Fid",
    );
  });

  it("cancels and removes only the previous branch-scoped cache prefix", async () => {
    const client = new QueryClient();
    client.setQueryData(["branch-scoped", "org", "old", "inventory"], {
      value: 1,
    });
    client.setQueryData(["branch-scoped", "org", "new", "inventory"], {
      value: 2,
    });
    client.setQueryData(["access-context"], { value: 3 });

    await clearPreviousBranchQueries(client, "org", "old");

    expect(
      client.getQueryData(["branch-scoped", "org", "old", "inventory"]),
    ).toBeUndefined();
    expect(
      client.getQueryData(["branch-scoped", "org", "new", "inventory"]),
    ).toEqual({ value: 2 });
    expect(client.getQueryData(["access-context"])).toEqual({ value: 3 });
  });
});
