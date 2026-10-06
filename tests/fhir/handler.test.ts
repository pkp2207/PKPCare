import { randomBytes } from "node:crypto";

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import { recordAudit } from "@/lib/compliance/audit";
import {
  encryptFields,
  resetCryptoStateForTests,
  SENSITIVE_PATIENT_FIELDS,
} from "@/lib/compliance/crypto";
import { resetFhirRateLimiter } from "@/lib/fhir/auth";
import * as data from "@/lib/fhir/data";
import { handleFhirRequest } from "@/lib/fhir/handler";

vi.mock("@/lib/auth/admin", () => ({ getStaffSession: vi.fn(async () => null) }));
vi.mock("@/lib/compliance/audit", () => ({ recordAudit: vi.fn(async () => undefined) }));
vi.mock("@/lib/fhir/data");

const FULL = "f".repeat(40);
const LIMITED = "l".repeat(40);
const BASE = "https://x.test/api/fhir";

const call = (path: string, token: string | null = FULL, method = "GET") =>
  handleFhirRequest(
    new Request(`${BASE}/${path}`, {
      method,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }),
    path.split("?")[0].split("/").filter(Boolean),
    new Date("2026-10-06T00:00:00.000Z"),
  );

const patientDoc = (overrides: Record<string, unknown> = {}) =>
  encryptFields(
    {
      $id: "p1",
      $updatedAt: "2026-10-01T10:00:00.000+00:00",
      userId: "u1",
      name: "Asha Rao",
      email: "asha@example.com",
      phone: "+911234567890",
      birthDate: "1990-05-17T00:00:00.000Z",
      gender: "Female",
      address: "12 MG Road",
      allergies: "penicillin",
      insurancePolicyNumber: "POL-123",
      ...overrides,
    },
    SENSITIVE_PATIENT_FIELDS,
  );

const apptDoc = {
  $id: "a1",
  $createdAt: "2026-09-30T08:00:00.000+00:00",
  $updatedAt: "2026-10-01T09:00:00.000+00:00",
  schedule: "2026-10-08T10:00:00.000+00:00",
  status: "scheduled",
  primaryPhysician: "Dr. John Green",
  doctorId: "john-green",
  visitType: "video",
  reason: "chest pain",
  note: "n",
  userId: "u1",
  patient: { $id: "p1" },
};

beforeEach(() => {
  vi.stubEnv("FHIR_API_ENABLED", "true");
  vi.stubEnv("FHIR_API_TOKENS", `full:read:patient+read:appointment+read:practitioner+read:slot+read:consent+read:sensitive:${FULL},limited:read:slot:${LIMITED}`);
  vi.stubEnv("FIELD_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  resetCryptoStateForTests();
  resetFhirRateLimiter();
  vi.mocked(recordAudit).mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

describe("gating", () => {
  it("404 OperationOutcome when disabled", async () => {
    vi.stubEnv("FHIR_API_ENABLED", "false");
    const res = await call("metadata");
    expect(res.status).toBe(404);
    expect((await res.json()).issue[0].details.text).toMatch(/not enabled/i);
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])("%s is 405", async (method) => {
    const res = await call("Patient/p1", FULL, method);
    expect(res.status).toBe(405);
    expect((await res.json()).resourceType).toBe("OperationOutcome");
  });

  it("401 without or with a wrong token; audits only attempted logins", async () => {
    expect((await call("metadata", null)).status).toBe(401);
    expect(recordAudit).not.toHaveBeenCalled();
    expect((await call("metadata", "x".repeat(40))).status).toBe(401);
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "denied", actorId: null }),
    );
  });

  it("403 when the scope is missing, and audits it as denied", async () => {
    const res = await call("Patient/p1", LIMITED);
    expect(res.status).toBe(403);
    expect(data.getPatientById).not.toHaveBeenCalled();
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: "limited", outcome: "denied", resource: "fhir.Patient" }),
    );
  });

  it("429 once the per-token limit is hit", async () => {
    vi.stubEnv("FHIR_RATE_LIMIT_PER_MINUTE", "2");
    await call("metadata");
    await call("metadata");
    const res = await call("metadata");
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
  });

  it("unknown endpoint and unsupported parameter", async () => {
    expect((await call("Observation")).status).toBe(404);
    const res = await call("Patient?name=x&identifier=u1");
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain("name");
  });
});

describe("metadata", () => {
  it("returns a CapabilityStatement and audits it", async () => {
    const res = await call("metadata");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/fhir+json");
    expect((await res.json()).resourceType).toBe("CapabilityStatement");
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "fhir.read", actorId: "full", actorRole: "fhir-client" }),
    );
  });
});

