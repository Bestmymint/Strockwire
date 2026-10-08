import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomFillSync,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import type { ApiEnvironment } from "../../environment.ts";

export const VERIFICATION_LIFETIME_MILLISECONDS = 600_000;
const PROOF_COOKIE_NAME = "__Host-stockwise_verification_proof";
const PROOF_PURPOSE = "stockwise-verification-proof/v1";
const OTP_PURPOSE = "stockwise-verification-otp/v1";
const FORMAT = 1;
const PURPOSE = 1;
const FUTURE_SKEW_MILLISECONDS = 5_000;
const PREVIOUS_KEY_WINDOW_MILLISECONDS = 605_000;
const MAX_SIGNED_BIGINT = 2n ** 63n - 1n;
const MAX_DATE_MILLISECONDS = 8_640_000_000_000_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE_PATTERN = /^[0-9]{6}$/;
const MAC_PATTERN = /^[0-9a-f]{64}$/;
const PROOF_PATTERN = /^[A-Za-z0-9_-]{100}$/;

export interface VerificationProof {
  usable: boolean;
  subject: string;
  credentialVersion: bigint;
  issuedAt: Date;
  expiresAt: Date;
}

export interface VerificationChallengeMaterial {
  challenge: {
    id: string;
    userId: string;
    credentialVersion: bigint;
    otpMac: string;
    otpKeyId: number;
    linkTokenHash: string;
    issuedAt: Date;
    expiresAt: Date;
  };
  code: string;
  rawLinkToken: string;
}

export interface PreparedVerification extends VerificationChallengeMaterial {
  proof: string;
}

export interface VerificationSecurity {
  prepare(
    userId: string,
    credentialVersion: bigint,
    issuedAt: Date,
  ): PreparedVerification;
  prepareChallenge(
    userId: string,
    credentialVersion: bigint,
    issuedAt: Date,
  ): VerificationChallengeMaterial;
  prove(
    userId: string,
    credentialVersion: bigint,
    issuedAt: Date,
  ): { proof: string; expiresAt: Date };
  phantom(issuedAt: Date): { proof: string; expiresAt: Date };
  readProof(
    cookieHeader: string | undefined,
    now: Date,
  ): VerificationProof | null;
  matchesOtp(
    input: {
      userId: string;
      id: string;
      credentialVersion: bigint;
      otpKeyId: number;
      otpMac: string;
    },
    code: string,
  ): boolean;
}

export interface VerificationSecurityConfiguration {
  publicWebOrigin: string;
  otpKey: Buffer;
  otpKeyId: number;
  proofKey: Buffer;
  proofKeyId: number;
  previousProofKey?: Buffer;
  previousProofKeyId?: number;
  previousProofKeyLastIssuedAt?: Date;
}

interface ProofKeyMaterial {
  key: Buffer;
  id: number;
  header: Buffer;
  aad: Buffer;
}

interface PreviousProofKeyMaterial extends ProofKeyMaterial {
  lastIssuedAt: number;
}

function isEpoch(value: number): boolean {
  return (
    Number.isSafeInteger(value) && value >= 0 && value <= MAX_DATE_MILLISECONDS
  );
}

function expiry(issuedAt: Date): Date {
  const milliseconds = issuedAt.getTime();
  if (
    !isEpoch(milliseconds) ||
    !isEpoch(milliseconds + VERIFICATION_LIFETIME_MILLISECONDS)
  )
    throw new Error("Invalid verification issuance time.");
  return new Date(milliseconds + VERIFICATION_LIFETIME_MILLISECONDS);
}

function positiveVersion(version: bigint): boolean {
  return (
    typeof version === "bigint" && version >= 1n && version <= MAX_SIGNED_BIGINT
  );
}

function subject(userId: string): Buffer {
  if (!UUID_PATTERN.test(userId))
    throw new Error("Verification proof subject must be a UUID.");
  return Buffer.from(userId.replaceAll("-", ""), "hex");
}

