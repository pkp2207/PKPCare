import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { middleware } from "@/middleware";
import {
  PATIENT_SESSION_COOKIE,
  SESSION_COOKIE,
  createSessionToken,
} from "@/lib/auth/session";

const SECRET = "test-secret-".padEnd(48, "x");

function req(path: string, cookies: Record<string, string> = {}) {
  const cookie = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: cookie ? { cookie } : {},
  });
}

const location = (res: Response) => {
  const value = res.headers.get("location");
  return value ? new URL(value).pathname + new URL(value).search : null;
};
const passes = (res: Response) => res.headers.get("x-middleware-next") === "1";

beforeEach(() => {
  vi.stubEnv("ADMIN_SESSION_SECRET", SECRET);
  vi.stubEnv("PATIENT_AUTH_ENFORCED", "");
  vi.stubEnv("ALLOW_LEGACY_ADMIN_PASSKEY", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("middleware /admin", () => {
  it("redirects anonymous requests to staff login with next", async () => {
    const res = await middleware(req("/admin/appointments?x=1"));
    expect(location(res)).toBe("/login/staff?next=%2Fadmin%2Fappointments%3Fx%3D1");
  });

  it("admits staff and legacy sessions, rejects legacy once disabled", async () => {
    const staff = await createSessionToken(SECRET, 60, { kind: "staff", sub: "s", role: "doctor" });
    const legacy = await createSessionToken(SECRET, 60);
    expect(passes(await middleware(req("/admin", { [SESSION_COOKIE]: staff })))).toBe(true);
    expect(passes(await middleware(req("/admin", { [SESSION_COOKIE]: legacy })))).toBe(true);
    vi.stubEnv("ALLOW_LEGACY_ADMIN_PASSKEY", "false");
    expect(location(await middleware(req("/admin", { [SESSION_COOKIE]: legacy })))).toContain(
      "/login/staff"
    );
  });

  it("enforces per-path roles", async () => {
    const doctor = await createSessionToken(SECRET, 60, { kind: "staff", sub: "s", role: "doctor" });
    const res = await middleware(req("/admin/staff", { [SESSION_COOKIE]: doctor }));
    expect(location(res)).toBe("/login/staff?reason=forbidden");
  });

  it("rejects patient tokens in the staff cookie", async () => {
    const patient = await createSessionToken(SECRET, 60, { kind: "patient", sub: "p" });
    const res = await middleware(req("/admin", { [SESSION_COOKIE]: patient }));
    expect(location(res)).toContain("/login/staff");
  });
});

describe("middleware /patients", () => {
  it("does not block while PATIENT_AUTH_ENFORCED is off", async () => {
    expect(passes(await middleware(req("/patients/u1/register")))).toBe(true);
  });

  describe("enforced", () => {
    beforeEach(() => vi.stubEnv("PATIENT_AUTH_ENFORCED", "true"));

    it("redirects anonymous requests to /login?next=", async () => {
      const res = await middleware(req("/patients/u1/register"));
      expect(location(res)).toBe("/login?next=%2Fpatients%2Fu1%2Fregister");
    });

    it("admits the matching patient", async () => {
      const token = await createSessionToken(SECRET, 60, { kind: "patient", sub: "u1" });
      const res = await middleware(req("/patients/u1/register", { [PATIENT_SESSION_COOKIE]: token }));
      expect(passes(res)).toBe(true);
    });

    it("redirects to the session's own user on mismatch", async () => {
      const token = await createSessionToken(SECRET, 60, { kind: "patient", sub: "u1" });
      const res = await middleware(
        req("/patients/u2/new-appointment", { [PATIENT_SESSION_COOKIE]: token })
      );
      expect(location(res)).toBe("/patients/u1/new-appointment");
    });

    it("admits staff for any patient", async () => {
      const staff = await createSessionToken(SECRET, 60, { kind: "staff", sub: "s", role: "frontdesk" });
      expect(passes(await middleware(req("/patients/u9/register", { [SESSION_COOKIE]: staff })))).toBe(true);
    });
  });
});
