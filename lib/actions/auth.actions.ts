"use server";

import { cookies, headers } from "next/headers";
import { AuthenticationFactor, Query } from "node-appwrite";
import { z } from "zod";

import { getClients } from "@/lib/appwrite/client";
import { getPublicAccount } from "@/lib/auth/appwrite";
import { isLegacyPasskeyAllowed } from "@/lib/auth/config";
import { createRateLimiter } from "@/lib/auth/rate-limit";
import { roleFromLabels } from "@/lib/auth/roles";
import {
  MFA_PENDING_COOKIE,
  MFA_PENDING_TTL_SECONDS,
  PATIENT_SESSION_COOKIE,
  PATIENT_SESSION_TTL_SECONDS,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  STAFF_SESSION_TTL_SECONDS,
  createSessionToken,
  safeEqual,
} from "@/lib/auth/session";

type AuthResult<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string };

const GENERIC_ERROR = "Invalid passkey. Please try again.";
const LOCKED_ERROR = "Too many attempts. Please try again later.";
const UNAVAILABLE_ERROR = "Admin access is unavailable.";
const PASSKEY_DISABLED_ERROR =
  "Shared passkey sign-in is disabled. Please use staff sign-in.";

const INVALID_EMAIL_ERROR = "Enter a valid email address.";
const INVALID_OTP_ERROR = "Invalid or expired code. Please try again.";
const INVALID_LOGIN_ERROR = "Invalid email or password.";
const INVALID_MFA_ERROR = "Invalid code. Please try again.";
const MFA_EXPIRED_ERROR = "Your sign-in expired. Please sign in again.";
const AUTH_UNAVAILABLE_ERROR = "Sign-in is currently unavailable.";

const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes
const MAX_PASSKEY_LENGTH = 128;
const MAX_PASSWORD_LENGTH = 256;

// NOTE: in-memory and therefore per server instance. Counters reset on restart and
// are not shared across replicas/serverless invocations. Move to a shared store
// (Redis, database) for multi-instance deployments.
const attempts = new Map<string, { failures: number; lockedUntil: number }>();

// Per-IP and per-email limiters (see lib/auth/rate-limit.ts for the same caveat).
// Per-email limits are applied whether or not the account exists, so they never
// reveal existence. Trade-off: someone can lock a known email out for 15 minutes.
const otpRequestByIp = createRateLimiter({ max: 10, windowMs: LOCKOUT_MS });
const otpRequestByEmail = createRateLimiter({ max: 3, windowMs: LOCKOUT_MS });
const otpVerifyByIp = createRateLimiter({ max: 10, windowMs: LOCKOUT_MS });
const otpVerifyByEmail = createRateLimiter({ max: MAX_FAILURES, windowMs: LOCKOUT_MS });
const staffLoginByIp = createRateLimiter({ max: 10, windowMs: LOCKOUT_MS });
const staffLoginByEmail = createRateLimiter({ max: MAX_FAILURES, windowMs: LOCKOUT_MS });
const staffMfaByIp = createRateLimiter({ max: 10, windowMs: LOCKOUT_MS });
const staffMfaByToken = createRateLimiter({ max: MAX_FAILURES, windowMs: LOCKOUT_MS });

const EmailSchema = z.string().trim().toLowerCase().email().max(254);
const OtpSchema = z.string().trim().regex(/^\d{6}$/);

function getClientIp(): string {
  const h = headers();
  const forwarded = h.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim();
  return ip || "unknown";
}

function pruneAttempts(now: number) {
  // Bound memory: drop expired lockouts, and reset entirely if the map balloons.
  if (attempts.size < 1000) return;
  attempts.forEach((entry, key) => {
    if (entry.lockedUntil !== 0 && entry.lockedUntil <= now) {
      attempts.delete(key);
    }
  });
  if (attempts.size > 10000) attempts.clear();
}

function sessionSecret(): string | null {
  return process.env.ADMIN_SESSION_SECRET || null;
}

