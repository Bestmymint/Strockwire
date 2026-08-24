import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "./password-hasher.ts";

describe("Argon2 password hashing", () => {
  it("creates a salted PHC-format Argon2id verifier with the accepted parameters", async () => {
    const password = " exact password é🔒 ";
    const firstHash = await hashPassword(password);
    const secondHash = await hashPassword(password);

    expect(firstHash).toMatch(/^\$argon2id\$v=19\$/);
    expect(firstHash).toContain("m=65536");
    expect(firstHash).toContain("t=3");
    expect(firstHash).toContain("p=4");
    expect(firstHash).not.toBe(secondHash);
    expect(firstHash).not.toContain(password);
    await expect(verifyPassword(firstHash, password)).resolves.toBe(true);
  });

  it("verifies only the exact password without trimming or Unicode normalization", async () => {
    const password = "  password-é🔒  ";
    const encodedHash = await hashPassword(password);

    await expect(verifyPassword(encodedHash, password)).resolves.toBe(true);
    await expect(verifyPassword(encodedHash, password.trim())).resolves.toBe(
      false,
    );
    await expect(
      verifyPassword(encodedHash, password.normalize("NFD")),
    ).resolves.toBe(false);
  });
});
