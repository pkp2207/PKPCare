// Edge-safe signed session tokens (Web Crypto HMAC-SHA256).
// Works in Next.js middleware (Edge runtime), Node server code and server actions.
// Token format: base64url(JSON payload) + "." + base64url(HMAC-SHA256(payloadPart)).
//
// Payload: { exp, kind?, sub?, role?, email?, name? }
//   - kind "staff"   -> admin_session cookie, sub = Appwrite userId, role required
//   - kind "patient" -> patient_session cookie, sub = Appwrite userId
//   - no kind        -> LEGACY shared-passkey token ({ exp } only). Only ever
//                       accepted as a staff/admin session, and only while
//                       ALLOW_LEGACY_ADMIN_PASSKEY is not "false".

import { isRole, type Role } from "@/lib/auth/roles";

export const SESSION_COOKIE = "admin_session"; // staff (and legacy passkey)
export const PATIENT_SESSION_COOKIE = "patient_session";
export const MFA_PENDING_COOKIE = "staff_mfa_pending";

export const SESSION_TTL_SECONDS = 60 * 60 * 8; // 8 hours (staff)
export const STAFF_SESSION_TTL_SECONDS = SESSION_TTL_SECONDS;
export const PATIENT_SESSION_TTL_SECONDS = 60 * 60 * 24; // 24 hours
export const MFA_PENDING_TTL_SECONDS = 60 * 5; // 5 minutes

export const LEGACY_SUBJECT = "legacy-passkey";

export type SessionKind = "patient" | "staff";

export type SessionClaims = {
  kind: SessionKind;
  sub: string;
  role?: Role;
  email?: string | null;
  name?: string | null;
};

export type SessionPayload = SessionClaims & { exp: number };

export type ResolvedSession = SessionPayload & { legacy: boolean };

const encoder = new TextEncoder();

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function hmacSign(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return new Uint8Array(signature);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

// Constant-time string comparison (does not short-circuit on first mismatch).
export function safeEqual(a: string, b: string): boolean {
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  return bytesEqual(aBytes, bBytes);
}

// `claims` omitted => legacy `{ exp }` token (shared-passkey path).
export async function createSessionToken(
  secret: string,
  ttlSeconds: number = SESSION_TTL_SECONDS,
  claims?: SessionClaims
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const body = claims ? { ...claims, exp } : { exp };
  const payload = bytesToBase64Url(encoder.encode(JSON.stringify(body)));
  const signature = bytesToBase64Url(await hmacSign(secret, payload));
  return `${payload}.${signature}`;
}

// Never throws: any malformed input yields null. Verifies signature + expiry and
// normalises the payload. Legacy `{ exp }` tokens resolve to a staff/admin session
// with `legacy: true`; callers decide whether legacy sessions are still allowed.
export async function readSessionToken(
  token: string | undefined,
  secret: string
): Promise<ResolvedSession | null> {
  try {
    if (!token || !secret) return null;

    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const [payload, signature] = parts;
    if (!payload || !signature) return null;

    const expected = await hmacSign(secret, payload);
    if (!bytesEqual(expected, base64UrlToBytes(signature))) return null;

    const data = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload)));
    if (!data || typeof data !== "object") return null;

    const { exp } = data;
    if (typeof exp !== "number" || !Number.isFinite(exp)) return null;
    if (exp <= Math.floor(Date.now() / 1000)) return null;

    if (data.kind === undefined) {
      return { exp, kind: "staff", sub: LEGACY_SUBJECT, role: "admin", legacy: true };
    }

    if (data.kind !== "patient" && data.kind !== "staff") return null;
    if (typeof data.sub !== "string" || data.sub.length === 0) return null;

    if (data.kind === "staff") {
      if (!isRole(data.role)) return null;
      return {
        exp,
        kind: "staff",
        sub: data.sub,
        role: data.role,
        email: typeof data.email === "string" ? data.email : null,
        name: typeof data.name === "string" ? data.name : null,
        legacy: false,
      };
    }

    return { exp, kind: "patient", sub: data.sub, legacy: false };
  } catch {
    return null;
  }
}

// Never throws: any malformed input yields false. Back-compat boolean check
// (signature + expiry only; does not look at kind).
export async function verifySessionToken(
  token: string | undefined,
  secret: string
): Promise<boolean> {
  try {
    if (!token || !secret) return false;

    const parts = token.split(".");
    if (parts.length !== 2) return false;
    const [payload, signature] = parts;
    if (!payload || !signature) return false;

    const expected = await hmacSign(secret, payload);
    if (!bytesEqual(expected, base64UrlToBytes(signature))) return false;

    const { exp } = JSON.parse(
      new TextDecoder().decode(base64UrlToBytes(payload))
    );
    if (typeof exp !== "number" || !Number.isFinite(exp)) return false;

    return exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

// Staff session: kind "staff" with a valid role, or a legacy passkey token when
// `allowLegacy`. Patient tokens are NEVER a staff session even if correctly signed.
export async function readStaffToken(
  token: string | undefined,
  secret: string,
  allowLegacy: boolean
): Promise<ResolvedSession | null> {
  const session = await readSessionToken(token, secret);
  if (!session || session.kind !== "staff") return null;
  if (session.legacy && !allowLegacy) return null;
  return session;
}

// Patient session: kind "patient" only. Legacy / staff tokens never qualify.
export async function readPatientToken(
  token: string | undefined,
  secret: string
): Promise<ResolvedSession | null> {
  const session = await readSessionToken(token, secret);
  if (!session || session.kind !== "patient" || session.legacy) return null;
  return session;
}
