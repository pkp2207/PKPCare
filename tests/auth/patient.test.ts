import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ values: {} as Record<string, string> }));

vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) =>
      name in jar.values ? { name, value: jar.values[name] } : undefined,
  }),
}));

import { AdminAuthError, getStaffSession, requireAdmin, requireRole } from "@/lib/auth/admin";
import {
  PatientAuthError,
  assertPatientOrStaffOwns,
  getPatientSession,
  isPatientAuthEnforced,
  requirePatient,
} from "@/lib/auth/patient";
import {
  PATIENT_SESSION_COOKIE,
  SESSION_COOKIE,
  createSessionToken,
} from "@/lib/auth/session";

const SECRET = "test-secret-".padEnd(48, "x");

const patientToken = (sub: string) =>
  createSessionToken(SECRET, 3600, { kind: "patient", sub });
const staffToken = (role: "admin" | "frontdesk" | "doctor") =>
  createSessionToken(SECRET, 3600, {
    kind: "staff",
    sub: "staff1",
    role,
    email: "s@x.co",
    name: "Sam",
  });

beforeEach(() => {
  jar.values = {};
  vi.stubEnv("ADMIN_SESSION_SECRET", SECRET);
  vi.stubEnv("PATIENT_AUTH_ENFORCED", "");
  vi.stubEnv("ALLOW_LEGACY_ADMIN_PASSKEY", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isPatientAuthEnforced", () => {
  it("is only true for the exact string 'true'", () => {
    expect(isPatientAuthEnforced()).toBe(false);
    vi.stubEnv("PATIENT_AUTH_ENFORCED", "1");
    expect(isPatientAuthEnforced()).toBe(false);
    vi.stubEnv("PATIENT_AUTH_ENFORCED", "true");
    expect(isPatientAuthEnforced()).toBe(true);
  });
});

describe("assertPatientOrStaffOwns (not enforced: default)", () => {
  it("lets anonymous callers through as patient", async () => {
    await expect(assertPatientOrStaffOwns("u1")).resolves.toEqual({ actor: "patient" });
  });

  it("lets a mismatching patient session through", async () => {
    jar.values[PATIENT_SESSION_COOKIE] = await patientToken("other");
    await expect(assertPatientOrStaffOwns("u1")).resolves.toEqual({ actor: "patient" });
  });

  it("still reports staff when a staff session exists", async () => {
    jar.values[SESSION_COOKIE] = await staffToken("frontdesk");
    const result = await assertPatientOrStaffOwns("u1");
    expect(result.actor).toBe("staff");
    expect(result.staff?.role).toBe("frontdesk");
  });
});

describe("assertPatientOrStaffOwns (enforced)", () => {
  beforeEach(() => {
    vi.stubEnv("PATIENT_AUTH_ENFORCED", "true");
  });

  it("rejects anonymous callers", async () => {
    await expect(assertPatientOrStaffOwns("u1")).rejects.toBeInstanceOf(PatientAuthError);
  });

  it("accepts the matching patient", async () => {
    jar.values[PATIENT_SESSION_COOKIE] = await patientToken("u1");
    await expect(assertPatientOrStaffOwns("u1")).resolves.toEqual({ actor: "patient" });
  });

  it("rejects a different patient", async () => {
    jar.values[PATIENT_SESSION_COOKIE] = await patientToken("u2");
    await expect(assertPatientOrStaffOwns("u1")).rejects.toBeInstanceOf(PatientAuthError);
  });

  it("accepts any staff role", async () => {
    jar.values[SESSION_COOKIE] = await staffToken("doctor");
    const result = await assertPatientOrStaffOwns("u1");
    expect(result).toMatchObject({ actor: "staff", staff: { role: "doctor", userId: "staff1" } });
  });

  it("rejects a patient token planted in the staff cookie", async () => {
    jar.values[SESSION_COOKIE] = await patientToken("u1");
    await expect(assertPatientOrStaffOwns("u2")).rejects.toBeInstanceOf(PatientAuthError);
  });

  it("rejects a staff token planted in the patient cookie", async () => {
    jar.values[PATIENT_SESSION_COOKIE] = await staffToken("admin");
    await expect(assertPatientOrStaffOwns("u1")).rejects.toBeInstanceOf(PatientAuthError);
  });

  it("fails closed without a session secret", async () => {
    jar.values[PATIENT_SESSION_COOKIE] = await patientToken("u1");
    vi.stubEnv("ADMIN_SESSION_SECRET", "");
    await expect(assertPatientOrStaffOwns("u1")).rejects.toBeInstanceOf(PatientAuthError);
  });
});

describe("patient session helpers", () => {
  it("getPatientSession / requirePatient", async () => {
    expect(await getPatientSession()).toBeNull();
    await expect(requirePatient()).rejects.toBeInstanceOf(PatientAuthError);
    jar.values[PATIENT_SESSION_COOKIE] = await patientToken("u1");
    expect(await getPatientSession()).toEqual({ userId: "u1" });
    await expect(requirePatient()).resolves.toEqual({ userId: "u1" });
  });
});

describe("staff session helpers", () => {
  it("getStaffSession returns identity and role", async () => {
    jar.values[SESSION_COOKIE] = await staffToken("frontdesk");
    expect(await getStaffSession()).toEqual({
      userId: "staff1",
      email: "s@x.co",
      name: "Sam",
      role: "frontdesk",
    });
  });

  it("requireRole enforces allowed roles; no args = any staff role", async () => {
    await expect(requireRole()).rejects.toBeInstanceOf(AdminAuthError);

    jar.values[SESSION_COOKIE] = await staffToken("doctor");
    await expect(requireRole()).resolves.toMatchObject({ role: "doctor" });
    await expect(requireRole("doctor", "admin")).resolves.toMatchObject({ role: "doctor" });
    await expect(requireRole("admin")).rejects.toBeInstanceOf(AdminAuthError);
  });

  it("requireAdmin accepts any staff role but not patients", async () => {
    jar.values[SESSION_COOKIE] = await patientToken("u1");
    await expect(requireAdmin()).rejects.toBeInstanceOf(AdminAuthError);
    jar.values[SESSION_COOKIE] = await staffToken("doctor");
    await expect(requireAdmin()).resolves.toBeUndefined();
  });

  it("legacy passkey sessions map to admin while allowed, and die when disabled", async () => {
    jar.values[SESSION_COOKIE] = await createSessionToken(SECRET, 3600);
    expect(await getStaffSession()).toMatchObject({ role: "admin", userId: "legacy-passkey" });
    await expect(requireRole("admin")).resolves.toMatchObject({ role: "admin" });

    vi.stubEnv("ALLOW_LEGACY_ADMIN_PASSKEY", "false");
    expect(await getStaffSession()).toBeNull();
    await expect(requireAdmin()).rejects.toBeInstanceOf(AdminAuthError);
  });

  it("fails closed without a session secret", async () => {
    jar.values[SESSION_COOKIE] = await staffToken("admin");
    vi.stubEnv("ADMIN_SESSION_SECRET", "");
    expect(await getStaffSession()).toBeNull();
  });
});
