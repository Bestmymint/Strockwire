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

export interface PasswordVerifier {
  verify(encodedHash: string, password: string): Promise<boolean>;
}

// Generated once with the accepted Argon2id parameters. It is public dummy
// verifier material, not a credential, and prevents a missing-user fast path.
export const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=65536,p=4,t=3$Fwq1srX97dnIMcv4NMzTog$0RLy4Jd8dx+jSqv0VZrcRm35bF9Qahtw0K4tOLpUUCs";

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

export const argon2PasswordVerifier: PasswordVerifier = {
  verify: verifyPassword,
};
