import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppointment } from "@/lib/actions/appointment.actions";
import {
  addTimeOff,
  getAvailability,
  listDoctors,
  setDoctorActive,
  upsertDoctor,
} from "@/lib/actions/doctor.actions";
import { AdminAuthError, requireRole } from "@/lib/auth/admin";
import { recordAudit } from "@/lib/compliance/audit";
import { slotId } from "@/lib/scheduling/slot-id";

import { addDoctor, addPatient, db, resetDb } from "./fakes";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/appwrite/doctor.repository", async () => (await import("./fakes")).doctorRepo);
vi.mock("@/lib/appwrite/slot.repository", async () => (await import("./fakes")).slotRepo);
vi.mock("@/lib/appwrite/appointment.repository", async () => (await import("./fakes")).appointmentRepo);
vi.mock("@/lib/appwrite/patient.repository", async () => (await import("./fakes")).patientRepo);
vi.mock("@/lib/appwrite/waitlist.repository", async () => (await import("./fakes")).waitlistRepo);
vi.mock("@/lib/compliance/audit", () => ({ recordAudit: vi.fn(async () => undefined) }));
vi.mock("@/lib/scheduling/hooks", () => ({ onWaitlistOffer: vi.fn(async () => undefined) }));
vi.mock("@/lib/auth/admin", () => {
  class AdminAuthError extends Error {
    constructor(message = "Unauthorized") {
      super(message);
      this.name = "AdminAuthError";
    }
  }
  return { AdminAuthError, requireRole: vi.fn(), getStaffSession: vi.fn(), requireAdmin: vi.fn() };
});
vi.mock("@/lib/auth/patient", () => {
  class PatientAuthError extends Error {}
  return { PatientAuthError, assertPatientOrStaffOwns: vi.fn(async () => ({ actor: "patient" })) };
});

type Session = { userId: string; role: "admin" | "frontdesk" | "doctor"; email: null; name: null };
let session: Session | null = null;
const as = (role: Session["role"], userId = "s1") => {
  session = { userId, role, email: null, name: null };
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-07T08:00:00.000Z"));
  resetDb();
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  session = null;
  vi.mocked(requireRole).mockImplementation((async (...roles: string[]) => {
    if (!session) throw new AdminAuthError();
    if (roles.length && !roles.includes(session.role)) throw new AdminAuthError("Forbidden");
    return session;
  }) as any);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("listDoctors", () => {
  it("returns active doctors with public fields only", async () => {
    addDoctor({ staffUserId: "secret-staff", email: "secret@example.com" });
    addDoctor({ $id: "doc2", name: "Off", active: false });
    const r = await listDoctors();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toHaveLength(1);
    expect(Object.keys(r.data[0]).sort()).toEqual(["id", "image", "name", "slotMinutes", "specialty", "timezone"]);
    expect(JSON.stringify(r.data)).not.toMatch(/secret/);
  });

  it("falls back to the static list before the collection is populated", async () => {
    const r = await listDoctors();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.length).toBeGreaterThan(0);
      expect(r.data.every((d) => d.legacy)).toBe(true);
      expect(r.data.map((d) => d.name)).toContain("John Green");
    }
  });

  it("does not fall back when doctors exist but are all inactive", async () => {
    addDoctor({ active: false });
    expect(await listDoctors()).toEqual({ ok: true, data: [] });
  });
});

