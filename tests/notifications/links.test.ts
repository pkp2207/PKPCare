import { afterEach, describe, expect, it, vi } from "vitest";

import {
  appointmentLinkExpiry,
  createAppointmentLink,
  signLinkToken,
  verifyLinkToken,
} from "@/lib/notifications/links";
import { createStaffSessionToken } from "./helpers";

const SECRET = "test-secret-123456";
const NOW = new Date("2026-10-07T08:00:00.000Z");
const exp = Math.floor(NOW.getTime() / 1000) + 3600;

const sign = (purpose: Parameters<typeof signLinkToken>[0]["purpose"] = "confirm", e = exp) =>
  signLinkToken({ appointmentId: "appt1", userId: "u1", purpose, exp: e }, SECRET) as string;

afterEach(() => vi.unstubAllEnvs());

describe("link tokens", () => {
  it("round-trips claims", () => {
    const result = verifyLinkToken(sign(["confirm", "cancel"]), "cancel", { now: NOW, secret: SECRET });
    expect(result).toMatchObject({
      ok: true,
      claims: { appointmentId: "appt1", userId: "u1", purposes: ["confirm", "cancel"], exp },
    });
  });

  it("rejects a tampered payload or signature", () => {
    const token = sign();
    const [payload, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ v: 1, a: "appt2", u: "u1", p: "c", e: exp })).toString("base64url");
    expect(verifyLinkToken(`${forged}.${sig}`, "confirm", { now: NOW, secret: SECRET })).toEqual({ ok: false, reason: "signature" });
    expect(verifyLinkToken(`${payload}.${sig.slice(0, -2)}AA`, "confirm", { now: NOW, secret: SECRET })).toMatchObject({ ok: false });
  });

  it("rejects wrong secret, garbage and missing secret", () => {
    expect(verifyLinkToken(sign(), "confirm", { now: NOW, secret: "other-secret" })).toEqual({ ok: false, reason: "signature" });
    for (const bad of ["", "abc", "a.b.c", ".", 42, null, undefined, "x".repeat(600)]) {
      expect(verifyLinkToken(bad, "confirm", { now: NOW, secret: SECRET }).ok).toBe(false);
    }
    expect(verifyLinkToken(sign(), "confirm", { now: NOW, secret: null })).toEqual({ ok: false, reason: "unconfigured" });
  });

  it("expires at exp", () => {
    const token = sign();
    const at = (ms: number) => verifyLinkToken(token, "confirm", { now: new Date(ms), secret: SECRET });
    expect(at(exp * 1000 - 1).ok).toBe(true);
    expect(at(exp * 1000)).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a purpose the token does not grant", () => {
    expect(verifyLinkToken(sign("confirm"), "cancel", { now: NOW, secret: SECRET })).toEqual({ ok: false, reason: "purpose" });
    expect(verifyLinkToken(sign("waitlist"), "reschedule", { now: NOW, secret: SECRET })).toEqual({ ok: false, reason: "purpose" });
  });

  it("is not interchangeable with session tokens (same secret)", () => {
    const session = createStaffSessionToken(SECRET);
    expect(verifyLinkToken(session, "confirm", { now: NOW, secret: SECRET }).ok).toBe(false);
    // and a link token's signature is not a plain HMAC of its payload
    const [payload] = sign().split(".");
    expect(sign().split(".")[1]).not.toBe(createStaffSessionToken(SECRET, payload).split(".")[1]);
  });

  it("falls back to ADMIN_SESSION_SECRET only when NOTIFICATION_LINK_SECRET is unset", () => {
    vi.stubEnv("NOTIFICATION_LINK_SECRET", "");
    vi.stubEnv("ADMIN_SESSION_SECRET", "session-secret");
    const a = signLinkToken({ appointmentId: "a", userId: "u", purpose: "confirm", exp });
    vi.stubEnv("NOTIFICATION_LINK_SECRET", "dedicated");
    expect(verifyLinkToken(a, "confirm", { now: NOW }).ok).toBe(false);
    vi.stubEnv("NOTIFICATION_LINK_SECRET", "");
    expect(verifyLinkToken(a, "confirm", { now: NOW }).ok).toBe(true);
  });

  it("expiry helper caps at 30 days and refuses past appointments", () => {
    expect(appointmentLinkExpiry(new Date(NOW.getTime() - 1000), NOW)).toBeNull();
    const far = new Date(NOW.getTime() + 90 * 86400_000);
    expect(appointmentLinkExpiry(far, NOW)).toBe(Math.floor(NOW.getTime() / 1000) + 30 * 86400);
  });

  it("createAppointmentLink needs base URL + secret", () => {
    const start = new Date(NOW.getTime() + 86400_000);
    vi.stubEnv("APP_BASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    vi.stubEnv("VERCEL_URL", "");
    vi.stubEnv("NOTIFICATION_LINK_SECRET", SECRET);
    expect(createAppointmentLink({ appointmentId: "a", userId: "u", start, now: NOW })).toBeNull();
    vi.stubEnv("APP_BASE_URL", "https://care.example.com/");
    expect(createAppointmentLink({ appointmentId: "a", userId: "u", start, now: NOW })).toMatch(
      /^https:\/\/care\.example\.com\/a\/[\w-]+\.[\w-]+$/
    );
  });
});