// Staff cookie: SameSite=Strict. Staff always arrive via the app's own pages, so
// nothing is lost and it is the strongest CSRF posture.
function setStaffCookie(token: string) {
  cookies().set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: STAFF_SESSION_TTL_SECONDS,
  });
}

// Patient cookie: SameSite=Lax (deliberate). Patients follow links from
// confirmation emails/SMS into /patients/...; with Strict the browser omits the
// cookie on that cross-site top-level navigation and the patient would be bounced
// to login. Lax still withholds the cookie from cross-site POSTs (server actions
// are POST), and no GET route mutates state.
function setPatientCookie(token: string) {
  cookies().set(PATIENT_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: PATIENT_SESSION_TTL_SECONDS,
  });
}

async function findUserByEmail(email: string) {
  const { users } = getClients();
  const result = await users.list([Query.equal("email", [email]), Query.limit(1)]);
  return result.users[0] ?? null;
}

// ---------------------------------------------------------------------------
// Legacy shared admin passkey (gated by ALLOW_LEGACY_ADMIN_PASSKEY)
// ---------------------------------------------------------------------------

export async function verifyAdminPasskey(
  passkey: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isLegacyPasskeyAllowed()) {
    return { ok: false, error: PASSKEY_DISABLED_ERROR };
  }

  const expectedPasskey = process.env.ADMIN_PASSKEY;
  const secret = sessionSecret();

  // Fail closed; never tell the client which piece of config is missing.
  if (!expectedPasskey || !secret) {
    console.error("Admin auth is not configured (ADMIN_PASSKEY / ADMIN_SESSION_SECRET).");
    return { ok: false, error: UNAVAILABLE_ERROR };
  }

  const now = Date.now();
  pruneAttempts(now);

  const ip = getClientIp();
  const entry = attempts.get(ip) ?? { failures: 0, lockedUntil: 0 };

  if (entry.lockedUntil > now) {
    return { ok: false, error: LOCKED_ERROR };
  }
  if (entry.lockedUntil !== 0) {
    // Lockout expired: start fresh.
    entry.failures = 0;
    entry.lockedUntil = 0;
  }

  const candidate =
    typeof passkey === "string" && passkey.length <= MAX_PASSKEY_LENGTH
      ? passkey
      : "";
  const valid = candidate !== "" && safeEqual(candidate, expectedPasskey);

  if (!valid) {
    entry.failures += 1;
    if (entry.failures >= MAX_FAILURES) {
      entry.lockedUntil = now + LOCKOUT_MS;
    }
    attempts.set(ip, entry);
    return {
      ok: false,
      error: entry.lockedUntil > now ? LOCKED_ERROR : GENERIC_ERROR,
    };
  }

  attempts.delete(ip);

  // Legacy token: `{ exp }` only; resolved as role "admin" by readStaffToken.
  const token = await createSessionToken(secret, SESSION_TTL_SECONDS);
  setStaffCookie(token);

  return { ok: true };
}

export async function logoutAdmin(): Promise<void> {
  cookies().delete(SESSION_COOKIE);
  cookies().delete(MFA_PENDING_COOKIE);
}

export async function logoutStaff(): Promise<void> {
  await logoutAdmin();
}

// ---------------------------------------------------------------------------
// Patient email OTP
// ---------------------------------------------------------------------------

// Always answers `{ ok: true }` for a well-formed email, whether or not the account
// exists (no enumeration). Does NOT create accounts: unknown emails are ignored.
export async function requestPatientOtp(email: string): Promise<AuthResult> {
  const parsed = EmailSchema.safeParse(email);
  if (!parsed.success) return { ok: false, error: INVALID_EMAIL_ERROR };
  const address = parsed.data;

  if (!sessionSecret()) {
    console.error("Patient auth is not configured (ADMIN_SESSION_SECRET).");
    return { ok: false, error: AUTH_UNAVAILABLE_ERROR };
  }

  const ipKey = getClientIp();
  if (otpRequestByIp.isLimited(ipKey) || otpRequestByEmail.isLimited(address)) {
    return { ok: false, error: LOCKED_ERROR };
  }
  otpRequestByIp.hit(ipKey);
  otpRequestByEmail.hit(address);

  try {
    const user = await findUserByEmail(address);
    if (user && user.status) {
      await getPublicAccount().createEmailToken(user.$id, address);
    }
  } catch (error) {
    // Swallow: the response must not depend on whether the account exists.
    console.error("requestPatientOtp failed", error);
  }

  return { ok: true };
}

