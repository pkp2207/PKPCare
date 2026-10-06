import { beforeEach, describe, expect, it, vi } from "vitest";

import { getPatient, registerPatient } from "@/lib/actions/patient.actions";
import { assertPatientOrStaffOwns, PatientAuthError } from "@/lib/auth/patient";
import { recordAudit } from "@/lib/compliance/audit";
import { recordConsentGrants } from "@/lib/compliance/consent";

import { db, patientRepo, resetDb } from "./fakes";

vi.mock("next/headers", () => ({
  headers: () => {
    throw new Error("outside request scope");
  },
}));
vi.mock("@/lib/appwrite/doctor.repository", async () => (await import("./fakes")).doctorRepo);
vi.mock("@/lib/appwrite/patient.repository", async () => (await import("./fakes")).patientRepo);
vi.mock("@/lib/compliance/audit", () => ({ recordAudit: vi.fn(async () => undefined) }));
vi.mock("@/lib/compliance/consent", () => ({ recordConsentGrants: vi.fn(async () => undefined) }));
vi.mock("@/lib/auth/admin", () => {
  class AdminAuthError extends Error {}
  return { AdminAuthError, requireRole: vi.fn(), getStaffSession: vi.fn() };
});
vi.mock("@/lib/auth/patient", () => {
  class PatientAuthError extends Error {
    constructor(message = "Unauthorized") {
      super(message);
    }
  }
  return { PatientAuthError, assertPatientOrStaffOwns: vi.fn(async () => ({ actor: "patient" })) };
});

const params = (over: Record<string, unknown> = {}) =>
  ({
    userId: "u1",
    name: "Jane Doe",
    email: "jane@example.com",
    phone: "+15551234567",
    birthDate: new Date("1990-05-20"),
    gender: "Female",
    address: "12 Main Street",
    occupation: "Engineer",
    emergencyContactName: "John Doe",
    emergencyContactNumber: "+15557654321",
    primaryPhysician: "John Green",
    insuranceProvider: "Acme Health",
    insurancePolicyNumber: "ABC123456",
    allergies: "penicillin",
    currentMedication: undefined,
    familyMedicalHistory: undefined,
    pastMedicalHistory: undefined,
    identificationType: undefined,
    identificationNumber: undefined,
    identificationDocument: undefined,
    treatmentConsent: true,
    disclosureConsent: true,
    privacyConsent: true,
    ...over,
  }) as any;

beforeEach(() => {
  resetDb();
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("registerPatient", () => {
  it("records consent BEFORE creating the patient document", async () => {
    const r = await registerPatient(params());
    expect(r.ok).toBe(true);
    expect(recordConsentGrants).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", grants: { treatment: true, disclosure: true, privacy: true } })
    );
    const consentOrder = vi.mocked(recordConsentGrants).mock.invocationCallOrder[0];
    const createOrder = vi.mocked(patientRepo.createPatientDocument).mock.invocationCallOrder[0];
    expect(consentOrder).toBeLessThan(createOrder);
  });

  it("creates nothing when consent recording fails, so a retry is not blocked", async () => {
    vi.mocked(recordConsentGrants).mockRejectedValueOnce(new Error("consent store down"));
    const first = await registerPatient(params());
    expect(first.ok).toBe(false);
    expect(patientRepo.createPatientDocument).not.toHaveBeenCalled();
    expect(db.patients.size).toBe(0);

    const retry = await registerPatient(params());
    expect(retry.ok).toBe(true);
  });

  it("still blocks a genuine second registration", async () => {
    await registerPatient(params());
    expect(await registerPatient(params())).toEqual({ ok: false, error: "This user is already registered as a patient" });
  });

  it("rejects an unknown preferred physician and enforces ownership", async () => {
    expect(await registerPatient(params({ primaryPhysician: "Nobody" }))).toEqual({ ok: false, error: "Select a valid doctor" });
    vi.mocked(assertPatientOrStaffOwns).mockRejectedValueOnce(new PatientAuthError());
    expect(await registerPatient(params())).toEqual({ ok: false, error: "Unauthorized" });
    expect(patientRepo.createPatientDocument).not.toHaveBeenCalled();
  });

  it("does not put PHI in logs when it fails", async () => {
    vi.mocked(patientRepo.createPatientDocument).mockRejectedValueOnce(new Error("db down"));
    await registerPatient(params());
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).not.toMatch(/penicillin|jane@example\.com|ABC123456/);
  });
});

describe("getPatient", () => {
  it("audits patient.read only for staff", async () => {
    await registerPatient(params());
    vi.mocked(recordAudit).mockClear();

    await getPatient("u1");
    expect(recordAudit).not.toHaveBeenCalled();

    vi.mocked(assertPatientOrStaffOwns).mockResolvedValueOnce({
      actor: "staff",
      staff: { userId: "s1", role: "frontdesk", email: null, name: null },
    });
    const r = await getPatient("u1");
    expect(r.ok).toBe(true);
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: "s1", actorRole: "frontdesk", action: "patient.read", resource: "patient" })
    );
  });

  it("returns Unauthorized when ownership fails", async () => {
    vi.mocked(assertPatientOrStaffOwns).mockRejectedValueOnce(new PatientAuthError());
    expect(await getPatient("u1")).toEqual({ ok: false, error: "Unauthorized" });
  });
});
