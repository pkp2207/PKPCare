// Signed, expiring, purpose-bound tokens (HMAC-SHA256). Server only.
//
// Format: base64url(JSON payload) + "." + base64url(HMAC). The purpose is in
// the signed payload AND in the HMAC context, so a token minted for another
// purpose can never verify as a visit token even under the same secret.
import { createHmac, timingSafeEqual } from "node:crypto";

import { getTelehealthSecret } from "./secret";

export type VisitRole = "patient" | "doctor";

export type VisitClaims = { appointmentId: string; role: VisitRole };

export type TokenFailure = "malformed" | "signature" | "expired" | "purpose";

export type VerifyResult<T> =
  | { ok: true; claims: T; expiresAt: number }
  | { ok: false; reason: TokenFailure };

const CONTEXT = "pkp-telehealth-token:v1";

const sign = (secret: string, purpose: string, payload: string) =>
  createHmac("sha256", secret).update(`${CONTEXT}:${purpose}.${payload}`).digest();

const b64 = (buf: Buffer | string) => Buffer.from(buf).toString("base64url");

/** Generic signer; `expiresAt` is epoch ms. */
export const signToken = (
  purpose: string,
  claims: Record<string, unknown>,
  expiresAt: number,
  secret: string = getTelehealthSecret(),
): string => {
  const payload = b64(
    JSON.stringify({ ...claims, p: purpose, exp: Math.floor(expiresAt / 1000) }),
  );
  return `${payload}.${b64(sign(secret, purpose, payload))}`;
};

export const verifyToken = (
  token: string,
  purpose: string,
  now: number = Date.now(),
  secret?: string,
): VerifyResult<Record<string, unknown>> => {
  try {
    if (typeof token !== "string" || token.length > 1024) {
      return { ok: false, reason: "malformed" };
    }
    const parts = token.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      return { ok: false, reason: "malformed" };
    }
    const [payload, signature] = parts;

    const expected = sign(secret ?? getTelehealthSecret(), purpose, payload);
    const given = Buffer.from(signature, "base64url");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      return { ok: false, reason: "signature" };
    }

    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data || typeof data !== "object") return { ok: false, reason: "malformed" };
    if (data.p !== purpose) return { ok: false, reason: "purpose" };
    if (typeof data.exp !== "number" || !Number.isFinite(data.exp)) {
      return { ok: false, reason: "malformed" };
    }
    if (data.exp * 1000 <= now) return { ok: false, reason: "expired" };

    const { p: _p, exp, ...claims } = data as Record<string, unknown> & {
      exp: number;
    };
    return { ok: true, claims, expiresAt: exp * 1000 };
  } catch {
    // Includes a missing secret: fail closed, never throw to callers.
    return { ok: false, reason: "malformed" };
  }
};

// ---- visit tokens ----------------------------------------------------------

export const VISIT_PURPOSE = "visit";

export const signVisitToken = (
  claims: VisitClaims,
  expiresAt: number,
  secret?: string,
): string =>
  signToken(
    VISIT_PURPOSE,
    { a: claims.appointmentId, r: claims.role },
    expiresAt,
    secret,
  );

export const verifyVisitToken = (
  token: string,
  now: number = Date.now(),
  secret?: string,
): VerifyResult<VisitClaims> => {
  const result = verifyToken(token, VISIT_PURPOSE, now, secret);
  if (!result.ok) return result;
  const { a, r } = result.claims;
  if (typeof a !== "string" || !a || (r !== "patient" && r !== "doctor")) {
    return { ok: false, reason: "malformed" };
  }
  return {
    ok: true,
    claims: { appointmentId: a, role: r },
    expiresAt: result.expiresAt,
  };
};
