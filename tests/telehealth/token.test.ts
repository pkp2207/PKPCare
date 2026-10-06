import { afterEach, describe, expect, it, vi } from "vitest";

import {
  signToken,
  signVisitToken,
  verifyToken,
  verifyVisitToken,
} from "@/lib/telehealth/token";
import {
  computeVisitWindow,
  VISIT_TOKEN_GRACE_MINUTES,
  visitTokenExpiry,
} from "@/lib/telehealth/window";

afterEach(() => vi.unstubAllEnvs());

const SECRET = "test-secret";
const NOW = Date.parse("2026-10-08T10:00:00.000Z");
const HOUR = 3_600_000;

const mint = (expiresAt = NOW + HOUR, role: "patient" | "doctor" = "patient") =>
  signVisitToken({ appointmentId: "appt1", role }, expiresAt, SECRET);

describe("visit tokens", () => {
  it("round-trips the claims", () => {
    const result = verifyVisitToken(mint(NOW + HOUR, "doctor"), NOW, SECRET);
    expect(result).toEqual({
      ok: true,
      claims: { appointmentId: "appt1", role: "doctor" },
      expiresAt: NOW + HOUR,
    });
  });

  it("expires", () => {
    const token = mint(NOW + HOUR);
    expect(verifyVisitToken(token, NOW + HOUR - 1000, SECRET).ok).toBe(true);
    expect(verifyVisitToken(token, NOW + HOUR + 1000, SECRET)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("rejects a tampered payload or signature", () => {
    const [payload, sig] = mint().split(".");
    const forged = Buffer.from(
      JSON.stringify({ a: "other", r: "patient", p: "visit", exp: Math.floor((NOW + HOUR) / 1000) }),
    ).toString("base64url");
    expect(verifyVisitToken(`${forged}.${sig}`, NOW, SECRET)).toEqual({
      ok: false,
      reason: "signature",
    });
    expect(verifyVisitToken(`${payload}.${sig.slice(0, -2)}AA`, NOW, SECRET).ok).toBe(false);
  });

  it("rejects a different secret", () => {
    expect(verifyVisitToken(mint(), NOW, "another-secret")).toEqual({
      ok: false,
      reason: "signature",
    });
  });

  it("rejects a token minted for another purpose", () => {
    const other = signToken("password-reset", { a: "appt1", r: "patient" }, NOW + HOUR, SECRET);
    expect(verifyVisitToken(other, NOW, SECRET).ok).toBe(false);
    expect(verifyToken(other, "password-reset", NOW, SECRET).ok).toBe(true);
  });

  it("rejects a purpose claim that does not match even with a valid signature", () => {
    // Same HMAC context (purpose "visit") but the payload claims another purpose.
    const token = signToken("visit", { a: "appt1", r: "patient" }, NOW + HOUR, SECRET);
    const [, sig] = token.split(".");
    const payload = Buffer.from(
      JSON.stringify({ a: "appt1", r: "patient", p: "x", exp: Math.floor((NOW + HOUR) / 1000) }),
    ).toString("base64url");
    expect(verifyVisitToken(`${payload}.${sig}`, NOW, SECRET).ok).toBe(false);
  });

  it("rejects an unknown role, garbage and oversized input", () => {
    const badRole = signToken("visit", { a: "appt1", r: "admin" }, NOW + HOUR, SECRET);
    expect(verifyVisitToken(badRole, NOW, SECRET)).toEqual({ ok: false, reason: "malformed" });
    for (const junk of ["", "abc", "a.b.c", ".", "a.", ".b", "x".repeat(2000)]) {
      expect(verifyVisitToken(junk, NOW, SECRET).ok).toBe(false);
    }
  });

  it("fails closed (no throw) when no secret is configured", () => {
    vi.stubEnv("TELEHEALTH_ROOM_SECRET", "");
    vi.stubEnv("ADMIN_SESSION_SECRET", "");
    expect(verifyVisitToken(mint(), NOW).ok).toBe(false);
  });
});

describe("visit window", () => {
  const start = new Date("2026-10-08T10:00:00.000Z");
  const end = new Date("2026-10-08T10:30:00.000Z");
  const at = (iso: string) => computeVisitWindow(start, end, new Date(iso));

  it("opens 10 minutes before the start and closes 30 after the end", () => {
    expect(at("2026-10-08T09:49:59.000Z").state).toBe("early");
    expect(at("2026-10-08T09:50:00.000Z").state).toBe("open");
    expect(at("2026-10-08T10:15:00.000Z").state).toBe("open");
    expect(at("2026-10-08T11:00:00.000Z").state).toBe("open");
    expect(at("2026-10-08T11:00:01.000Z").state).toBe("late");
  });

  it("reports the boundaries", () => {
    const w = at("2026-10-08T09:00:00.000Z");
    expect(w.opensAt.toISOString()).toBe("2026-10-08T09:50:00.000Z");
    expect(w.closesAt.toISOString()).toBe("2026-10-08T11:00:00.000Z");
  });

  it("token expiry is the end plus the grace, after the window closes", () => {
    expect(visitTokenExpiry(end)).toBe(end.getTime() + VISIT_TOKEN_GRACE_MINUTES * 60_000);
    expect(visitTokenExpiry(end)).toBeGreaterThan(at("2026-10-08T09:00:00.000Z").closesAt.getTime());
  });
});
