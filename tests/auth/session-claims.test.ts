import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PATIENT_SESSION_COOKIE,
  PATIENT_SESSION_TTL_SECONDS,
  SESSION_COOKIE,
  STAFF_SESSION_TTL_SECONDS,
  createSessionToken,
  readPatientToken,
  readSessionToken,
  readStaffToken,
  verifySessionToken,
} from "@/lib/auth/session";

const SECRET = "test-secret-".padEnd(48, "x");

function b64url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

// Token with an arbitrary payload, correctly signed (simulates a buggy issuer).
async function signedToken(payload: object, secret = SECRET) {
  const { createHmac } = await import("node:crypto");
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

describe("session claims", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses separate cookies and the specified TTLs", () => {
    expect(SESSION_COOKIE).toBe("admin_session");
    expect(PATIENT_SESSION_COOKIE).toBe("patient_session");
    expect(STAFF_SESSION_TTL_SECONDS).toBe(8 * 3600);
    expect(PATIENT_SESSION_TTL_SECONDS).toBe(24 * 3600);
  });

  it("round trips a staff token with role and identity", async () => {
    const token = await createSessionToken(SECRET, STAFF_SESSION_TTL_SECONDS, {
      kind: "staff",
      sub: "user1",
      role: "frontdesk",
      email: "f@x.co",
      name: "Fran",
    });
    const session = await readSessionToken(token, SECRET);
    expect(session).toMatchObject({
      kind: "staff",
      sub: "user1",
      role: "frontdesk",
      email: "f@x.co",
      name: "Fran",
      legacy: false,
    });
    expect(await verifySessionToken(token, SECRET)).toBe(true);
  });

  it("round trips a patient token", async () => {
    const token = await createSessionToken(SECRET, PATIENT_SESSION_TTL_SECONDS, {
      kind: "patient",
      sub: "pat9",
    });
    expect(await readSessionToken(token, SECRET)).toMatchObject({
      kind: "patient",
      sub: "pat9",
      legacy: false,
    });
  });

  it("resolves legacy { exp } tokens as admin, flagged legacy", async () => {
    const token = await createSessionToken(SECRET);
    expect(await readSessionToken(token, SECRET)).toMatchObject({
      kind: "staff",
      role: "admin",
      legacy: true,
    });
    expect(await readStaffToken(token, SECRET, true)).not.toBeNull();
    expect(await readStaffToken(token, SECRET, false)).toBeNull();
  });

  it("never accepts a legacy token as a patient session", async () => {
    const token = await createSessionToken(SECRET);
    expect(await readPatientToken(token, SECRET)).toBeNull();
  });

  it("never accepts a patient token as a staff session (and vice versa)", async () => {
    const patient = await createSessionToken(SECRET, 60, { kind: "patient", sub: "p" });
    const staff = await createSessionToken(SECRET, 60, {
      kind: "staff",
      sub: "s",
      role: "doctor",
    });
    expect(await readStaffToken(patient, SECRET, true)).toBeNull();
    expect(await readPatientToken(staff, SECRET)).toBeNull();
  });

  it("rejects staff tokens with a missing or unknown role", async () => {
    const noRole = await signedToken({ exp: 4102444800, kind: "staff", sub: "s" });
    const badRole = await signedToken({ exp: 4102444800, kind: "staff", sub: "s", role: "root" });
    expect(await readSessionToken(noRole, SECRET)).toBeNull();
    expect(await readSessionToken(badRole, SECRET)).toBeNull();
  });

  it("rejects unknown kinds and empty subjects", async () => {
    const weirdKind = await signedToken({ exp: 4102444800, kind: "root", sub: "s" });
    const noSub = await signedToken({ exp: 4102444800, kind: "patient", sub: "" });
    expect(await readSessionToken(weirdKind, SECRET)).toBeNull();
    expect(await readSessionToken(noSub, SECRET)).toBeNull();
  });

  it("rejects a privilege-escalating payload edit (signature mismatch)", async () => {
    const token = await createSessionToken(SECRET, 60, { kind: "patient", sub: "p" });
    const [, sig] = token.split(".");
    const forged = b64url(
      JSON.stringify({ exp: 4102444800, kind: "staff", sub: "p", role: "admin" })
    );
    expect(await readSessionToken(`${forged}.${sig}`, SECRET)).toBeNull();
  });

  it("rejects wrong secret and expired tokens", async () => {
    const token = await createSessionToken(SECRET, 1, { kind: "patient", sub: "p" });
    expect(await readSessionToken(token, "other")).toBeNull();
    expect(await readSessionToken(token, SECRET)).not.toBeNull();
    vi.advanceTimersByTime(5000);
    expect(await readSessionToken(token, SECRET)).toBeNull();
  });

  it.each([undefined, "", "garbage", "a.b", "a.b.c", "%%%.%%%"])(
    "readSessionToken returns null (never throws) for %j",
    async (token) => {
      await expect(readSessionToken(token, SECRET)).resolves.toBeNull();
    }
  );

  it("rejects non-object payloads", async () => {
    const token = await signedToken(42 as unknown as object);
    expect(await readSessionToken(token, SECRET)).toBeNull();
  });
});