describe("Patient", () => {
  beforeEach(() => {
    vi.mocked(data.getPatientById).mockResolvedValue(patientDoc() as never);
  });

  it("read is minimal and never contains ciphertext or sensitive values", async () => {
    const res = await call("Patient/p1");
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).toContain("Asha Rao");
    for (const leaked of ["penicillin", "POL-123", "enc:"]) expect(text).not.toContain(leaked);
  });

  it("_include=sensitive without the scope is 403, never a silent downgrade", async () => {
    vi.stubEnv("FHIR_API_TOKENS", `nosens:read:patient:${LIMITED}`);
    const res = await call("Patient/p1?_include=sensitive", LIMITED);
    expect(res.status).toBe(403);
    expect(data.getPatientById).not.toHaveBeenCalled();
  });

  it("_include=sensitive with the scope decrypts and audits the mode, not the values", async () => {
    const res = await call("Patient/p1?_include=sensitive");
    const text = await res.text();
    expect(text).toContain("penicillin");
    expect(text).toContain("POL-123");
    expect(text).not.toContain("enc:");
    const entry = vi.mocked(recordAudit).mock.calls[0][0];
    expect(entry.resourceId).toBe("p1");
    expect(entry.meta).toMatchObject({ purpose: "sensitive", status: 200 });
    expect(JSON.stringify(entry)).not.toMatch(/penicillin|Asha|asha@/);
  });

  it("404 for unknown and malformed ids", async () => {
    vi.mocked(data.getPatientById).mockResolvedValue(null);
    expect((await call("Patient/nope")).status).toBe(404);
    expect((await call("Patient/..%2Fx")).status).toBe(404);
  });

  it("search requires criteria, supports identifier and email", async () => {
    expect((await call("Patient")).status).toBe(400);
    vi.mocked(data.findPatients).mockResolvedValue({
      documents: [patientDoc()],
      total: 1,
    } as never);
    const res = await call("Patient?identifier=urn:pkpcare:user-id|u1");
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(data.findPatients).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", limit: 20, offset: 0 }),
    );
    await call("Patient?email=asha%40example.com");
    expect(data.findPatients).toHaveBeenLastCalledWith(
      expect.objectContaining({ email: "asha@example.com" }),
    );
    const other = await (await call("Patient?identifier=urn:other|u1")).json();
    expect(other.total).toBe(0);
  });

  it("maps internal failures to a generic 500 and audits the error", async () => {
    vi.mocked(data.getPatientById).mockRejectedValue(
      new Error("secret appwrite endpoint http://internal:9000"),
    );
    const res = await call("Patient/p1");
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toMatch(/secret|internal/);
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ outcome: "error" }));
  });
});

describe("Appointment", () => {
  beforeEach(() => {
    vi.mocked(data.getDoctorsByIds).mockResolvedValue([
      { $id: "john-green", name: "Dr. John Green", slotMinutes: 20 } as never,
    ]);
  });

  it("read maps status and hides the reason by default", async () => {
    vi.mocked(data.getAppointmentById).mockResolvedValue(apptDoc as never);
    const body = await (await call("Appointment/a1")).json();
    expect(body.status).toBe("booked");
    expect(body.end).toBe("2026-10-08T10:20:00.000Z");
    expect(JSON.stringify(body)).not.toContain("chest pain");
    const sens = await (await call("Appointment/a1?_include=sensitive")).json();
    expect(sens.reasonCode).toEqual([{ text: "chest pain" }]);
  });

  it("search needs a criterion; translates patient, status and date", async () => {
    expect((await call("Appointment")).status).toBe(400);
    vi.mocked(data.getPatientById).mockResolvedValue(patientDoc() as never);
    vi.mocked(data.searchAppointments).mockResolvedValue({
      documents: [apptDoc],
      total: 1,
    } as never);
    const res = await call(
      "Appointment?patient=Patient/p1&status=booked&date=ge2026-10-01&date=lt2026-11-01",
    );
    expect((await res.json()).total).toBe(1);
    expect(data.searchAppointments).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        status: ["scheduled"],
        gte: Date.UTC(2026, 9, 1),
        lt: Date.UTC(2026, 10, 1),
      }),
    );
    expect((await call("Appointment?practitioner=x&status=weird")).status).toBe(400);
    expect((await call("Appointment?practitioner=x&date=junk")).status).toBe(400);
  });
});

describe("Slot and Consent", () => {
  it("Slot search requires schedule and caps the range at 31 days", async () => {
    expect((await call("Slot")).status).toBe(400);
    const res = await call("Slot?schedule=Schedule/d1&start=ge2026-10-01&start=lt2026-12-01");
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain("too-costly");
  });

  it("Slot search builds a bundle from the weekly hours", async () => {
    vi.mocked(data.getDoctorById).mockResolvedValue({
      $id: "d1",
      name: "Dr. A",
      active: true,
      slotMinutes: 30,
      timezone: "UTC",
      weeklyHours: JSON.stringify({ thu: [["09:00", "10:00"]] }),
      timeOff: "[]",
    } as never);
    vi.mocked(data.listHeldSlots).mockResolvedValue([]);
    vi.mocked(data.listLegacyScheduleTimes).mockResolvedValue([]);
    const body = await (
      await call("Slot?schedule=d1&start=ge2026-10-08&start=lt2026-10-09&status=free")
    ).json();
    expect(body.total).toBe(2);
    expect(body.entry[0].resource).toMatchObject({ resourceType: "Slot", status: "free" });
  });

  it("Consent search needs a patient and maps the latest state", async () => {
    expect((await call("Consent")).status).toBe(400);
    vi.mocked(data.getPatientById).mockResolvedValue(patientDoc() as never);
    vi.mocked(data.listConsentHistory).mockResolvedValue([
      { userId: "u1", purpose: "treatment", granted: true, policyVersion: "v1", createdAt: "2026-10-01T00:00:00.000Z" },
      { userId: "u1", purpose: "treatment", granted: false, policyVersion: "v1", createdAt: "2026-10-02T00:00:00.000Z" },
    ]);
    const body = await (await call("Consent?patient=p1")).json();
    expect(body.total).toBe(1);
    expect(body.entry[0].resource.status).toBe("rejected");
  });

  it("Practitioner list pages with next link", async () => {
    vi.mocked(data.listDoctorsPage).mockResolvedValue({
      documents: [{ $id: "d1", name: "Dr. A", active: true }],
      total: 3,
    } as never);
    const body = await (await call("Practitioner?_count=1")).json();
    expect(body.link.map((l: { relation: string }) => l.relation)).toEqual(["self", "next"]);
  });
});