export async function verifyPatientOtp(
  email: string,
  code: string
): Promise<AuthResult<{ userId: string }>> {
  const parsedEmail = EmailSchema.safeParse(email);
  const parsedCode = OtpSchema.safeParse(code);
  if (!parsedEmail.success || !parsedCode.success) {
    return { ok: false, error: INVALID_OTP_ERROR };
  }
  const address = parsedEmail.data;

  const secret = sessionSecret();
  if (!secret) {
    console.error("Patient auth is not configured (ADMIN_SESSION_SECRET).");
    return { ok: false, error: AUTH_UNAVAILABLE_ERROR };
  }

  const ipKey = getClientIp();
  if (otpVerifyByIp.isLimited(ipKey) || otpVerifyByEmail.isLimited(address)) {
    return { ok: false, error: LOCKED_ERROR };
  }

  const fail = (): AuthResult<{ userId: string }> => {
    otpVerifyByIp.hit(ipKey);
    const locked = otpVerifyByEmail.hit(address);
    return { ok: false, error: locked ? LOCKED_ERROR : INVALID_OTP_ERROR };
  };

  try {
    const user = await findUserByEmail(address);
    if (!user || !user.status) return fail();

    let appwriteSession;
    try {
      appwriteSession = await getPublicAccount().createSession(
        user.$id,
        parsedCode.data
      );
    } catch {
      return fail();
    }

    // We issue our own cookie; drop the Appwrite session so none linger.
    await getClients()
      .users.deleteSession(user.$id, appwriteSession.$id)
      .catch(() => undefined);

    otpVerifyByEmail.reset(address);

    const token = await createSessionToken(secret, PATIENT_SESSION_TTL_SECONDS, {
      kind: "patient",
      sub: user.$id,
    });
    setPatientCookie(token);

    return { ok: true, data: { userId: user.$id } };
  } catch (error) {
    console.error("verifyPatientOtp failed", error);
    return fail();
  }
}

export async function logoutPatient(): Promise<void> {
  cookies().delete(PATIENT_SESSION_COOKIE);
}

// ---------------------------------------------------------------------------
// Staff email + password (optional TOTP MFA)
// ---------------------------------------------------------------------------

async function issueStaffSession(user: {
  $id: string;
  email: string;
  name: string;
  labels: string[];
  status: boolean;
}): Promise<boolean> {
  const secret = sessionSecret();
  const role = roleFromLabels(user.labels);
  if (!secret || !role || !user.status) return false;

  const token = await createSessionToken(secret, STAFF_SESSION_TTL_SECONDS, {
    kind: "staff",
    sub: user.$id,
    role,
    email: user.email || null,
    name: user.name || null,
  });
  setStaffCookie(token);
  return true;
}

