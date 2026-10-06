import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getVisitLink } from "@/lib/actions/telehealth.actions";
import * as doctorRepo from "@/lib/appwrite/doctor.repository";
import { assertPatientOrStaffOwns } from "@/lib/auth/patient";
import { recordAudit } from "@/lib/compliance/audit";
import { verifyVisitToken } from "@/lib/telehealth/token";
import { loadVisitContext, type VisitContext } from "@/lib/telehealth/visit";

vi.mock("@/lib/compliance/audit", () => ({ recordAudit: vi.fn(async () => undefined) }));
vi.mock("@/lib/appwrite/doctor.repository", () => ({
  findDoctorByStaffUserId: vi.fn(),
}));
vi.mock("@/lib/auth/patient", () => {
  class PatientAuthError extends Error {
    constructor(message = "Unauthorized") {
      super(message);
      this.name = "PatientAuthError";
    }
  }
  return { PatientAuthError, assertPatientOrStaffOwns: vi.fn() };
});
vi.mock("@/lib/telehealth/visit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/telehealth/visit")>(
    "@/lib/telehealth/visit",
  );
  return { ...actual, loadVisitContext: vi.fn() };
});

const NOW = new Date("2026-10-08T09:00:00.000Z");

const ctx = (overrides: Partial<VisitContext> = {}): VisitContext => ({
  appointmentId: "appt1",
  userId: "patient-user",
  doctorId: "doc1",
  doctorName: "Dr. A",
  timezone: "UTC",
  status: "scheduled",
  visitType: "video",
  start: new Date("2026-10-08T10:00:00.000Z"),
  end: new Date("2026-10-08T10:30:00.000Z"),
  ...overrides,
});

const staff = (role: "admin" | "frontdesk" | "doctor", userId = "staff1") => ({
  actor: "staff" as const,
  staff: { userId, email: null, name: null, role },
});

const asPatient = () => vi.mocked(assertPatientOrStaffOwns).mockResolvedValue({ actor: "patient" });

const denyPatient = async () => {
  const { PatientAuthError } = await import("@/lib/auth/patient");
  vi.mocked(assertPatientOrStaffOwns).mockRejectedValue(new PatientAuthError());
};

const lastAudit = () => vi.mocked(recordAudit).mock.calls.at(-1)?.[0];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubEnv("TELEHEALTH_PROVIDER", "jitsi");
  vi.stubEnv("TELEHEALTH_ROOM_SECRET", "unit-secret");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.mocked(loadVisitContext).mockResolvedValue(ctx());
  asPatient();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

describe("getVisitLink", () => {
  it("owner patient gets an app link, never the raw room url", async () => {
    const result = await getVisitLink("appt1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.opensAt).toBe("2026-10-08T09:50:00.000Z");
    expect(result.data.url).toMatch(/^\/visit\/[\w-]+\.[\w-]+$/);
    expect(result.data.url).not.toMatch(/jit\.si|pkp-/);
    const token = result.data.url.replace("/visit/", "");
    expect(verifyVisitToken(token, NOW.getTime())).toMatchObject({
      ok: true,
      claims: { appointmentId: "appt1", role: "patient" },
    });
    expect(lastAudit()).toMatchObject({
      action: "telehealth.link",
      outcome: "success",
      resourceId: "appt1",
    });
  });

  it("token outlives the appointment end but not the grace period", async () => {
    const result = await getVisitLink("appt1");
    if (!result.ok) throw new Error("expected ok");
    const token = result.data.url.replace("/visit/", "");
    const end = Date.parse("2026-10-08T10:30:00.000Z");
    expect(verifyVisitToken(token, end + 30 * 60_000).ok).toBe(true);
    expect(verifyVisitToken(token, end + 61 * 60_000).ok).toBe(false);
  });

  it("another patient is denied and audited", async () => {
    await denyPatient();
    expect(await getVisitLink("appt1")).toEqual({ ok: false, error: "Unauthorized" });
    expect(lastAudit()).toMatchObject({ outcome: "denied", action: "telehealth.link" });
  });

  it.each(["admin", "frontdesk"] as const)("%s staff is allowed with the clinic role", async (role) => {
    vi.mocked(assertPatientOrStaffOwns).mockResolvedValue(staff(role));
    const result = await getVisitLink("appt1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      const parsed = verifyVisitToken(result.data.url.replace("/visit/", ""), NOW.getTime());
      expect(parsed.ok && parsed.claims.role).toBe("doctor");
    }
    expect(doctorRepo.findDoctorByStaffUserId).not.toHaveBeenCalled();
  });

  it("the assigned doctor is allowed", async () => {
    vi.mocked(assertPatientOrStaffOwns).mockResolvedValue(staff("doctor"));
    vi.mocked(doctorRepo.findDoctorByStaffUserId).mockResolvedValue({ $id: "doc1" } as never);
    expect((await getVisitLink("appt1")).ok).toBe(true);
  });

  it("a different doctor, or a doctor without a profile, is denied", async () => {
    vi.mocked(assertPatientOrStaffOwns).mockResolvedValue(staff("doctor"));
    vi.mocked(doctorRepo.findDoctorByStaffUserId).mockResolvedValue({ $id: "other" } as never);
    expect(await getVisitLink("appt1")).toEqual({ ok: false, error: "Unauthorized" });
    vi.mocked(doctorRepo.findDoctorByStaffUserId).mockResolvedValue(null as never);
    expect((await getVisitLink("appt1")).ok).toBe(false);
    expect(lastAudit()).toMatchObject({ outcome: "denied", actorRole: "doctor" });
  });

  it("not ok when the provider is none", async () => {
    vi.stubEnv("TELEHEALTH_PROVIDER", "none");
    const result = await getVisitLink("appt1");
    expect(result).toEqual({ ok: false, error: "Video visits are not enabled." });
    expect(loadVisitContext).not.toHaveBeenCalled();
  });

  it.each([
    [{ visitType: "in_person" }, /not a video visit/],
    [{ status: "cancelled" }, /cancelled/],
    [{ status: "pending" }, /not confirmed/],
  ])("not ok for %j", async (overrides, message) => {
    vi.mocked(loadVisitContext).mockResolvedValue(ctx(overrides));
    const result = await getVisitLink("appt1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(message);
  });

  it("does not reveal appointment state to unauthorized callers", async () => {
    vi.mocked(loadVisitContext).mockResolvedValue(ctx({ status: "cancelled" }));
    await denyPatient();
    expect(await getVisitLink("appt1")).toEqual({ ok: false, error: "Unauthorized" });
  });

  it("not ok once the visit window has closed", async () => {
    vi.setSystemTime(new Date("2026-10-08T11:00:01.000Z"));
    expect(await getVisitLink("appt1")).toEqual({ ok: false, error: "This visit has ended." });
  });

  it("unknown appointment and invalid id", async () => {
    vi.mocked(loadVisitContext).mockResolvedValue(null);
    expect(await getVisitLink("missing")).toEqual({ ok: false, error: "Appointment not found" });
    expect(await getVisitLink("../bad")).toEqual({ ok: false, error: "Appointment not found" });
  });

  it("never throws: unexpected errors become a generic message", async () => {
    vi.mocked(loadVisitContext).mockRejectedValue(new Error("db password=hunter2"));
    const result = await getVisitLink("appt1");
    expect(result).toEqual({ ok: false, error: "Something went wrong. Please try again." });
    expect(lastAudit()).toMatchObject({ outcome: "error" });
  });
});
