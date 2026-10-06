import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cancelMyAppointment,
  createAppointment,
  getRecentAppointmentList,
  listMyAppointments,
  rescheduleAppointment,
  updateAppointment,
} from "@/lib/actions/appointment.actions";
import { AdminAuthError, requireRole } from "@/lib/auth/admin";
import { assertPatientOrStaffOwns, PatientAuthError } from "@/lib/auth/patient";
import { recordAudit } from "@/lib/compliance/audit";
import { SLOT_TAKEN_MESSAGE } from "@/lib/scheduling/booking";
import { onWaitlistOffer } from "@/lib/scheduling/hooks";
import { slotId } from "@/lib/scheduling/slot-id";

import {
  addDoctor,
  addPatient,
  appointmentRepo,
  db,
  resetDb,
} from "./fakes";

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
  class PatientAuthError extends Error {
    constructor(message = "Unauthorized") {
      super(message);
      this.name = "PatientAuthError";
    }
  }
  return {
    PatientAuthError,
    assertPatientOrStaffOwns: vi.fn(async () => ({ actor: "patient" })),
  };
});

type Session = { userId: string; role: "admin" | "frontdesk" | "doctor"; email: null; name: null };
let session: Session | null = null;

const START = new Date("2026-10-08T10:00:00.000Z"); // Thursday, inside hours
const LATER = new Date("2026-10-08T11:00:00.000Z");

const base = (over: Record<string, unknown> = {}) => ({
  userId: "u1",
  patient: "patient-u1",
  doctorId: "doc1",
  slotStart: START,
  reason: "Annual checkup",
  note: undefined,
  ...over,
});