function uuid(bytes: Buffer): string {
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function keyMaterial(
  key: Buffer,
  id: number,
  origin: string,
): ProofKeyMaterial {
  if (
    !Buffer.isBuffer(key) ||
    key.length !== 32 ||
    !Number.isInteger(id) ||
    id < 0 ||
    id > 0xffffffff
  )
    throw new Error("Invalid verification proof key configuration.");
  const header = Buffer.alloc(5);
  header[0] = FORMAT;
  header.writeUInt32BE(id, 1);
  return {
    key: Buffer.from(key),
    id,
    header,
    aad: Buffer.concat([
      Buffer.from(PROOF_PURPOSE),
      header.subarray(0, 1),
      Buffer.from(origin),
      header.subarray(1),
    ]),
  };
}

// Pure budget guard; it cannot reset or mutate the live issuer's private counter.
export function advanceVerificationProofIssuanceCount(count: number): number {
  if (!Number.isSafeInteger(count) || count < 0 || count >= 2 ** 24 - 1)
    throw new Error(
      "Verification proof key issuance ceiling reached; rotate the proof key.",
    );
  return count + 1;
}

function encodeProof(
  material: ProofKeyMaterial,
  usable: boolean,
  subjectBytes: Buffer,
  version: bigint,
  issuedAt: Date,
  expiresAt: Date,
): string {
  const claims = Buffer.alloc(42);
  claims[0] = PURPOSE;
  claims[1] = usable ? 1 : 0;
  subjectBytes.copy(claims, 2);
  claims.writeBigUInt64BE(version, 18);
  claims.writeBigUInt64BE(BigInt(issuedAt.getTime()), 26);
  claims.writeBigUInt64BE(BigInt(expiresAt.getTime()), 34);
  const wire = Buffer.alloc(75);
  material.header.copy(wire);
  randomFillSync(wire, 5, 12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    material.key,
    wire.subarray(5, 17),
  );
  cipher.setAAD(material.aad);
  cipher.update(claims).copy(wire, 17);
  cipher.final(); // GCM has no padding/final payload; finalization produces the tag.
  cipher.getAuthTag().copy(wire, 59);
  return wire.toString("base64url");
}

function cookieValue(header: string | undefined): string | null {
  if (header === undefined) return null;
  let value: string | null = null;
  for (const segment of header.split(";")) {
    const separator = segment.indexOf("=");
    if (separator < 0) {
      if (segment.trim() === PROOF_COOKIE_NAME) return null;
      continue;
    }
    if (segment.slice(0, separator).trim() !== PROOF_COOKIE_NAME) continue;
    if (value !== null) return null;
    value = segment.slice(separator + 1).trim();
  }
  return value !== null && PROOF_PATTERN.test(value) ? value : null;
}

function decodeProof(
  value: string,
  now: Date,
  current: ProofKeyMaterial,
  previous: PreviousProofKeyMaterial | null,
): VerificationProof | null {
  const nowMilliseconds = now.getTime();
  if (!isEpoch(nowMilliseconds)) return null;
  const wire = Buffer.from(value, "base64url");
  if (wire.length !== 75 || wire[0] !== FORMAT) return null;
  const keyId = wire.readUInt32BE(1);
  const isPrevious = previous !== null && keyId === previous.id;
  const material =
    keyId === current.id ? current : isPrevious ? previous : null;
  if (
    material === null ||
    (isPrevious &&
      previous !== null &&
      nowMilliseconds >=
        previous.lastIssuedAt + PREVIOUS_KEY_WINDOW_MILLISECONDS)
  )
    return null;
  let claims: Buffer;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      material.key,
      wire.subarray(5, 17),
    );
    decipher.setAAD(material.aad);
    decipher.setAuthTag(wire.subarray(59));
    claims = decipher.update(wire.subarray(17, 59));
    decipher.final(); // Do not interpret plaintext until tag authentication succeeds.
  } catch {
    return null;
  }
  if (
    claims.length !== 42 ||
    claims[0] !== PURPOSE ||
    (claims[1] !== 0 && claims[1] !== 1)
  )
    return null;
  const version = claims.readBigUInt64BE(18);
  const issued = Number(claims.readBigUInt64BE(26));
  const expires = Number(claims.readBigUInt64BE(34));
  if (
    !positiveVersion(version) ||
    !isEpoch(issued) ||
    !isEpoch(expires) ||
    expires <= issued ||
    expires - issued > VERIFICATION_LIFETIME_MILLISECONDS ||
    issued - nowMilliseconds > FUTURE_SKEW_MILLISECONDS ||
    nowMilliseconds >= expires
  )
    return null;
  if (
    isPrevious &&
    previous !== null &&
    issued > previous.lastIssuedAt + FUTURE_SKEW_MILLISECONDS
  )
    return null;
  return {
    usable: claims[1] === 1,
    subject: uuid(claims.subarray(2, 18)),
    credentialVersion: version,
    issuedAt: new Date(issued),
    expiresAt: new Date(expires),
  };
}

