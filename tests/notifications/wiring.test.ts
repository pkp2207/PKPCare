import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cancelMyAppointment, createAppointment } from "@/lib/actions/appointment.actions";
import { expireStaleWaitlistOffers } from "@/lib/scheduling/offers";

import { addDoctor, addPatient, appointmentRepo, db, resetDb } from "../scheduling/fakes";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/appwrite/doctor.repository", async () => (await import("../scheduling/fakes")).doctorRepo);
vi.mock("@/lib/appwrite/slot.repository", async () => (await import("../scheduling/fakes")).slotRepo);
vi.mock("@/lib/appwrite/appointment.repository", async () => (await import("../scheduling/fakes")).appointmentRepo);
vi.mock("@/lib/appwrite/patient.repository", async () => (await import("../scheduling/fakes")).patientRepo);
vi.mock("@/lib/appwrite/waitlist.repository", async () => (await import("../scheduling/fakes")).waitlistRepo);
vi.mock("@/lib/compliance/audit", () => ({ recordAudit: vi.fn(async () => undefined) }));
vi.mock("@/lib/scheduling/hooks", () => ({ onWaitlistOffer: vi.fn(async () => undefined) }));
vi.mock("@/lib/notifications/store", () => ({ listOfferedWaitlist: vi.fn() }));
vi.mock("@/lib/auth/admin", () => {
  class AdminAuthError extends Error {}
  return { AdminAuthError, requireRole: vi.fn(), getStaffSession: vi.fn() };
});
vi.mock("@/lib/auth/patient", () => {
  class PatientAuthError extends Error {}
  return { PatientAuthError, assertPatientOrStaffOwns: vi.fn(async () => ({ actor: "patient" })) };
});

const START = new Date("2026-10-08T10:00:00.000Z");
const params = {
  userId: "u1",
  patient: "patient-u1",
  doctorId: "doc1",
  slotStart: START,
  reason: "Annual checkup",
  note: undefined,
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-07T08:00:00.000Z"));
  resetDb();
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  addDoctor();
  addPatient("u1");
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("action wiring never fails the action", () => {
  it("still books and cancels when the SMS provider rejects", async () => {
    vi.stubEnv("NOTIFY_BOOKING_RECEIVED", "true");
    appointmentRepo.sendSms.mockRejectedValue(new Error("provider down +14155550123"));
    const created = await createAppointment(params as never);
    expect(created.ok).toBe(true);
    const id = (created as { data: { $id: string } }).data.$id;
    const cancelled = await cancelMyAppointment({ appointmentId: id, userId: "u1", reason: "Change of plans" });
    expect(cancelled).toMatchObject({ ok: true, data: { status: "cancelled" } });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(/415555/);
  });

  it("still succeeds (within the time budget) when the provider hangs", async () => {
    vi.stubEnv("NOTIFY_TIMEOUT_MS", "20");
    appointmentRepo.sendSms.mockImplementation(() => new Promise(() => undefined));
    const created = await createAppointment(params as never);
    const id = (created as { data: { $id: string } }).data.$id;
    const cancelled = await cancelMyAppointment({ appointmentId: id, userId: "u1", reason: "Change of plans" });
    expect(cancelled.ok).toBe(true);
  });

  it("sends no SMS on create by default (legacy behaviour), one on cancel", async () => {
    const created = await createAppointment(params as never);
    expect(created.ok).toBe(true);
    expect(db.sms).toHaveLength(0);
    const id = (created as { data: { $id: string } }).data.$id;
    await cancelMyAppointment({ appointmentId: id, userId: "u1", reason: "Change of plans" });
    expect(db.sms).toHaveLength(1);
    expect(db.sms[0].content).toMatch(/has been cancelled/);
    expect(db.sms[0].content).not.toMatch(/Change of plans/);
  });

  it("sends booking-received only when NOTIFY_BOOKING_RECEIVED=true", async () => {
    vi.stubEnv("NOTIFY_BOOKING_RECEIVED", "true");
    await createAppointment(params as never);
    expect(db.sms).toHaveLength(1);
    expect(db.sms[0].content).toMatch(/received your appointment request/);
  });
});

describe("expireStaleWaitlistOffers", () => {
  const offered = (id: string, minutesAgo: number, startOffsetH = 48) => {
    const now = Date.now();
    db.waitlist.set(id, {
      $id: id,
      $createdAt: new Date(now).toISOString(),
      userId: `user-${id}`,
      patientId: "p",
      doctorId: "doc1",
      earliest: new Date(now).toISOString(),
      latest: new Date(now + 10 * 86400_000).toISOString(),
      status: "offered",
      createdAt: new Date(now - 86400_000).toISOString(),
      offeredAt: new Date(now - minutesAgo * 60_000).toISOString(),
      offeredStart: new Date(now + startOffsetH * 3600_000).toISOString(),
    });
  };
  const wire = async () => {
    const store = await import("@/lib/notifications/store");
    vi.mocked(store.listOfferedWaitlist).mockImplementation(async () =>
      Array.from(db.waitlist.values()).filter((w) => w.status === "offered") as never
    );
  };

  it("expires lapsed offers, keeps live ones, and re-offers to the next waiting entry", async () => {
    await wire();
    offered("old", 45);
    offered("live", 5);
    db.waitlist.set("next", {
      ...db.waitlist.get("old"),
      $id: "next",
      userId: "user-next",
      status: "waiting",
      offeredAt: null,
      offeredStart: null,
      createdAt: new Date().toISOString(),
    } as never);
    const summary = await expireStaleWaitlistOffers();
    expect(summary).toMatchObject({ found: 1, expired: 1, reoffered: 1, errors: 0 });
    expect(db.waitlist.get("old")?.status).toBe("expired");
    expect(db.waitlist.get("live")?.status).toBe("offered");
    expect(db.waitlist.get("next")?.status).toBe("offered");
  });

  it("dry run changes nothing", async () => {
    await wire();
    offered("old", 45);
    const summary = await expireStaleWaitlistOffers({ dryRun: true });
    expect(summary).toMatchObject({ dryRun: true, found: 1, expired: 0 });
    expect(db.waitlist.get("old")?.status).toBe("offered");
  });
});