const book = async (over: Record<string, unknown> = {}) => {
  const result = await createAppointment(base(over) as any);
  if (!result.ok) throw new Error(`booking failed: ${result.error}`);
  return result.data;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-07T08:00:00.000Z")); // Wednesday
  resetDb();
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  session = null;
  vi.mocked(requireRole).mockImplementation((async (...roles: string[]) => {
    if (!session) throw new AdminAuthError();
    if (roles.length && !roles.includes(session.role)) throw new AdminAuthError("Forbidden");
    return session;
  }) as any);
  addDoctor();
  addPatient("u1");
  addPatient("u2");
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("createAppointment - atomic booking", () => {
  it("claims a deterministic slot and links it to the appointment", async () => {
    const appt = await book();
    const id = slotId("doc1", START);
    expect(appt).toMatchObject({ doctorId: "doc1", slotId: id, status: "pending", visitType: "in_person", primaryPhysician: "Test Doc" });
    expect(db.slots.get(id)).toMatchObject({ doctorId: "doc1", appointmentId: appt.$id, status: "booked" });
    expect(db.slots.size).toBe(1);
  });

  it("stores the requested visit type", async () => {
    const appt = await book({ visitType: "video" });
    expect(appt.visitType).toBe("video");
  });

  it("concurrent bookings of one slot: exactly one wins, the other gets a friendly error", async () => {
    const [a, b] = await Promise.all([
      createAppointment(base() as any),
      createAppointment(base({ userId: "u2", patient: "patient-u2" }) as any),
    ]);
    const results = [a, b];
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const loser = results.find((r) => !r.ok) as { ok: false; error: string };
    expect(loser.error).toBe(SLOT_TAKEN_MESSAGE);
    expect(db.appointments.size).toBe(1);
    expect(db.slots.size).toBe(1);
  });

  it("rolls the slot back when the appointment write fails", async () => {
    db.failNextAppointmentCreate = true;
    const result = await createAppointment(base() as any);
    expect(result).toMatchObject({ ok: false });
    expect(db.slots.size).toBe(0);
    expect(db.appointments.size).toBe(0);
    // ...and the time can be booked afterwards.
    await expect(book()).resolves.toBeTruthy();
  });

  it("reaps an old orphaned slot but never a fresh one", async () => {
    const id = slotId("doc1", START);
    db.slots.set(id, {
      $id: id,
      $createdAt: new Date(Date.now() - 10 * 60_000).toISOString(),
      doctorId: "doc1",
      status: "booked",
      appointmentId: "ghost",
    } as any);
    await expect(book()).resolves.toMatchObject({ slotId: id });

    const later = slotId("doc1", LATER);
    db.slots.set(later, {
      $id: later,
      $createdAt: new Date().toISOString(),
      doctorId: "doc1",
      status: "booked",
      appointmentId: "in-flight",
    } as any);
    const result = await createAppointment(base({ slotStart: LATER, userId: "u2", patient: "patient-u2" }) as any);
    expect(result).toEqual({ ok: false, error: SLOT_TAKEN_MESSAGE });
  });

  it("does not reap a manually blocked slot", async () => {
    const id = slotId("doc1", START);
    db.slots.set(id, {
      $id: id,
      $createdAt: new Date(Date.now() - 86_400_000).toISOString(),
      doctorId: "doc1",
      status: "blocked",
    } as any);
    expect(await createAppointment(base() as any)).toEqual({ ok: false, error: SLOT_TAKEN_MESSAGE });
  });

  it("validates hours, alignment, lead time and horizon", async () => {
    const err = async (slotStart: string) => {
      const r = await createAppointment(base({ slotStart: new Date(slotStart) }) as any);
      return r.ok ? "ok" : r.error;
    };
    expect(await err("2026-10-08T10:15:00Z")).toMatch(/available time slots/);
    expect(await err("2026-10-08T20:00:00Z")).toMatch(/not available/);
    expect(await err("2026-10-10T10:00:00Z")).toMatch(/not available/); // Saturday
    expect(await err("2026-10-07T08:30:00Z")).toMatch(/at least 60 minutes/);
    expect(await err("2026-10-06T10:00:00Z")).toMatch(/future/);
    expect(await err("2027-02-01T10:00:00Z")).toMatch(/at most 90 days/);
    expect(db.slots.size).toBe(0);
  });

  it("rejects unknown and inactive doctors", async () => {
    expect(await createAppointment(base({ doctorId: "nope" }) as any)).toEqual({ ok: false, error: "Doctor not found" });
    addDoctor({ $id: "doc2", name: "Off Duty", active: false });
    const r = await createAppointment(base({ doctorId: "doc2" }) as any);
    expect(r).toMatchObject({ ok: false });
    expect(db.slots.size).toBe(0);
  });

  it("rejects a patient record that is not the caller's", async () => {
    expect(await createAppointment(base({ patient: "patient-u2" }) as any)).toEqual({ ok: false, error: "Patient not found" });
  });

  it("requires a doctor and a time", async () => {
    const r = await createAppointment({ userId: "u1", patient: "patient-u1", reason: "Checkup", note: undefined });
    expect(r.ok).toBe(false);
  });

  it("checks ownership before anything else and audits the denial", async () => {
    vi.mocked(assertPatientOrStaffOwns).mockRejectedValueOnce(new PatientAuthError());
    expect(await createAppointment(base() as any)).toEqual({ ok: false, error: "Unauthorized" });
    expect(db.slots.size).toBe(0);
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "appointment.create", outcome: "denied" }));
  });

  it("audits successful creation without PHI", async () => {
    const appt = await book();
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: "u1", actorRole: "patient", action: "appointment.create", resourceId: appt.$id })
    );
    const entry = vi.mocked(recordAudit).mock.calls[0][0];
    expect(JSON.stringify(entry)).not.toMatch(/Annual checkup/);
  });

  it("still books if the audit sink blows up", async () => {
    vi.mocked(recordAudit).mockRejectedValueOnce(new Error("audit down"));
    await expect(book()).resolves.toBeTruthy();
  });

  it("closes matching waitlist entries once booked", async () => {
    db.waitlist.set("w1", {
      $id: "w1", $createdAt: "", userId: "u1", patientId: "patient-u1", doctorId: "doc1",
      earliest: "2026-10-08T00:00:00Z", latest: "2026-10-09T00:00:00Z", status: "offered", createdAt: "2026-10-01T00:00:00Z",
    } as any);
    await book();
    expect(db.waitlist.get("w1")?.status).toBe("fulfilled");
  });
});

