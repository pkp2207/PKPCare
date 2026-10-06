import { randomBytes } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  decryptField,
  decryptFields,
  encryptField,
  encryptFields,
  FieldDecryptionError,
  FieldEncryptionConfigError,
  isEncryptionConfigured,
  resetCryptoStateForTests,
  SENSITIVE_PATIENT_FIELDS,
} from "@/lib/compliance/crypto";

const newKey = () => randomBytes(32).toString("base64");

describe("field encryption", () => {
  beforeEach(() => {
    resetCryptoStateForTests();
    vi.stubEnv("FIELD_ENCRYPTION_KEY", newKey());
    vi.stubEnv("FIELD_ENCRYPTION_KEY_PREVIOUS", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    resetCryptoStateForTests();
  });

  it("round-trips and uses the documented format", () => {
    const enc = encryptField("Penicillin, peanuts");
    expect(enc).toMatch(/^enc:v1:[\w-]+:[\w-]+:[\w-]+:[\w-]+$/);
    expect(enc).not.toContain("Penicillin");
    expect(decryptField(enc)).toBe("Penicillin, peanuts");
  });

  it("handles unicode and uses a fresh IV per encryption", () => {
    const a = encryptField("अलर्जी ✓");
    const b = encryptField("अलर्जी ✓");
    expect(a).not.toBe(b);
    expect(decryptField(a)).toBe("अलर्जी ✓");
  });

  it("passes legacy plaintext through decrypt unchanged", () => {
    expect(decryptField("plain legacy value")).toBe("plain legacy value");
    expect(decryptField("")).toBe("");
  });

  it("detects tampering without leaking content", () => {
    const parts = encryptField("secret-123").split(":");
    const ct = Buffer.from(parts[5], "base64url");
    ct[0] ^= 0xff;
    parts[5] = ct.toString("base64url");

    let caught: unknown;
    try {
      decryptField(parts.join(":"));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(FieldDecryptionError);
    expect((caught as Error).message).toBe("Unable to decrypt field");
    expect((caught as Error).message).not.toContain("secret");
  });

  it("rejects a tampered tag and malformed values", () => {
    const parts = encryptField("x").split(":");
    const tag = Buffer.from(parts[4], "base64url");
    tag[0] ^= 1;
    parts[4] = tag.toString("base64url");
    expect(() => decryptField(parts.join(":"))).toThrow(FieldDecryptionError);
    expect(() => decryptField("enc:v1:short")).toThrow(FieldDecryptionError);
    expect(() => decryptField("enc:v9:a:b:c:d")).toThrow(FieldDecryptionError);
  });

  it("fails to decrypt with the wrong key", () => {
    const enc = encryptField("hello");
    resetCryptoStateForTests();
    vi.stubEnv("FIELD_ENCRYPTION_KEY", newKey());
    expect(() => decryptField(enc)).toThrow(FieldDecryptionError);
  });

  it("does not double-encrypt", () => {
    const once = encryptField("value");
    expect(encryptField(once)).toBe(once);

    const obj = encryptFields({ allergies: "pollen" }, ["allergies"]);
    const again = encryptFields(obj, ["allergies"]);
    expect(again.allergies).toBe(obj.allergies);
    expect(decryptField(again.allergies)).toBe("pollen");
  });

  it("supports key rotation via FIELD_ENCRYPTION_KEY_PREVIOUS", () => {
    const oldKey = process.env.FIELD_ENCRYPTION_KEY as string;
    const enc = encryptField("rotate me");

    resetCryptoStateForTests();
    vi.stubEnv("FIELD_ENCRYPTION_KEY", newKey());
    vi.stubEnv("FIELD_ENCRYPTION_KEY_PREVIOUS", oldKey);

    expect(decryptField(enc)).toBe("rotate me");
    const fresh = encryptField("rotate me");
    expect(fresh.split(":")[2]).not.toBe(enc.split(":")[2]); // new key id
    expect(decryptField(fresh)).toBe("rotate me");
  });

  it("encryptFields/decryptFields only touch listed non-empty string fields", () => {
    const input = {
      allergies: "pollen",
      currentMedication: "",
      pastMedicalHistory: undefined,
      identificationNumber: 12345 as unknown as string,
      name: "Visible Name",
    };
    const enc = encryptFields(input, SENSITIVE_PATIENT_FIELDS);
    expect(enc.allergies.startsWith("enc:v1:")).toBe(true);
    expect(enc.currentMedication).toBe("");
    expect(enc.pastMedicalHistory).toBeUndefined();
    expect(enc.identificationNumber).toBe(12345);
    expect(enc.name).toBe("Visible Name");
    expect(input.allergies).toBe("pollen"); // input not mutated

    const dec = decryptFields(enc, SENSITIVE_PATIENT_FIELDS);
    expect(dec.allergies).toBe("pollen");
  });

  it("exposes the sensitive patient field list", () => {
    expect([...SENSITIVE_PATIENT_FIELDS]).toEqual([
      "identificationNumber",
      "insurancePolicyNumber",
      "allergies",
      "currentMedication",
      "familyMedicalHistory",
      "pastMedicalHistory",
    ]);
  });

  it("rejects an invalid key length", () => {
    resetCryptoStateForTests();
    vi.stubEnv(
      "FIELD_ENCRYPTION_KEY",
      Buffer.from("too short").toString("base64"),
    );
    expect(() => encryptField("x")).toThrow(FieldEncryptionConfigError);
    expect(isEncryptionConfigured()).toBe(false);
  });
});

describe("missing FIELD_ENCRYPTION_KEY", () => {
  beforeEach(() => {
    resetCryptoStateForTests();
    vi.stubEnv("FIELD_ENCRYPTION_KEY", "");
    vi.stubEnv("FIELD_ENCRYPTION_KEY_PREVIOUS", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    resetCryptoStateForTests();
  });

  it("passes plaintext through in development and warns once", () => {
    vi.stubEnv("NODE_ENV", "development");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(isEncryptionConfigured()).toBe(false);
    expect(encryptField("a")).toBe("a");
    expect(encryptField("b")).toBe("b");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("throws on encrypt in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => encryptField("a")).toThrow(FieldEncryptionConfigError);
    expect(() => encryptFields({ allergies: "a" }, ["allergies"])).toThrow(
      FieldEncryptionConfigError,
    );
  });

  it("still allows reading legacy plaintext in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(decryptField("legacy")).toBe("legacy");
  });

  it("cannot decrypt encrypted values without a key", () => {
    const enc = (() => {
      vi.stubEnv("FIELD_ENCRYPTION_KEY", newKey());
      resetCryptoStateForTests();
      const value = encryptField("x");
      vi.stubEnv("FIELD_ENCRYPTION_KEY", "");
      resetCryptoStateForTests();
      return value;
    })();
    expect(() => decryptField(enc)).toThrow(FieldDecryptionError);
  });
});
