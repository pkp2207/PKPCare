// Signed action links: /a/<token>.
//
// Token = base64url(JSON payload) "." base64url(HMAC-SHA256(secret,
// "notification-link:v1." + payloadPart)). The context prefix means a token can
// never validate as a session cookie (or the reverse) even when the secret falls
// back to ADMIN_SESSION_SECRET. Verification is constant-time.
//
// Payload: { v: 1, a: resourceId, u: userId, p: purposes, e: expirySeconds }
//   a = appointment id (waitlist offers: the waitlist entry id)
//   p = letters: c confirm, x cancel, r reschedule, w waitlist claim
import { createHmac, timingSafeEqual } from "node:crypto";

import { appBaseUrl } from "./config";

export type LinkPurpose = "confirm" | "cancel" | "reschedule" | "waitlist";

const PURPOSE_CODE: Record<LinkPurpose, string> = {
  confirm: "c",
  cancel: "x",
  reschedule: "r",
  waitlist: "w",
};
const CODE_PURPOSE = Object.fromEntries(
  Object.entries(PURPOSE_CODE).map(([purpose, code]) => [code, purpose])
) as Record<string, LinkPurpose>;

export const APPOINTMENT_LINK_PURPOSES: LinkPurpose[] = [
  "confirm",
  "cancel",
  "reschedule",
];

const CONTEXT = "notification-link:v1.";
const MAX_TOKEN_LENGTH = 512;
const MAX_LINK_LIFETIME_SECONDS = 30 * 24 * 60 * 60;

export type LinkClaims = {
  /** Appointment id (or waitlist entry id for the "waitlist" purpose). */
  appointmentId: string;
  userId: string;
  purposes: LinkPurpose[];
  /** Unix seconds. */
  exp: number;
};

export type VerifyFailure =
  | "unconfigured"
  | "malformed"
  | "signature"
  | "expired"
  | "purpose";

export type VerifyResult =
  | { ok: true; claims: LinkClaims }
  | { ok: false; reason: VerifyFailure };

export const linkSecret = (
  env: Record<string, string | undefined> = process.env
): string | null =>
  env.NOTIFICATION_LINK_SECRET?.trim() ||
  env.ADMIN_SESSION_SECRET?.trim() ||
  null;

const b64u = (buffer: Buffer) => buffer.toString("base64url");

const sign = (secret: string, payloadPart: string) =>
  createHmac("sha256", secret).update(CONTEXT + payloadPart).digest();

export const signLinkToken = (
  input: {
    appointmentId: string;
    userId: string;
    purpose: LinkPurpose | LinkPurpose[];
    exp: number;
  },
  secret: string | null = linkSecret()
): string | null => {
  if (!secret) return null;
  const purposes = Array.isArray(input.purpose) ? input.purpose : [input.purpose];
  const payload = {
    v: 1,
    a: input.appointmentId,
    u: input.userId,
    p: Array.from(new Set(purposes.map((p) => PURPOSE_CODE[p]))).join(""),
    e: Math.floor(input.exp),
  };
  const payloadPart = b64u(Buffer.from(JSON.stringify(payload), "utf8"));
  return `${payloadPart}.${b64u(sign(secret, payloadPart))}`;
};

/**
 * Verifies signature, structure and expiry. When `purpose` is given the token
 * must also grant it; omit it to inspect which purposes a token grants.
 */
export const verifyLinkToken = (
  token: unknown,
  purpose?: LinkPurpose,
  options: { now?: Date; secret?: string | null } = {}
): VerifyResult => {
  const secret = options.secret === undefined ? linkSecret() : options.secret;
  if (!secret) return { ok: false, reason: "unconfigured" };
  if (
    typeof token !== "string" ||
    token.length === 0 ||
    token.length > MAX_TOKEN_LENGTH
  ) {
    return { ok: false, reason: "malformed" };
  }
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { ok: false, reason: "malformed" };
  }
  const [payloadPart, sigPart] = parts;

  const expected = sign(secret, payloadPart);
  let provided: Buffer;
  try {
    provided = Buffer.from(sigPart, "base64url");
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return { ok: false, reason: "signature" };
  }

  // Signature is valid: the payload was produced by us. Still parse defensively.
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const p = raw as { v?: unknown; a?: unknown; u?: unknown; p?: unknown; e?: unknown };
  if (
    !p ||
    p.v !== 1 ||
    typeof p.a !== "string" ||
    typeof p.u !== "string" ||
    typeof p.p !== "string" ||
    typeof p.e !== "number" ||
    !Number.isFinite(p.e)
  ) {
    return { ok: false, reason: "malformed" };
  }
  const purposes = p.p
    .split("")
    .map((code) => CODE_PURPOSE[code])
    .filter((value): value is LinkPurpose => Boolean(value));

  const nowMs = (options.now ?? new Date()).getTime();
  if (nowMs >= p.e * 1000) return { ok: false, reason: "expired" };
  if (purpose !== undefined && !purposes.includes(purpose)) {
    return { ok: false, reason: "purpose" };
  }

  return {
    ok: true,
    claims: { appointmentId: p.a, userId: p.u, purposes, exp: p.e },
  };
};

export const linkUrl = (token: string): string | null => {
  const base = appBaseUrl();
  return base ? `${base}/a/${token}` : null;
};

/** Expiry = appointment start, capped at 30 days; null if already in the past. */
export const appointmentLinkExpiry = (
  start: Date | string,
  now: Date = new Date()
): number | null => {
  const startSec = Math.floor(new Date(start).getTime() / 1000);
  if (!Number.isFinite(startSec)) return null;
  const nowSec = Math.floor(now.getTime() / 1000);
  const exp = Math.min(startSec, nowSec + MAX_LINK_LIFETIME_SECONDS);
  return exp > nowSec ? exp : null;
};

/**
 * Confirm / cancel / reschedule link for an appointment. Null when no secret or
 * base URL is configured, or the appointment has already started (callers then
 * send the message without a link).
 */
export const createAppointmentLink = (input: {
  appointmentId: string;
  userId: string;
  start: Date | string;
  now?: Date;
}): string | null => {
  const exp = appointmentLinkExpiry(input.start, input.now);
  if (exp === null) return null;
  const token = signLinkToken({
    appointmentId: input.appointmentId,
    userId: input.userId,
    purpose: APPOINTMENT_LINK_PURPOSES,
    exp,
  });
  return token ? linkUrl(token) : null;
};

/** Waitlist claim link; `exp` is the end of the claim window. */
export const createWaitlistLink = (input: {
  entryId: string;
  userId: string;
  expiresAt: Date;
}): string | null => {
  const token = signLinkToken({
    appointmentId: input.entryId,
    userId: input.userId,
    purpose: "waitlist",
    exp: Math.floor(input.expiresAt.getTime() / 1000),
  });
  return token ? linkUrl(token) : null;
};

/** Where "reschedule" sends the patient: the portal dashboard, which lists appointments (one place to change). */
export const portalReschedulePath = (userId: string, appointmentId: string) =>
  `/patients/${encodeURIComponent(userId)}?reschedule=${encodeURIComponent(appointmentId)}`;

/** Where an accepted waitlist offer sends the patient to book the slot. */
export const portalBookPath = (userId: string, doctorId: string, slotStart: string) =>
  `/patients/${encodeURIComponent(userId)}/new-appointment?doctor=${encodeURIComponent(doctorId)}&slotStart=${encodeURIComponent(slotStart)}`;