function otpMac(
  key: Buffer,
  userId: string,
  challengeId: string,
  version: bigint,
  code: string,
): Buffer {
  // UUIDs, positive decimal version and six ASCII digits cannot contain the delimiter.
  return createHmac("sha256", key)
    .update(
      [
        OTP_PURPOSE,
        userId.toLowerCase(),
        challengeId.toLowerCase(),
        version.toString(),
        code,
      ].join("\u0000"),
    )
    .digest();
}

export function createVerificationSecurity(
  configuration: VerificationSecurityConfiguration,
): VerificationSecurity {
  const { publicWebOrigin, otpKeyId } = configuration;
  const origin = new URL(publicWebOrigin);
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.origin !== publicWebOrigin
  )
    throw new Error("Invalid verification public origin.");
  if (
    !Buffer.isBuffer(configuration.otpKey) ||
    configuration.otpKey.length < 32 ||
    !Number.isInteger(otpKeyId) ||
    otpKeyId < 1 ||
    otpKeyId > 0x7fffffff
  )
    throw new Error("Invalid verification OTP key configuration.");
  const otpKey = Buffer.from(configuration.otpKey);
  const current = keyMaterial(
    configuration.proofKey,
    configuration.proofKeyId,
    publicWebOrigin,
  );
  if (otpKey.equals(current.key))
    throw new Error(
      "Verification OTP and proof keys must be distinct dedicated keys.",
    );
  const { previousProofKey, previousProofKeyId, previousProofKeyLastIssuedAt } =
    configuration;
  let previous: PreviousProofKeyMaterial | null = null;
  if (
    previousProofKey !== undefined ||
    previousProofKeyId !== undefined ||
    previousProofKeyLastIssuedAt !== undefined
  ) {
    if (
      previousProofKey === undefined ||
      previousProofKeyId === undefined ||
      previousProofKeyLastIssuedAt === undefined
    )
      throw new Error(
        "Previous verification proof key configuration is incomplete.",
      );
    const lastIssuedAt = previousProofKeyLastIssuedAt.getTime();
    const material = keyMaterial(
      previousProofKey,
      previousProofKeyId,
      publicWebOrigin,
    );
    if (
      !isEpoch(lastIssuedAt) ||
      lastIssuedAt > Date.now() + FUTURE_SKEW_MILLISECONDS ||
      material.id === current.id ||
      material.key.equals(current.key) ||
      material.key.equals(otpKey)
    )
      throw new Error("Invalid previous verification proof key configuration.");
    previous = { ...material, lastIssuedAt };
  }
  // Main shares one issuer across all API routes. Cross-restart/fleet accounting
  // remains a Phase 8 operational gate; a stable-key restart does not revoke proofs.
  let proofIssuanceCount = 0;
  function issueProof(
    userId: string,
    version: bigint,
    issuedAt: Date,
    expiresAt: Date,
    usable: boolean,
  ): string {
    if (!positiveVersion(version))
      throw new Error(
        "Verification credential version must be a positive BIGINT.",
      );
    const bytes = subject(userId);
    proofIssuanceCount =
      advanceVerificationProofIssuanceCount(proofIssuanceCount);
    return encodeProof(current, usable, bytes, version, issuedAt, expiresAt);
  }
  function prepareChallenge(
    userId: string,
    version: bigint,
    issuedAt: Date,
  ): VerificationChallengeMaterial {
    if (!UUID_PATTERN.test(userId) || !positiveVersion(version))
      throw new Error("Invalid verification challenge identity.");
    const expiresAt = expiry(issuedAt);
    const id = randomUUID();
    const canonicalUserId = userId.toLowerCase();
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const rawLinkToken = randomBytes(32).toString("base64url");
    return {
      challenge: {
        id,
        userId: canonicalUserId,
        credentialVersion: version,
        otpMac: otpMac(otpKey, canonicalUserId, id, version, code).toString(
          "hex",
        ),
        otpKeyId,
        linkTokenHash: createHash("sha256").update(rawLinkToken).digest("hex"),
        issuedAt,
        expiresAt,
      },
      code,
      rawLinkToken,
    };
  }
  return {
    prepare(userId, version, issuedAt) {
      const material = prepareChallenge(userId, version, issuedAt);
      return {
        ...material,
        proof: issueProof(
          userId,
          version,
          issuedAt,
          material.challenge.expiresAt,
          true,
        ),
      };
    },
    prepareChallenge,
    prove(userId, version, issuedAt) {
      const expiresAt = expiry(issuedAt);
      return {
        proof: issueProof(userId, version, issuedAt, expiresAt, true),
        expiresAt,
      };
    },
    phantom(issuedAt) {
      const expiresAt = expiry(issuedAt);
      return {
        proof: issueProof(randomUUID(), 1n, issuedAt, expiresAt, false),
        expiresAt,
      };
    },
    readProof(header, now) {
      const value = cookieValue(header);
      return value === null ? null : decodeProof(value, now, current, previous);
    },
    matchesOtp(input, code) {
      if (
        input.otpKeyId !== otpKeyId ||
        !CODE_PATTERN.test(code) ||
        !MAC_PATTERN.test(input.otpMac) ||
        !UUID_PATTERN.test(input.userId) ||
        !UUID_PATTERN.test(input.id) ||
        !positiveVersion(input.credentialVersion)
      )
        return false;
      return timingSafeEqual(
        otpMac(otpKey, input.userId, input.id, input.credentialVersion, code),
        Buffer.from(input.otpMac, "hex"),
      );
    },
  };
}