describe("createAppointment - legacy path", () => {
  const legacy = (over: Record<string, unknown> = {}) => ({
    userId: "u1",
    patient: "patient-u1",
    primaryPhysician: "John Green",
    schedule: START,
    reason: "Annual checkup",
    note: undefined,
    ...over,
  });

  it("works against the constant doctor list when the doctors collection is empty", async () => {
    db.doctors.clear();
    const r = await createAppointment(legacy() as any);
    expect(r.ok).toBe(true);
    expect(db.slots.size).toBe(0);
    const stored = Array.from(db.appointments.values())[0];
    expect(stored).toMatchObject({ primaryPhysician: "John Green", status: "pending" });
    // No new attributes are written before the setup script has been run.
    expect(stored).not.toHaveProperty("doctorId");
    expect(stored).not.toHaveProperty("slotId");
    expect(stored).not.toHaveProperty("visitType");
  });

  it("keeps the old overlap check and past check in fallback mode", async () => {
    db.doctors.clear();
    await createAppointment(legacy() as any);
    const clash = await createAppointment(legacy({ userId: "u2", patient: "patient-u2", schedule: new Date(START.getTime() + 10 * 60_000) }) as any);
    expect(clash).toMatchObject({ ok: false, error: expect.stringMatching(/already booked/) });
    const past = await createAppointment(legacy({ schedule: new Date("2026-10-01T10:00:00Z") }) as any);
    expect(past).toEqual({ ok: false, error: "Appointment time must be in the future" });
  });

  it("rejects names that are not real doctors", async () => {
    db.doctors.clear();
    expect(await createAppointment(legacy({ primaryPhysician: "Nobody" }) as any)).toEqual({ ok: false, error: "Select a valid doctor" });
  });

  it("resolves the name against the doctors collection and books atomically", async () => {
    const r = await createAppointment(legacy({ primaryPhysician: "Test Doc" }) as any);
    expect(r).toMatchObject({ ok: true, data: { doctorId: "doc1", slotId: slotId("doc1", START) } });
    expect(db.slots.size).toBe(1);
  });

  it("does not fall back to constants once doctors are configured", async () => {
    expect(await createAppointment(legacy() as any)).toEqual({ ok: false, error: "Select a valid doctor" });
  });

  it("legacy appointments without slotId still block via the overlap query", async () => {
    db.appointments.set("old1", {
      $id: "old1", $createdAt: "", userId: "u2", primaryPhysician: "Test Doc", schedule: START.toISOString(), status: "scheduled",
    } as any);
    const r = await createAppointment(base() as any);
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/already booked/) });
    expect(db.slots.size).toBe(0);
  });
});

describe("cancelMyAppointment", () => {
  it("frees the slot, records who cancelled, and offers it to the waitlist", async () => {
    const appt = await book();
    db.waitlist.set("w2", {
      $id: "w2", $createdAt: "", userId: "u2", patientId: "patient-u2", doctorId: "doc1",
      earliest: "2026-10-08T00:00:00Z", latest: "2026-10-09T00:00:00Z", status: "waiting", createdAt: "2026-10-01T00:00:00Z",
    } as any);
    db.waitlist.set("w1", {
      $id: "w1", $createdAt: "", userId: "u1", patientId: "patient-u1", doctorId: "doc1",
      earliest: "2026-10-08T00:00:00Z", latest: "2026-10-09T00:00:00Z", status: "waiting", createdAt: "2026-09-01T00:00:00Z",
    } as any);

    const r = await cancelMyAppointment({ appointmentId: appt.$id, userId: "u1", reason: "Cannot make it" });
    expect(r).toMatchObject({ ok: true, data: { status: "cancelled", cancelledBy: "patient" } });
    expect(db.slots.size).toBe(0);
    // The canceller (older entry) is skipped; the next in line is offered.
    expect(db.waitlist.get("w2")).toMatchObject({ status: "offered", offeredStart: START.toISOString() });
    expect(db.waitlist.get("w1")?.status).toBe("waiting");
    expect(onWaitlistOffer).toHaveBeenCalledTimes(1);
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "appointment.cancel", actorRole: "patient" }));
    // The time can be booked again.
    await expect(book({ userId: "u2", patient: "patient-u2" })).resolves.toBeTruthy();
  });

  it("will not touch somebody else's appointment or a past one", async () => {
    const appt = await book();
    expect(await cancelMyAppointment({ appointmentId: appt.$id, userId: "u2", reason: "nope nope" })).toEqual({ ok: false, error: "Appointment not found" });
    expect(db.slots.size).toBe(1);

    vi.setSystemTime(new Date("2026-10-09T00:00:00Z"));
    expect(await cancelMyAppointment({ appointmentId: appt.$id, userId: "u1", reason: "too late" })).toEqual({ ok: false, error: "Past appointments cannot be cancelled" });
  });

  it("rejects double cancellation and short reasons", async () => {
    const appt = await book();
    expect((await cancelMyAppointment({ appointmentId: appt.$id, userId: "u1", reason: "x" })).ok).toBe(false);
    await cancelMyAppointment({ appointmentId: appt.$id, userId: "u1", reason: "change of plans" });
    expect(await cancelMyAppointment({ appointmentId: appt.$id, userId: "u1", reason: "change of plans" })).toEqual({ ok: false, error: "This appointment is already cancelled" });
  });
});

