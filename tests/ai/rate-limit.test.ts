import { beforeEach, describe, expect, it } from "vitest";

import { buildAiAuditMeta } from "@/lib/ai/audit";
import { AI_RATE_LIMITS, resetAiRateLimits, takeAiRateLimit } from "@/lib/ai/rate-limit";
import { AUDIT_META_ALLOWED_KEYS, sanitizeAuditMeta } from "@/lib/compliance/audit";

beforeEach(() => resetAiRateLimits());

describe("takeAiRateLimit", () => {
  it("limits per user", () => {
    const max = AI_RATE_LIMITS.id_extract.perUser;
    for (let i = 0; i < max; i += 1) {
      expect(takeAiRateLimit("id_extract", { userId: "u1", ip: `10.0.0.${i}` })).toBe(true);
    }
    expect(takeAiRateLimit("id_extract", { userId: "u1", ip: "10.9.9.9" })).toBe(false);
    expect(takeAiRateLimit("id_extract", { userId: "u2", ip: "10.8.8.8" })).toBe(true);
  });

  it("limits anonymous callers per IP and keeps features separate", () => {
    const max = AI_RATE_LIMITS.id_extract.perIp;
    for (let i = 0; i < max; i += 1) {
      expect(takeAiRateLimit("id_extract", { userId: null, ip: "1.2.3.4" })).toBe(true);
    }
    expect(takeAiRateLimit("id_extract", { userId: null, ip: "1.2.3.4" })).toBe(false);
    expect(takeAiRateLimit("triage", { userId: null, ip: "1.2.3.4" })).toBe(true);
  });

  it("shares one conservative bucket when the IP is unknown", () => {
    const max = AI_RATE_LIMITS.id_extract.perIp;
    for (let i = 0; i < max; i += 1) takeAiRateLimit("id_extract", { userId: null, ip: null });
    expect(takeAiRateLimit("id_extract", { userId: null, ip: null })).toBe(false);
  });
});

describe("audit meta", () => {
  it("uses only allow-listed keys and contains no PHI-like content", () => {
    const meta = buildAiAuditMeta({
      outcome: "ok",
      model: "claude-opus-5-5",
      latencyMs: 812.4,
      usage: { inputTokens: 100, outputTokens: 20 },
    });
    Object.keys(meta).forEach((k) => expect(AUDIT_META_ALLOWED_KEYS.has(k)).toBe(true));
    expect(meta).toEqual({ outcome: "ok", model: "claude-opus-5-5", durationMs: 812, inputTokens: 100, outputTokens: 20 });
    expect(sanitizeAuditMeta(meta)).not.toHaveProperty("_dropped");
  });
});
