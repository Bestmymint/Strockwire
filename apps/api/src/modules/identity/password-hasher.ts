import { argon2id, hash, verify } from "argon2";

const ARGON2_OPTIONS = {
  memoryCost: 65_536,
  parallelism: 4,
  timeCost: 3,
  type: argon2id,
} as const;

export interface PasswordHasher {
  hash(password: string): Promise<string>;
}

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export function verifyPassword(
  encodedHash: string,
  password: string,
): Promise<boolean> {
  return verify(encodedHash, password);
}

export const argon2PasswordHasher: PasswordHasher = {
  hash: hashPassword,
};