describe("rescheduleAppointment", () => {
  it("books the new slot first, then releases the old one", async () => {
    const appt = await book();
    const r = await rescheduleAppointment({ appointmentId: appt.$id, userId: "u1", newStart: LATER });
    expect(r).toMatchObject({ ok: true, data: { slotId: slotId("doc1", LATER) } });
    expect(Array.from(db.slots.keys())).toEqual([slotId("doc1", LATER)]);
    expect(db.appointments.get(appt.$id)?.schedule).toBe(LATER.toISOString());
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "appointment.reschedule" }));
  });

  it("leaves the original booking untouched when the target slot is taken", async () => {
    const appt = await book();
    const target = slotId("doc1", LATER);
    db.slots.set(target, { $id: target, $createdAt: new Date().toISOString(), doctorId: "doc1", status: "blocked" } as any);
    const r = await rescheduleAppointment({ appointmentId: appt.$id, userId: "u1", newStart: LATER });
    expect(r).toEqual({ ok: false, error: SLOT_TAKEN_MESSAGE });
    expect(db.slots.has(slotId("doc1", START))).toBe(true);
    expect(db.appointments.get(appt.$id)?.schedule).toBe(START.toISOString());
  });

  it("rolls back the new slot when the appointment update fails", async () => {
    const appt = await book();
    db.failNextAppointmentUpdate = true;
    const r = await rescheduleAppointment({ appointmentId: appt.$id, userId: "u1", newStart: LATER });
    expect(r.ok).toBe(false);
    expect(db.slots.has(slotId("doc1", LATER))).toBe(false);
    expect(db.slots.has(slotId("doc1", START))).toBe(true);
    expect(db.appointments.get(appt.$id)?.schedule).toBe(START.toISOString());
  });

  it("applies patient booking rules and ownership", async () => {
    const appt = await book();
    const bad = await rescheduleAppointment({ appointmentId: appt.$id, userId: "u1", newStart: new Date("2026-10-08T10:15:00Z") });
    expect(bad).toMatchObject({ ok: false, error: expect.stringMatching(/available time slots/) });
    expect(await rescheduleAppointment({ appointmentId: appt.$id, userId: "u2", newStart: LATER })).toEqual({ ok: false, error: "Appointment not found" });
    expect(await rescheduleAppointment({ appointmentId: appt.$id, userId: "u1", newStart: START })).toEqual({ ok: false, error: "Please choose a different time" });
    expect(db.slots.size).toBe(1);
  });

  it("backfills doctorId/slotId for a legacy appointment", async () => {
    db.appointments.set("old1", {
      $id: "old1", $createdAt: "", userId: "u1", patient: "patient-u1", primaryPhysician: "Test Doc", schedule: START.toISOString(), status: "scheduled",
    } as any);
    const r = await rescheduleAppointment({ appointmentId: "old1", userId: "u1", newStart: LATER });
    expect(r).toMatchObject({ ok: true, data: { doctorId: "doc1", slotId: slotId("doc1", LATER) } });
  });
});

