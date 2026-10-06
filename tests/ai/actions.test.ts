import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  extractIdDetails,
  getAiStatus,
  getPreVisitSummary,
  suggestSpecialty,
} from "@/lib/actions/ai.actions";
import { resetAiRateLimits } from "@/lib/ai/rate-limit";
import { AdminAuthError, requireRole } from "@/lib/auth/admin";
import { recordAudit } from "@/lib/compliance/audit";

import { envelope } from "./fakes";

const getAppointmentDocument = vi.fn();
const findDoctorByStaffUserId = vi.fn();
const getPatientByUserId = vi.fn();
const listDoctorsAction = vi.fn();

vi.mock("@/lib/appwrite/appointment.repository", () => ({
  getAppointmentDocument: (...a: unknown[]) => getAppointmentDocument(...a),
}));
vi.mock("@/lib/appwrite/doctor.repository", () => ({
  findDoctorByStaffUserId: (...a: unknown[]) => findDoctorByStaffUserId(...a),
}));
vi.mock("@/lib/appwrite/patient.repository", () => ({
  getPatientByUserId: (...a: unknown[]) => getPatientByUserId(...a),
}));
vi.mock("@/lib/actions/doctor.actions", () => ({
  listDoctors: (...a: unknown[]) => listDoctorsAction(...a),
}));
vi.mock("@/lib/compliance/audit", () => ({ recordAudit: vi.fn(async () => undefined) }));
vi.mock("next/headers", () => ({
  headers: () => new Headers({ "x-forwarded-for": "203.0.113.5" }),
}));
vi.mock("@/lib/auth/admin", () => {
  class AdminAuthError extends Error {
    constructor(message = "Unauthorized") {
      super(message);
      this.name = "AdminAuthError";
    }
  }
  return { AdminAuthError, requireRole: vi.fn(), getStaffSession: vi.fn(async () => null) };
});
vi.mock("@/lib/auth/patient", () => ({ getPatientSession: vi.fn(async () => null) }));

const fetchMock = vi.fn();
const enableAi = () => {
  vi.stubEnv("AI_ENABLED", "true");
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
};
const modelReplies = (value: unknown) =>
  fetchMock.mockResolvedValue({ status: 200, text: async () => envelope(value), headers: new Headers() });

const APPT = {
  $id: "a1",
  userId: "u1",
  doctorId: "doc1",
  reason: "Diabetes follow-up",
  visitType: "in_person",
  patient: {
    name: "Jane Doe",
    email: "jane@example.com",
    birthDate: "1990-01-01",
    allergies: "Penicillin",
    currentMedication: "",
  },
};
const DOCTORS = {
  ok: true,
  data: [
    { id: "d1", name: "Ann", specialty: "Cardiology" },
    { id: "d2", name: "Bo", specialty: "Dermatology" },
  ],
};