// Step 1. `data.mfaRequired` true => call verifyStaffMfa(code) next; no staff
// cookie has been set yet.
export async function verifyStaffLogin(
  email: string,
  password: string
): Promise<AuthResult<{ mfaRequired: boolean }>> {
  const parsedEmail = EmailSchema.safeParse(email);
  if (
    !parsedEmail.success ||
    typeof password !== "string" ||
    password.length === 0 ||
    password.length > MAX_PASSWORD_LENGTH
  ) {
    return { ok: false, error: INVALID_LOGIN_ERROR };
  }
  const address = parsedEmail.data;

  if (!sessionSecret()) {
    console.error("Staff auth is not configured (ADMIN_SESSION_SECRET).");
    return { ok: false, error: AUTH_UNAVAILABLE_ERROR };
  }

  const ipKey = getClientIp();
  if (staffLoginByIp.isLimited(ipKey) || staffLoginByEmail.isLimited(address)) {
    return { ok: false, error: LOCKED_ERROR };
  }

  const fail = (): AuthResult<{ mfaRequired: boolean }> => {
    staffLoginByIp.hit(ipKey);
    const locked = staffLoginByEmail.hit(address);
    return { ok: false, error: locked ? LOCKED_ERROR : INVALID_LOGIN_ERROR };
  };

  try {
    const { users } = getClients();

    let appwriteSession;
    try {
      appwriteSession = await getPublicAccount().createEmailPasswordSession(
        address,
        password
      );
    } catch {
      return fail();
    }

    const dropAppwriteSession = () =>
      users
        .deleteSession(appwriteSession.userId, appwriteSession.$id)
        .catch(() => undefined);

    const user = await users.get(appwriteSession.userId);

    // Must be an enabled user carrying a role label; patients can't sign in here.
    if (!user.status || !roleFromLabels(user.labels)) {
      await dropAppwriteSession();
      return fail();
    }

    if (user.mfa) {
      // Hold the (not yet MFA-verified) Appwrite session secret in a short-lived
      // HttpOnly cookie for step 2. Not a staff session: grants nothing by itself.
      cookies().set(MFA_PENDING_COOKIE, appwriteSession.secret, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/",
        maxAge: MFA_PENDING_TTL_SECONDS,
      });
      return { ok: true, data: { mfaRequired: true } };
    }

    await dropAppwriteSession();
    staffLoginByEmail.reset(address);
    if (!(await issueStaffSession(user))) return fail();
    return { ok: true, data: { mfaRequired: false } };
  } catch (error) {
    console.error("verifyStaffLogin failed", error);
    return fail();
  }
}

// Step 2 (only when verifyStaffLogin returned mfaRequired): TOTP code from the
// staff member's authenticator app.
export async function verifyStaffMfa(code: string): Promise<AuthResult> {
  const parsedCode = OtpSchema.safeParse(code);
  const pending = cookies().get(MFA_PENDING_COOKIE)?.value;
  if (!pending) return { ok: false, error: MFA_EXPIRED_ERROR };
  if (!parsedCode.success) return { ok: false, error: INVALID_MFA_ERROR };

  if (!sessionSecret()) {
    console.error("Staff auth is not configured (ADMIN_SESSION_SECRET).");
    return { ok: false, error: AUTH_UNAVAILABLE_ERROR };
  }

  const ipKey = getClientIp();
  const pendingKey = pending.slice(0, 32);
  const account = getPublicAccount(pending);

  const abandon = async () => {
    await account.deleteSession("current").catch(() => undefined);
    cookies().delete(MFA_PENDING_COOKIE);
  };

  if (staffMfaByIp.isLimited(ipKey)) return { ok: false, error: LOCKED_ERROR };
  if (staffMfaByToken.isLimited(pendingKey)) {
    await abandon();
    return { ok: false, error: LOCKED_ERROR };
  }

  try {
    const challenge = await account.createMfaChallenge(AuthenticationFactor.Totp);
    await account.updateMfaChallenge(challenge.$id, parsedCode.data);
  } catch {
    staffMfaByIp.hit(ipKey);
    if (staffMfaByToken.hit(pendingKey)) {
      await abandon();
      return { ok: false, error: LOCKED_ERROR };
    }
    return { ok: false, error: INVALID_MFA_ERROR };
  }

  try {
    const me = await account.get();
    const user = await getClients().users.get(me.$id);
    await abandon(); // deletes the Appwrite session + pending cookie
    if (!(await issueStaffSession(user))) {
      return { ok: false, error: INVALID_MFA_ERROR };
    }
    staffMfaByToken.reset(pendingKey);
    return { ok: true };
  } catch (error) {
    console.error("verifyStaffMfa failed", error);
    return { ok: false, error: INVALID_MFA_ERROR };
  }
}
