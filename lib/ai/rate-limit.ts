// Per-user + per-IP rate limiting for AI calls.
//
// NOTE: in-memory and therefore per server instance (same caveat as
// lib/auth/rate-limit.ts). Counters reset on restart and are not shared across
// replicas or serverless invocations, so this bounds abuse and cost per instance
// only. Move to a shared store (Redis, database) for multi-instance deployments.
// The IP comes from x-forwarded-for / x-real-ip and is only trustworthy behind a
// proxy you control; a spoofed header can dodge the per-IP limit (the per-user
// limit still applies to signed-in callers).
import { createRateLimiter, type RateLimiter } from "@/lib/auth/rate-limit";

import type { AiFeature } from "./client";

const WINDOW_MS = 10 * 60 * 1000;

// Hits allowed per window. Anonymous callers are only limited by IP, so the IP
// ceilings are a little higher than the per-user ones to allow shared networks.
export const AI_RATE_LIMITS: Record<AiFeature, { perUser: number; perIp: number }> = {
  triage: { perUser: 20, perIp: 40 },
  id_extract: { perUser: 5, perIp: 10 },
  visit_summary: { perUser: 30, perIp: 60 },
};

const limiters = new Map<string, RateLimiter>();

const limiter = (name: string, max: number): RateLimiter => {
  let found = limiters.get(name);
  if (!found) {
    found = createRateLimiter({ max, windowMs: WINDOW_MS, maxKeys: 5000 });
    limiters.set(name, found);
  }
  return found;
};

/** Test helper. */
export const resetAiRateLimits = (): void => {
  limiters.clear();
};

export type AiCaller = { userId: string | null; ip: string | null };

/**
 * Consumes one request from the caller's budget. Returns false (and consumes
 * nothing further) when either the user or the IP is over the limit.
 */
export const takeAiRateLimit = (feature: AiFeature, caller: AiCaller): boolean => {
  const limits = AI_RATE_LIMITS[feature];
  const checks: { limiter: RateLimiter; key: string }[] = [];

  if (caller.userId) {
    checks.push({ limiter: limiter(`${feature}:user`, limits.perUser), key: caller.userId });
  }
  // No IP and no user: everything shares one conservative bucket.
  checks.push({
    limiter: limiter(`${feature}:ip`, limits.perIp),
    key: caller.ip ?? "unknown",
  });

  if (checks.some((c) => c.limiter.isLimited(c.key))) return false;
  checks.forEach((c) => c.limiter.hit(c.key));
  return true;
};