beforeEach(() => {
  resetAiRateLimits();
  vi.unstubAllEnvs();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  getAppointmentDocument.mockReset().mockResolvedValue(APPT);
  findDoctorByStaffUserId.mockReset();
  getPatientByUserId.mockReset();
  listDoctorsAction.mockReset().mockResolvedValue(DOCTORS);
  vi.mocked(recordAudit).mockClear();
  vi.mocked(requireRole).mockReset().mockResolvedValue({ userId: "s1", role: "admin", email: null, name: null });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("disabled by default", () => {
  it("every action refuses and never calls the network", async () => {
    expect(await getAiStatus()).toEqual({ ok: true, data: { enabled: false } });
    const triage = await suggestSpecialty({ reason: "itchy skin rash on arm" });
    expect(triage).toEqual({ ok: false, error: "AI assistance is not enabled" });
    expect(await suggestSpecialty({ reason: "chest pain" })).toEqual(triage);
    expect(await extractIdDetails(new FormData())).toEqual({
      ok: false,
      error: "AI assistance is not enabled",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("flag on but no key stays disabled", async () => {
    vi.stubEnv("AI_ENABLED", "true");
    expect((await getAiStatus())).toEqual({ ok: true, data: { enabled: false } });
  });

  it("pre-visit summary falls back to the template (no model)", async () => {
    const r = await getPreVisitSummary("a1");
    expect(r).toMatchObject({ ok: true, data: { generatedBy: "template" } });
    expect((r as any).data.summary).toContain("- Allergies: Penicillin");
    expect((r as any).data.summary).toContain("- Current medication: none reported");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("suggestSpecialty (enabled)", () => {
  beforeEach(enableAi);

  it("exposes status and the configured emergency number", async () => {
    vi.stubEnv("EMERGENCY_NUMBER", "112");
    expect(await getAiStatus()).toEqual({ ok: true, data: { enabled: true, emergencyNumber: "112" } });
  });

  it("red flag returns the emergency message WITHOUT calling the model", async () => {
    vi.stubEnv("EMERGENCY_NUMBER", "112");
    const r = await suggestSpecialty({ reason: "I have crushing chest pain" });
    expect(r).toMatchObject({ ok: true, data: { redFlag: true, doctorIds: [] } });
    expect((r as any).data.redFlagMessage).toContain("(112)");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(listDoctorsAction).not.toHaveBeenCalled();
  });

  it("routes to doctors via the model and never leaks identifiers to it", async () => {
    modelReplies({ rationale: "Skin", specialty: "Dermatology", confidence: "high" });
    const r = await suggestSpecialty({ reason: "itchy rash, email me at jane@example.com or +1 415 555 0199" });
    expect(r).toMatchObject({ ok: true, data: { specialty: "Dermatology", doctorIds: ["d2"] } });
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(JSON.stringify(sent)).not.toMatch(/jane@|415|555/);
    expect(sent.tools).toBeUndefined();
  });

  it("returns ok:false when the model is down or returns junk", async () => {
    fetchMock.mockResolvedValue({ status: 500, text: async () => "x", headers: new Headers() });
    expect((await suggestSpecialty({ reason: "itchy rash on my arm" })).ok).toBe(false);
    modelReplies({ specialty: "Hacker" });
    expect((await suggestSpecialty({ reason: "itchy rash on my arm" })).ok).toBe(false);
  });

  it("validates input and rate limits (red flags still get through)", async () => {
    expect((await suggestSpecialty({ reason: "hi" })).ok).toBe(false);
    modelReplies({ rationale: "x", specialty: "none", confidence: "low" });
    for (let i = 0; i < 40; i += 1) await suggestSpecialty({ reason: "itchy rash on my arm" });
    expect(await suggestSpecialty({ reason: "itchy rash on my arm" })).toMatchObject({ ok: false });
    expect(await suggestSpecialty({ reason: "crushing chest pain" })).toMatchObject({
      ok: true,
      data: { redFlag: true },
    });
  });

  it("audit rows carry no reason text or identifiers", async () => {
    modelReplies({ rationale: "Skin", specialty: "Dermatology", confidence: "high" });
    await suggestSpecialty({ reason: "itchy rash, call Jane on +1 415 555 0199" });
    const entry = vi.mocked(recordAudit).mock.calls[0][0];
    expect(entry.action).toBe("ai.triage");
    expect(entry.meta).toMatchObject({ outcome: "ok", model: "claude-opus-5-5", inputTokens: 120, outputTokens: 30 });
    expect(JSON.stringify(entry)).not.toMatch(/rash|Jane|415|itchy/);
  });
});

describe("extractIdDetails (enabled)", () => {
  beforeEach(enableAi);
  it("rejects PDFs before any model call", async () => {
    const fd = new FormData();
    fd.append("blobFile", new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], { type: "application/pdf" }));
    fd.append("fileName", "id.pdf");
    const r = await extractIdDetails(fd);
    expect(r.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("getPreVisitSummary: scoping and audit", () => {
  it("requires a staff session", async () => {
    vi.mocked(requireRole).mockRejectedValue(new AdminAuthError());
    expect(await getPreVisitSummary("a1")).toEqual({ ok: false, error: "Unauthorized" });
    vi.mocked(requireRole).mockRejectedValue(new AdminAuthError("Forbidden"));
    expect(await getPreVisitSummary("a1")).toEqual({ ok: false, error: "Forbidden" });
    expect(getAppointmentDocument).not.toHaveBeenCalled();
    expect(vi.mocked(recordAudit).mock.calls[0][0].outcome).toBe("denied");
  });

  it("calls requireRole with exactly the three staff roles", async () => {
    await getPreVisitSummary("a1");
    expect(requireRole).toHaveBeenCalledWith("admin", "frontdesk", "doctor");
  });

  it("validates the id", async () => {
    expect((await getPreVisitSummary("../etc")).ok).toBe(false);
  });

  it("a doctor sees only their own appointments", async () => {
    vi.mocked(requireRole).mockResolvedValue({ userId: "s2", role: "doctor", email: null, name: null });
    findDoctorByStaffUserId.mockResolvedValue({ $id: "other-doc" });
    expect(await getPreVisitSummary("a1")).toEqual({ ok: false, error: "Appointment not found" });
    findDoctorByStaffUserId.mockResolvedValue(null);
    expect((await getPreVisitSummary("a1")).ok).toBe(false);
    findDoctorByStaffUserId.mockResolvedValue({ $id: "doc1" });
    expect((await getPreVisitSummary("a1")).ok).toBe(true);
  });

  it("frontdesk and admin are not doctor-scoped", async () => {
    vi.mocked(requireRole).mockResolvedValue({ userId: "s3", role: "frontdesk", email: null, name: null });
    expect((await getPreVisitSummary("a1")).ok).toBe(true);
    expect(findDoctorByStaffUserId).not.toHaveBeenCalled();
  });

  it("with AI enabled, uses the model but audits only non-PHI facts", async () => {
    enableAi();
    modelReplies({ bullets: ["Diabetes follow-up"], flags: [] });
    const r = await getPreVisitSummary("a1");
    expect(r).toMatchObject({ ok: true, data: { generatedBy: "ai" } });
    const sent = fetchMock.mock.calls[0][1].body as string;
    expect(sent).not.toMatch(/Jane|Doe|jane@|1990/);
    const entry = vi.mocked(recordAudit).mock.calls[0][0];
    expect(entry).toMatchObject({ action: "ai.visit_summary", actorId: "s1", resourceId: "a1" });
    expect(JSON.stringify(entry)).not.toMatch(/Penicillin|Jane|Diabetes/);
  });

  it("an unknown appointment is reported as not found", async () => {
    getAppointmentDocument.mockRejectedValue(Object.assign(new Error("x"), { code: 404 }));
    expect(await getPreVisitSummary("missing")).toEqual({ ok: false, error: "Appointment not found" });
  });
});
