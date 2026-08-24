import { describe, expect, it } from "vitest";

import { Prisma } from "../../generated/prisma/client.ts";
import { isCanonicalEmailConflict } from "./registration-repository.ts";

function knownRequestError(code: string, target: unknown) {
  return new Prisma.PrismaClientKnownRequestError("raw database detail", {
    clientVersion: "7.9.1",
    code,
    meta: { target },
  });
}

function adapterUniqueError(fields: string[]) {
  return new Prisma.PrismaClientKnownRequestError("raw database detail", {
    clientVersion: "7.9.1",
    code: "P2002",
    meta: {
      driverAdapterError: {
        cause: {
          constraint: { fields },
          kind: "UniqueConstraintViolation",
        },
      },
    },
  });
}

describe("registration persistence error translation", () => {
  it.each([["users_email_key"], [["email"]], ["email"]])(
    "recognizes a canonical-email uniqueness conflict for target %j",
    (target) => {
      expect(isCanonicalEmailConflict(knownRequestError("P2002", target))).toBe(
        true,
      );
    },
  );

  it("recognizes Prisma 7 driver-adapter email constraint metadata", () => {
    expect(isCanonicalEmailConflict(adapterUniqueError(["email"]))).toBe(true);
  });

  it("does not absorb unrelated uniqueness or persistence failures", () => {
    expect(
      isCanonicalEmailConflict(knownRequestError("P2002", ["unrelated_field"])),
    ).toBe(false);
    expect(
      isCanonicalEmailConflict(knownRequestError("P1001", ["email"])),
    ).toBe(false);
    expect(isCanonicalEmailConflict(adapterUniqueError(["id"]))).toBe(false);
    expect(isCanonicalEmailConflict(new Error("database unavailable"))).toBe(
      false,
    );
  });
});
