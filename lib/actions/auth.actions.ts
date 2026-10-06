"use server";

import { cookies, headers } from "next/headers";

import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  createSessionToken,
  safeEqual,
} from "@/lib/auth/session";

const GENERIC_ERROR = "Invalid passkey. Please try again.";
const LOCKED_ERROR = "Too many attempts. Please try again later.";
const UNAVAILABLE_ERROR = "Admin access is unavailable.";

const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes
const MAX_PASSKEY_LENGTH = 128;

// NOTE: in-memory and therefore per server instance. Counters reset on restart and
// are not shared across replicas/serverless invocations. Move to a shared store
// (Redis, database) for multi-instance deployments.
const attempts = new Map<string, { failures: number; lockedUntil: number }>();

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

export async function verifyAdminPasskey(
  passkey: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const expectedPasskey = process.env.ADMIN_PASSKEY;
  const sessionSecret = process.env.ADMIN_SESSION_SECRET;

  // Fail closed; never tell the client which piece of config is missing.
  if (!expectedPasskey || !sessionSecret) {
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

  const token = await createSessionToken(sessionSecret, SESSION_TTL_SECONDS);
  cookies().set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });

  return { ok: true };
}

export async function logoutAdmin(): Promise<void> {
  cookies().delete(SESSION_COOKIE);
}
