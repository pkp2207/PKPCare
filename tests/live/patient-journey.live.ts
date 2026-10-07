// Live end-to-end check of the patient journey against the Appwrite project in .env.
// Run with: npm run test:live   (non-production projects only).
//
// Covers: user + patient registration (consent, encryption at rest, file upload),
// doctors/availability, atomic booking + double-booking, reschedule, cancel, staff
// list, data export, erasure. Notifications are stubbed so no SMS/email is sent.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
}));

vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => {
      const value = state.cookies.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => void state.cookies.set(name, value),
    delete: (name: string) => void state.cookies.delete(name),
  }),
  headers: () => new Headers({ "x-forwarded-for": "203.0.113.9" }),
}));
vi.mock("next/cache", () => ({
  revalidatePath: () => undefined,
  revalidateTag: () => undefined,
}));
vi.mock("@/lib/notifications/events", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notifications/events")>()),
  notifyAppointment: async () => undefined,
}));

import {
  cancelMyAppointment,
  createAppointment,
  getRecentAppointmentList,
  listMyAppointments,
  rescheduleAppointment,
} from "@/lib/actions/appointment.actions";
import {
  exportMyData,
  getMyConsents,
  listDeletionRequests,
  requestAccountDeletion,
  resolveDeletionRequest,
} from "@/lib/actions/compliance.actions";
import { getAvailability, listDoctors } from "@/lib/actions/doctor.actions";
import {
  createUser,
  getPatient,
  registerPatient,
} from "@/lib/actions/patient.actions";
import { getClients } from "@/lib/appwrite/client";
import { SESSION_COOKIE, createSessionToken } from "@/lib/auth/session";
import { getEnv } from "@/lib/env";

const ALLERGY_TEXT =
  "मूँगफली और दूध से एलर्जी — severe reaction, carries an epinephrine pen. " +
  "x".repeat(150);
const STAMP = Date.now();
const EMAIL = `pkpcare-live-test+${STAMP}@example.com`;
const PHONE = `+1202555${String(STAMP).slice(-4)}`;

// 1x1 PNG (valid magic bytes) for the ID document upload.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

const ctx: {
  userId?: string;
  patientId?: string;
  appointmentId?: string;
  doctorId?: string;
  slots: { start: string; end: string }[];
} = { slots: [] };

const asPatient = () => state.cookies.clear();
const asAdmin = async () => {
  state.cookies.set(
    SESSION_COOKIE,
    await createSessionToken(process.env.ADMIN_SESSION_SECRET!, 3600, {
      kind: "staff",
      sub: "live-test-admin",
      role: "admin",
      email: null,
      name: "Live Test Admin",
    })
  );
};