describe("updateAppointment (staff)", () => {
  const upd = (appointmentId: string, type: string, extra: Record<string, unknown> = {}) =>
    updateAppointment({
      appointmentId,
      userId: "ignored",
      type,
      appointment: { primaryPhysician: "Test Doc", schedule: START, cancellationReason: "Doctor unavailable", ...extra },
    } as any);

  beforeEach(() => {
    session = { userId: "admin1", role: "admin", email: null, name: null };
  });

  it("confirming an unchanged booking keeps its slot", async () => {
    const appt = await book();
    const r = await upd(appt.$id, "schedule");
    expect(r).toMatchObject({ ok: true, data: { status: "scheduled" } });
    expect(db.slots.size).toBe(1);
    expect(db.sms).toHaveLength(1);
  });

  it("moving the time swaps slots atomically", async () => {
    const appt = await book();
    await upd(appt.$id, "schedule", { schedule: LATER });
    expect(Array.from(db.slots.keys())).toEqual([slotId("doc1", LATER)]);
  });

  it("staff may schedule outside normal hours", async () => {
    const appt = await book();
    const late = new Date("2026-10-08T20:00:00Z");
    expect((await upd(appt.$id, "schedule", { schedule: late })).ok).toBe(true);
    expect(db.slots.has(slotId("doc1", late))).toBe(true);
  });

  it("cancelling frees the slot", async () => {
    const appt = await book();
    const r = await upd(appt.$id, "cancel");
    expect(r).toMatchObject({ ok: true, data: { status: "cancelled", cancelledBy: "staff" } });
    expect(db.slots.size).toBe(0);
  });

  it("denies anonymous callers and audits the attempt", async () => {
    const appt = await book();
    session = null;
    expect(await upd(appt.$id, "cancel")).toEqual({ ok: false, error: "Unauthorized" });
    expect(db.slots.size).toBe(1);
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ outcome: "denied", actorRole: "anonymous" }));
  });

  it("a doctor can only update their own appointments", async () => {
    addDoctor({ $id: "doc2", name: "Other Doc", staffUserId: "staff-2" });
    addDoctor({ $id: "doc1", staffUserId: "staff-1" });
    const appt = await book();
    session = { userId: "staff-2", role: "doctor", email: null, name: null };
    expect(await upd(appt.$id, "cancel")).toEqual({ ok: false, error: "Appointment not found" });
    session = { userId: "staff-1", role: "doctor", email: null, name: null };
    expect((await upd(appt.$id, "cancel")).ok).toBe(true);
  });

  it("works for legacy appointments against the constant doctors", async () => {
    db.doctors.clear();
    db.appointments.set("old1", {
      $id: "old1", $createdAt: "", userId: "u1", primaryPhysician: "John Green", schedule: START.toISOString(), status: "pending",
    } as any);
    const r = await updateAppointment({
      appointmentId: "old1", userId: "x", type: "schedule",
      appointment: { primaryPhysician: "John Green", schedule: LATER },
    });
    expect(r).toMatchObject({ ok: true, data: { status: "scheduled" } });
    expect(db.slots.size).toBe(0);
    expect(db.appointments.get("old1")).not.toHaveProperty("doctorId");
  });
});

describe("getRecentAppointmentList - role scoping", () => {
  beforeEach(() => {
    addDoctor({ $id: "doc1", staffUserId: "staff-1" });
    addDoctor({ $id: "doc2", name: "Other Doc", staffUserId: "staff-2" });
  });

  const seed = async () => {
    await book();
    await book({ doctorId: "doc2", userId: "u2", patient: "patient-u2" });
  };

  it("a doctor sees only their own appointments and counts", async () => {
    await seed();
    session = { userId: "staff-1", role: "doctor", email: null, name: null };
    const r = await getRecentAppointmentList();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.documents).toHaveLength(1);
    expect(r.data.documents[0].doctorId).toBe("doc1");
    expect(r.data.totalCount).toBe(1);
    expect(r.data.pendingCount).toBe(1);
    expect(db.listCalls[0].doctorId).toBe("doc1");
    expect(db.countCalls.every((c) => c.doctorId === "doc1")).toBe(true);
  });

  it("a doctor without a doctors document sees nothing", async () => {
    await seed();
    session = { userId: "someone-else", role: "doctor", email: null, name: null };
    const r = await getRecentAppointmentList();
    expect(r).toMatchObject({ ok: true, data: { documents: [], totalCount: 0 } });
    expect(appointmentRepo.listAppointments).not.toHaveBeenCalled();
  });

  it.each(["admin", "frontdesk"] as const)("%s sees everything, in the same shape", async (role) => {
    await seed();
    session = { userId: "s", role, email: null, name: null };
    const r = await getRecentAppointmentList({ page: 1, pageSize: 10 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.data).sort()).toEqual(
      ["cancelledCount", "documents", "page", "pageSize", "pendingCount", "scheduledCount", "totalCount", "totalPages"]
    );
    expect(r.data.documents).toHaveLength(2);
    expect(db.listCalls[0].doctorId).toBeUndefined();
  });

  it("rejects anonymous callers", async () => {
    expect(await getRecentAppointmentList()).toEqual({ ok: false, error: "Unauthorized" });
  });
});

describe("listMyAppointments", () => {
  it("returns only the caller's appointments", async () => {
    await book();
    await book({ slotStart: LATER, userId: "u2", patient: "patient-u2" });
    const r = await listMyAppointments("u1");
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(r.data.map((a) => a.userId)).toEqual(["u1"]);
  });

  it("denies when ownership fails", async () => {
    vi.mocked(assertPatientOrStaffOwns).mockRejectedValueOnce(new PatientAuthError());
    expect(await listMyAppointments("u1")).toEqual({ ok: false, error: "Unauthorized" });
  });
});