describe("getAvailability", () => {
  const avail = (over: Record<string, unknown> = {}) =>
    getAvailability({ doctorId: "doc1", from: "2026-10-08T00:00:00Z", to: "2026-10-09T00:00:00Z", ...over });

  beforeEach(() => addDoctor());

  it("lists open slots as ISO strings", async () => {
    const r = await avail();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toHaveLength(16);
    expect(r.data[0]).toEqual({ start: "2026-10-08T09:00:00.000Z", end: "2026-10-08T09:30:00.000Z" });
  });

  it("excludes booked slots, time off, the past and lead time", async () => {
    addPatient("u1");
    await createAppointment({
      userId: "u1", patient: "patient-u1", doctorId: "doc1", slotStart: new Date("2026-10-08T10:00:00Z"), reason: "Checkup", note: undefined,
    });
    db.doctors.get("doc1")!.timeOff = JSON.stringify([{ start: "2026-10-08T14:00:00Z", end: "2026-10-08T15:00:00Z" }]);
    const r = await avail();
    if (!r.ok) throw new Error(r.error);
    const starts = r.data.map((s) => s.start);
    expect(starts).not.toContain("2026-10-08T10:00:00.000Z");
    expect(starts).not.toContain("2026-10-08T14:00:00.000Z");
    expect(starts).not.toContain("2026-10-08T14:30:00.000Z");
    expect(starts).toContain("2026-10-08T10:30:00.000Z");

    const today = await avail({ from: "2026-10-07T00:00:00Z", to: "2026-10-08T00:00:00Z" });
    if (!today.ok) throw new Error(today.error);
    expect(today.data[0].start).toBe("2026-10-07T09:00:00.000Z"); // now is 08:00: 09:00 is the first slot >= lead time
    const soon = await avail({ from: "2026-10-07T00:00:00Z", to: "2026-10-07T09:00:00Z" });
    expect(soon).toEqual({ ok: true, data: [] });
  });

  it("hides legacy appointments that have no slot document", async () => {
    db.appointments.set("old1", {
      $id: "old1", $createdAt: "", userId: "u9", primaryPhysician: "Test Doc", schedule: "2026-10-08T11:00:00.000Z", status: "scheduled",
    } as any);
    const r = await avail();
    if (!r.ok) throw new Error(r.error);
    expect(r.data.map((s) => s.start)).not.toContain("2026-10-08T11:00:00.000Z");
  });

  it("rejects windows wider than 14 days, reversed windows, bad input", async () => {
    expect(await avail({ to: "2026-10-23T00:00:00Z" })).toMatchObject({ ok: false, error: expect.stringMatching(/14 days/) });
    expect((await avail({ to: "2026-10-08T00:00:00Z" })).ok).toBe(false);
    expect((await avail({ from: "garbage" })).ok).toBe(false);
    expect((await avail({ doctorId: "bad id!" })).ok).toBe(false);
    expect((await avail({ to: "2026-10-22T00:00:00Z" })).ok).toBe(true); // exactly 14 days
  });

  it("unknown and inactive doctors look the same", async () => {
    addDoctor({ $id: "doc2", active: false });
    expect(await avail({ doctorId: "nope" })).toEqual({ ok: false, error: "Doctor not found" });
    expect(await avail({ doctorId: "doc2" })).toEqual({ ok: false, error: "Doctor not found" });
  });

  it("matches what booking accepts: every offered slot is bookable", async () => {
    addPatient("u1");
    const r = await avail();
    if (!r.ok) throw new Error(r.error);
    const first = await createAppointment({
      userId: "u1", patient: "patient-u1", doctorId: "doc1", slotStart: r.data[3].start, reason: "Checkup", note: undefined,
    });
    expect(first.ok).toBe(true);
    expect(db.slots.has(slotId("doc1", r.data[3].start))).toBe(true);
  });
});

describe("upsertDoctor", () => {
  const input = {
    name: "New Doc", specialty: "Cardiology", image: "/img.png", timezone: "Asia/Kolkata", slotMinutes: 20,
    weeklyHours: { mon: [["10:00", "12:00"]] as [string, string][] },
  };

  it("admin creates a doctor with defaults", async () => {
    as("admin");
    const r = await upsertDoctor(input);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toMatchObject({ name: "New Doc", active: true, slotMinutes: 20, timezone: "Asia/Kolkata", timeOff: "[]" });
    expect(JSON.parse(r.data.weeklyHours)).toEqual({ mon: [["10:00", "12:00"]] });
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "doctor.upsert", actorRole: "admin" }));
  });

  it("validates timezone, hours and slot length", async () => {
    as("admin");
    expect((await upsertDoctor({ ...input, timezone: "Mars/Olympus" })).ok).toBe(false);
    expect((await upsertDoctor({ ...input, slotMinutes: 1 })).ok).toBe(false);
    expect((await upsertDoctor({ ...input, weeklyHours: { mon: [["12:00", "10:00"]] } })).ok).toBe(false);
    expect((await upsertDoctor({ ...input, weeklyHours: { mon: [["09:00", "12:00"], ["11:00", "13:00"]] } })).ok).toBe(false);
    expect((await upsertDoctor({ ...input, weeklyHours: { mon: [["9am", "12:00"]] } })).ok).toBe(false);
    expect(db.doctors.size).toBe(0);
  });

  it("rejects linking a staff account that already belongs to another doctor", async () => {
    as("admin");
    addDoctor({ $id: "doc1", staffUserId: "staff-1" });
    const r = await upsertDoctor({ ...input, id: "doc9", staffUserId: "staff-1" });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/already linked/) });
  });

  it("frontdesk is forbidden; anonymous is unauthorized and audited", async () => {
    as("frontdesk");
    expect(await upsertDoctor(input)).toEqual({ ok: false, error: "Forbidden" });
    session = null;
    expect(await upsertDoctor(input)).toEqual({ ok: false, error: "Unauthorized" });
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ outcome: "denied", action: "doctor.upsert" }));
  });

  it("a doctor edits only their own hours and nothing else", async () => {
    addDoctor({ $id: "doc1", staffUserId: "staff-1", name: "Original" });
    as("doctor", "staff-1");
    const r = await upsertDoctor({
      ...input, id: "doc1", name: "Hijacked", active: false, email: "x@example.com",
    });
    expect(r).toMatchObject({ ok: true });
    const doc = db.doctors.get("doc1")!;
    expect(doc.name).toBe("Original");
    expect(doc.active).toBe(true);
    expect(doc.email).toBe("doc@example.com");
    expect(JSON.parse(doc.weeklyHours)).toEqual({ mon: [["10:00", "12:00"]] });
    expect(doc.slotMinutes).toBe(20);
  });

  it("a doctor cannot edit someone else's document or create one", async () => {
    addDoctor({ $id: "doc1", staffUserId: "staff-1" });
    addDoctor({ $id: "doc2", name: "Other", staffUserId: "staff-2" });
    as("doctor", "staff-1");
    expect(await upsertDoctor({ ...input, id: "doc2" })).toEqual({ ok: false, error: "Forbidden" });
    expect(db.doctors.get("doc2")!.slotMinutes).toBe(30);
    as("doctor", "unlinked");
    expect(await upsertDoctor({ ...input })).toEqual({ ok: false, error: "Forbidden" });
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ outcome: "denied", action: "doctor.upsert", actorRole: "doctor" }));
  });
});