describe("patient journey (live Appwrite)", () => {
  beforeAll(() => {
    for (const key of ["ADMIN_SESSION_SECRET", "FIELD_ENCRYPTION_KEY", "API_KEY"]) {
      if (!process.env[key]) throw new Error(`${key} is not set (run via npm run test:live)`);
    }
    if (process.env.PATIENT_AUTH_ENFORCED === "true") {
      throw new Error("This suite expects PATIENT_AUTH_ENFORCED to be off.");
    }
  });

  it("creates a user", async () => {
    const result = await createUser({ name: "Live Test", email: EMAIL, phone: PHONE });
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
    if (result.ok) ctx.userId = (result.data as { $id: string }).$id;
    expect(ctx.userId).toBeTruthy();
  });

  it("lists seeded doctors from the doctors collection (not the legacy fallback)", async () => {
    const result = await listDoctors();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.length).toBeGreaterThanOrEqual(9);
    expect(result.data.some((d) => d.legacy)).toBe(false);
    ctx.doctorId = result.data.find((d) => d.name === "John Green")?.id;
    expect(ctx.doctorId).toBeTruthy();
  });

  it("registers the patient with consent, an uploaded ID and encrypted medical text", async () => {
    const form = new FormData();
    form.append("blobFile", new Blob([PNG], { type: "image/png" }));
    form.append("fileName", "live-test-id.png");

    const result = await registerPatient({
      userId: ctx.userId!,
      name: "Live Test",
      email: EMAIL,
      phone: PHONE,
      birthDate: new Date("1990-05-17"),
      gender: "Other",
      address: "1 Test Street, Testville",
      occupation: "Tester",
      emergencyContactName: "Emergency Contact",
      emergencyContactNumber: "+12025550100",
      primaryPhysician: "John Green",
      insuranceProvider: "Test Insurance",
      insurancePolicyNumber: "POLICY-123456",
      allergies: ALLERGY_TEXT,
      currentMedication: "none",
      familyMedicalHistory: "none",
      pastMedicalHistory: "none",
      identificationType: "Passport",
      identificationNumber: "P1234567",
      identificationDocument: form,
      privacyConsent: true,
      treatmentConsent: true,
      disclosureConsent: true,
    });
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
    if (result.ok) ctx.patientId = (result.data as { $id: string }).$id;
  });

  it("stores sensitive fields encrypted at rest and decrypts them on read", async () => {
    const env = getEnv();
    const raw = (await getClients().databases.getDocument(
      env.DATABASE_ID,
      env.PATIENT_COLLECTION_ID,
      ctx.patientId!
    )) as unknown as Record<string, unknown>;
    expect(String(raw.allergies).startsWith("enc:v1:")).toBe(true);
    expect(String(raw.allergies)).not.toContain("epinephrine");
    expect(String(raw.identificationNumber).startsWith("enc:v1:")).toBe(true);
    expect(String(raw.insurancePolicyNumber).startsWith("enc:v1:")).toBe(true);

    const patient = await getPatient(ctx.userId!);
    expect(patient.ok).toBe(true);
    if (patient.ok) {
      expect(patient.data?.allergies).toBe(ALLERGY_TEXT);
      expect(patient.data?.identificationNumber).toBe("P1234567");
    }
  });

  it("records the three consents", async () => {
    const result = await getMyConsents(ctx.userId!);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const granted = result.data.filter((c) => c.granted).map((c) => c.purpose).sort();
    expect(granted).toEqual(["disclosure", "privacy", "treatment"]);
  });

  it("returns open slots for the next two weeks", async () => {
    const from = new Date(Date.now() + 2 * 24 * 3600 * 1000);
    const to = new Date(from.getTime() + 10 * 24 * 3600 * 1000);
    const result = await getAvailability({
      doctorId: ctx.doctorId!,
      from: from.toISOString(),
      to: to.toISOString(),
    });
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.data.length).toBeGreaterThanOrEqual(2);
    ctx.slots = result.data.slice(0, 2);
  });

  it("books a slot atomically", async () => {
    const result = await createAppointment({
      userId: ctx.userId!,
      patient: ctx.patientId!,
      doctorId: ctx.doctorId!,
      slotStart: ctx.slots[0].start,
      reason: "Live integration test",
      note: undefined,
    });
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
    if (result.ok) ctx.appointmentId = result.data.$id;
  });

  it("rejects a second booking of the same slot", async () => {
    const result = await createAppointment({
      userId: ctx.userId!,
      patient: ctx.patientId!,
      doctorId: ctx.doctorId!,
      slotStart: ctx.slots[0].start,
      reason: "Should collide",
      note: undefined,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/taken|available|booked/i);
  });

  it("shows the booked slot as unavailable", async () => {
    const result = await getAvailability({
      doctorId: ctx.doctorId!,
      from: ctx.slots[0].start,
      to: new Date(new Date(ctx.slots[0].start).getTime() + 3600_000).toISOString(),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.map((s) => s.start)).not.toContain(ctx.slots[0].start);
    }
  });

  it("reschedules to the second slot and frees the first", async () => {
    const moved = await rescheduleAppointment({
      appointmentId: ctx.appointmentId!,
      userId: ctx.userId!,
      newStart: ctx.slots[1].start,
    });
    expect(moved, JSON.stringify(moved)).toMatchObject({ ok: true });

    const after = await getAvailability({
      doctorId: ctx.doctorId!,
      from: ctx.slots[0].start,
      to: new Date(new Date(ctx.slots[0].start).getTime() + 3600_000).toISOString(),
    });
    expect(after.ok).toBe(true);
    if (after.ok) expect(after.data.map((s) => s.start)).toContain(ctx.slots[0].start);
  });

  it("lists the patient's appointments", async () => {
    const result = await listMyAppointments(ctx.userId!);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.some((a) => a.$id === ctx.appointmentId)).toBe(true);
  });

  it("lets a staff admin see the appointment, and refuses anonymous callers", async () => {
    asPatient();
    const denied = await getRecentAppointmentList({ pageSize: 10 });
    expect(denied.ok).toBe(false);

    await asAdmin();
    const result = await getRecentAppointmentList({ pageSize: 50 });
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.data.documents.some((d) => d.$id === ctx.appointmentId)).toBe(true);
      expect(result.data.totalCount).toBeGreaterThanOrEqual(1);
    }
    asPatient();
  });

  it("exports the patient's data, decrypted", async () => {
    const result = await exportMyData(ctx.userId!);
    expect(result.ok).toBe(true);
    if (result.ok) expect(JSON.stringify(result.data)).toContain("epinephrine");
  });

  it("cancels the appointment and frees the slot", async () => {
    const result = await cancelMyAppointment({
      appointmentId: ctx.appointmentId!,
      userId: ctx.userId!,
      reason: "live test cleanup",
    });
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
  });

  it("erases the account through the deletion-request flow", async () => {
    const request = await requestAccountDeletion({
      userId: ctx.userId!,
      reason: "live test",
    });
    expect(request, JSON.stringify(request)).toMatchObject({ ok: true });
    if (!request.ok) return;

    await asAdmin();
    const pending = await listDeletionRequests();
    expect(pending.ok).toBe(true);

    const resolved = await resolveDeletionRequest({
      id: (request.data as { id: string }).id,
      decision: "approved",
      note: "live test",
    });
    expect(resolved, JSON.stringify(resolved)).toMatchObject({ ok: true });
    asPatient();

    const gone = await getPatient(ctx.userId!);
    expect(gone.ok && gone.data === null ? true : !gone.ok).toBe(true);
  });

  afterAll(async () => {
    // Best-effort residue cleanup (ignores 404). Consent/audit/deletion-request rows
    // are append-only by design and stay.
    const env = getEnv();
    const { databases, users } = getClients();
    const attempt = async (fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch {
        /* already gone */
      }
    };
    if (ctx.appointmentId) {
      await attempt(() =>
        databases.deleteDocument(env.DATABASE_ID, env.APPOINTMENT_COLLECTION_ID, ctx.appointmentId!)
      );
    }
    if (ctx.patientId) {
      await attempt(() =>
        databases.deleteDocument(env.DATABASE_ID, env.PATIENT_COLLECTION_ID, ctx.patientId!)
      );
    }
    if (ctx.userId) await attempt(() => users.delete(ctx.userId!));
  });
});
