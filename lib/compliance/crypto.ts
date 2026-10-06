// Application-level field encryption (AES-256-GCM, Node `crypto`).
// Server only. Protects selected columns if the database is read without the
// app (backups, console access, a leaked DB key). It does NOT protect against
// a compromised app server, and encrypted fields cannot be searched or sorted.
//
// Ciphertext format: enc:v1:<keyId>:<iv>:<tag>:<ct>  (segments base64url)
// Keys: FIELD_ENCRYPTION_KEY (current, base64 of 32 bytes) and optionally
// FIELD_ENCRYPTION_KEY_PREVIOUS (decrypt-only, for rotation). keyId is a short
// fingerprint of the key so the right key is picked on decrypt.
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

export const SENSITIVE_PATIENT_FIELDS = [
  "identificationNumber",
  "insurancePolicyNumber",
  "allergies",
  "currentMedication",
  "familyMedicalHistory",
  "pastMedicalHistory",
] as const;

const PREFIX = "enc:";
const VERSION = "v1";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Thrown for missing/invalid key configuration. Message never contains key material. */
export class FieldEncryptionConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FieldEncryptionConfigError";
  }
}

/** Thrown when a value cannot be decrypted (wrong key, tampering, malformed). */
export class FieldDecryptionError extends Error {
  constructor() {
    super("Unable to decrypt field");
    this.name = "FieldDecryptionError";
  }
}

type KeyEntry = { id: string; key: Buffer };
type KeyRing = { current: KeyEntry | null; previous: KeyEntry | null };

const fingerprint = (key: Buffer) =>
  createHash("sha256")
    .update(key)
    .digest()
    .subarray(0, 6)
    .toString("base64url");

const parseKey = (name: string, raw: string | undefined): KeyEntry | null => {
  const value = raw?.trim();
  if (!value) return null;
  const key = Buffer.from(value, "base64");
  if (key.length !== KEY_BYTES) {
    throw new FieldEncryptionConfigError(
      `${name} must be base64 of exactly 32 bytes (generate with: openssl rand -base64 32)`,
    );
  }
  return { id: fingerprint(key), key };
};

let cache: { raw: string; ring: KeyRing } | null = null;

const getKeyRing = (): KeyRing => {
  const currentRaw = process.env.FIELD_ENCRYPTION_KEY ?? "";
  const previousRaw = process.env.FIELD_ENCRYPTION_KEY_PREVIOUS ?? "";
  const raw = `${currentRaw}|${previousRaw}`;
  if (cache && cache.raw === raw) return cache.ring;

  const ring: KeyRing = {
    current: parseKey("FIELD_ENCRYPTION_KEY", currentRaw),
    previous: parseKey("FIELD_ENCRYPTION_KEY_PREVIOUS", previousRaw),
  };
  cache = { raw, ring };
  return ring;
};

let warnedMissingKey = false;

/** Test helper: reset memoized keys and the one-time warning. */
export const resetCryptoStateForTests = () => {
  cache = null;
  warnedMissingKey = false;
};

const isProduction = () => process.env.NODE_ENV === "production";

export const isEncryptionConfigured = (): boolean => {
  try {
    return getKeyRing().current !== null;
  } catch {
    return false;
  }
};

export const isEncrypted = (value: unknown): value is string =>
  typeof value === "string" && value.startsWith(PREFIX);

export const encryptField = (plain: string): string => {
  if (isEncrypted(plain)) return plain;

  const { current } = getKeyRing();
  if (!current) {
    if (isProduction()) {
      throw new FieldEncryptionConfigError(
        "FIELD_ENCRYPTION_KEY is not configured; refusing to store sensitive fields unencrypted in production",
      );
    }
    if (!warnedMissingKey) {
      warnedMissingKey = true;
      console.warn(
        "[compliance] FIELD_ENCRYPTION_KEY is not set: sensitive fields are stored as PLAINTEXT (development only).",
      );
    }
    return plain;
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", current.key, iv, {
    authTagLength: TAG_BYTES,
  });
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    "enc",
    VERSION,
    current.id,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ct.toString("base64url"),
  ].join(":");
};

export const decryptField = (value: string): string => {
  if (!isEncrypted(value)) return value; // legacy plaintext passes through

  try {
    const parts = value.split(":");
    if (parts.length !== 6 || parts[1] !== VERSION)
      throw new FieldDecryptionError();
    const [, , keyId, ivPart, tagPart, ctPart] = parts;

    const ring = getKeyRing();
    const entry = [ring.current, ring.previous].find((k) => k?.id === keyId);
    if (!entry) throw new FieldDecryptionError();

    const iv = Buffer.from(ivPart, "base64url");
    const tag = Buffer.from(tagPart, "base64url");
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES)
      throw new FieldDecryptionError();

    const decipher = createDecipheriv("aes-256-gcm", entry.key, iv, {
      authTagLength: TAG_BYTES,
    });
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(Buffer.from(ctPart, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch (error) {
    // Never surface crypto internals or content.
    if (error instanceof FieldEncryptionConfigError) throw error;
    throw new FieldDecryptionError();
  }
};

const mapFields = <T extends object>(
  obj: T,
  keys: readonly string[],
  fn: (value: string) => string,
): T => {
  const out: Record<string, unknown> = { ...(obj as Record<string, unknown>) };
  for (const key of keys) {
    const value = out[key];
    if (typeof value !== "string" || value === "") continue;
    out[key] = fn(value);
  }
  return out as T;
};

/** Returns a copy with the listed string fields encrypted (empty/non-string skipped, no double encryption). */
export const encryptFields = <T extends object>(
  obj: T,
  keys: readonly string[],
): T => mapFields(obj, keys, (v) => (isEncrypted(v) ? v : encryptField(v)));

/** Returns a copy with the listed string fields decrypted (plaintext passes through). */
export const decryptFields = <T extends object>(
  obj: T,
  keys: readonly string[],
): T => mapFields(obj, keys, (v) => (isEncrypted(v) ? decryptField(v) : v));
