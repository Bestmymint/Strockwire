import { describe, expect, it, vi } from "vitest";

import { createRegistrationService } from "./registration-service.ts";

describe("registration service", () => {
  it("hashes the exact password and persists only canonical identity inputs", async () => {
    const hash = vi.fn(async () => "encoded-password-hash");
    const createUnverifiedUser = vi.fn(async () => "created" as const);
    const service = createRegistrationService({
      passwordHasher: { hash },
      repository: { createUnverifiedUser },
    });
    const password = "  exact password é  ";

    await service.register({ email: "user@example.com", password });

    expect(hash).toHaveBeenCalledExactlyOnceWith(password);
    expect(createUnverifiedUser).toHaveBeenCalledExactlyOnceWith({
      email: "user@example.com",
      passwordHash: "encoded-password-hash",
    });
  });

  it("absorbs the repository duplicate result into the same successful outcome", async () => {
    const service = createRegistrationService({
      passwordHasher: { hash: async () => "encoded-password-hash" },
      repository: {
        createUnverifiedUser: async () => "duplicate",
      },
    });

    await expect(
      service.register({
        email: "duplicate@example.com",
        password: "password-long-enough",
      }),
    ).resolves.toBeUndefined();
  });

  it("does not persist when hashing fails", async () => {
    const createUnverifiedUser = vi.fn();
    const service = createRegistrationService({
      passwordHasher: {
        hash: async () => {
          throw new Error("sensitive hashing detail");
        },
      },
      repository: { createUnverifiedUser },
    });

    await expect(
      service.register({
        email: "user@example.com",
        password: "password-long-enough",
      }),
    ).rejects.toThrow("sensitive hashing detail");
    expect(createUnverifiedUser).not.toHaveBeenCalled();
  });
});