describe("setDoctorActive", () => {
  it("is admin only", async () => {
    addDoctor();
    as("doctor");
    expect(await setDoctorActive({ doctorId: "doc1", active: false })).toEqual({ ok: false, error: "Forbidden" });
    as("admin");
    expect(await setDoctorActive({ doctorId: "doc1", active: false })).toMatchObject({ ok: true, data: { active: false } });
    expect(db.doctors.get("doc1")!.active).toBe(false);
  });
});

describe("addTimeOff", () => {
  beforeEach(() => {
    addDoctor({ staffUserId: "staff-1" });
    addPatient("u1");
  });

  it("appends time off, hides the window, and reports existing bookings in it", async () => {
    await createAppointment({
      userId: "u1", patient: "patient-u1", doctorId: "doc1", slotStart: new Date("2026-10-08T10:00:00Z"), reason: "Checkup", note: undefined,
    });
    as("admin");
    const r = await addTimeOff({ doctorId: "doc1", start: "2026-10-08T09:00:00Z", end: "2026-10-08T12:00:00Z", reason: "Conference" });
    expect(r).toMatchObject({ ok: true, data: { conflictingAppointments: 1 } });
    const avail = await getAvailability({ doctorId: "doc1", from: "2026-10-08T00:00:00Z", to: "2026-10-09T00:00:00Z" });
    if (!avail.ok) throw new Error(avail.error);
    expect(avail.data).toHaveLength(16 - 6);
    expect(db.appointments.size).toBe(1); // bookings are not cancelled automatically
  });

  it("lets a doctor block their own time but not another doctor's", async () => {
    addDoctor({ $id: "doc2", name: "Other", staffUserId: "staff-2" });
    as("doctor", "staff-1");
    expect((await addTimeOff({ doctorId: "doc1", start: "2026-10-08T09:00:00Z", end: "2026-10-08T10:00:00Z" })).ok).toBe(true);
    expect(await addTimeOff({ doctorId: "doc2", start: "2026-10-08T09:00:00Z", end: "2026-10-08T10:00:00Z" })).toEqual({ ok: false, error: "Forbidden" });
  });

  it("validates the range and rejects frontdesk", async () => {
    as("admin");
    expect((await addTimeOff({ doctorId: "doc1", start: "2026-10-09T09:00:00Z", end: "2026-10-08T10:00:00Z" })).ok).toBe(false);
    as("frontdesk");
    expect(await addTimeOff({ doctorId: "doc1", start: "2026-10-08T09:00:00Z", end: "2026-10-08T10:00:00Z" })).toEqual({ ok: false, error: "Forbidden" });
  });

  it("prunes time off that ended long ago", async () => {
    db.doctors.get("doc1")!.timeOff = JSON.stringify([
      { start: "2026-01-01T00:00:00Z", end: "2026-01-02T00:00:00Z" },
    ]);
    as("admin");
    const r = await addTimeOff({ doctorId: "doc1", start: "2026-10-08T09:00:00Z", end: "2026-10-08T10:00:00Z" });
    if (!r.ok) throw new Error(r.error);
    expect(r.data.timeOff).toHaveLength(1);
  });
});