export function serializeVerificationProofCookie(
  proof: string,
  expiresAt: Date,
  now: Date = new Date(),
): string {
  const milliseconds = now.getTime();
  if (
    !PROOF_PATTERN.test(proof) ||
    !isEpoch(expiresAt.getTime()) ||
    !isEpoch(milliseconds)
  )
    throw new Error("Invalid verification proof cookie.");
  const maxAge = Math.max(
    0,
    Math.min(600, Math.floor((expiresAt.getTime() - milliseconds) / 1000)),
  );
  const cookieExpiry = new Date(milliseconds + maxAge * 1000);
  return `${PROOF_COOKIE_NAME}=${proof}; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=${maxAge}; Expires=${cookieExpiry.toUTCString()}`;
}

export function serializeClearedVerificationProofCookie(): string {
  return `${PROOF_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

export function verificationSecurityConfiguration(
  environment: ApiEnvironment,
): VerificationSecurityConfiguration {
  const base: VerificationSecurityConfiguration = {
    publicWebOrigin: environment.STOCKWISE_PUBLIC_WEB_ORIGIN,
    otpKey: Buffer.from(
      environment.STOCKWISE_VERIFICATION_OTP_KEY,
      "base64url",
    ),
    otpKeyId: environment.STOCKWISE_VERIFICATION_OTP_KEY_ID,
    proofKey: Buffer.from(
      environment.STOCKWISE_VERIFICATION_PROOF_KEY,
      "base64url",
    ),
    proofKeyId: environment.STOCKWISE_VERIFICATION_PROOF_KEY_ID,
  };
  const previousProofKey =
    environment.STOCKWISE_VERIFICATION_PREVIOUS_PROOF_KEY;
  const previousProofKeyId =
    environment.STOCKWISE_VERIFICATION_PREVIOUS_PROOF_KEY_ID;
  const previousProofKeyLastIssuedAt =
    environment.STOCKWISE_VERIFICATION_PREVIOUS_PROOF_KEY_LAST_ISSUED_AT;
  if (
    previousProofKey === undefined &&
    previousProofKeyId === undefined &&
    previousProofKeyLastIssuedAt === undefined
  )
    return base;
  if (
    previousProofKey === undefined ||
    previousProofKeyId === undefined ||
    previousProofKeyLastIssuedAt === undefined
  )
    throw new Error(
      "Previous verification proof key configuration is incomplete.",
    );
  return {
    ...base,
    previousProofKey: Buffer.from(previousProofKey, "base64url"),
    previousProofKeyId,
    previousProofKeyLastIssuedAt: new Date(previousProofKeyLastIssuedAt),
  };
}
