import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { joinWaitlist, leaveWaitlist, listMyWaitlist } from "@/lib/actions/waitlist.actions";
import { PatientAuthError, assertPatientOrStaffOwns } from "@/lib/auth/patient";
import { onWaitlistOffer } from "@/lib/scheduling/hooks";
import { offerFreedSlotToWaitlist } from "@/lib/scheduling/offers";
import { selectWaitlistCandidate } from "@/lib/scheduling/waitlist";

import { addDoctor, addPatient, db, resetDb } from "./fakes";

vi.mock("@/lib/appwrite/doctor.repository", async () => (await import("./fakes")).doctorRepo);
vi.mock("@/lib/appwrite/patient.repository", async () => (await import("./fakes")).patientRepo);
vi.mock("@/lib/appwrite/waitlist.repository", async () => (await import("./fakes")).waitlistRepo);
vi.mock("@/lib/compliance/audit", () => ({ recordAudit: vi.fn(async () => undefined) }));
vi.mock("@/lib/scheduling/hooks", () => ({ onWaitlistOffer: vi.fn(async () => undefined) }));
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

const entry = (over: Record<string, unknown> = {}) => ({
  $id: "w",
  userId: "u",
  doctorId: "doc1",
  earliest: "2026-10-08T00:00:00Z",
  latest: "2026-10-09T00:00:00Z",
  status: "waiting" as const,
  createdAt: "2026-10-01T00:00:00Z",
  ...over,
});

const SLOT = new Date("2026-10-08T10:00:00Z");

describe("selectWaitlistCandidate", () => {
  it("picks the oldest waiting entry whose window contains the slot", () => {
    const entries = [
      entry({ $id: "late", createdAt: "2026-10-03T00:00:00Z" }),
      entry({ $id: "early", createdAt: "2026-10-01T00:00:00Z" }),
      entry({ $id: "mid", createdAt: "2026-10-02T00:00:00Z" }),
    ];
    expect(selectWaitlistCandidate(entries, "doc1", SLOT)?.$id).toBe("early");
  });

  it("skips wrong doctor, non-waiting status, out-of-window and excluded user", () => {
    const entries = [
      entry({ $id: "other-doc", doctorId: "doc2", createdAt: "2026-09-01T00:00:00Z" }),
      entry({ $id: "offered", status: "offered", createdAt: "2026-09-02T00:00:00Z" }),
      entry({ $id: "too-late", latest: "2026-10-08T09:59:00Z", createdAt: "2026-09-03T00:00:00Z" }),
      entry({ $id: "too-early", earliest: "2026-10-08T10:01:00Z", createdAt: "2026-09-04T00:00:00Z" }),
      entry({ $id: "self", userId: "me", createdAt: "2026-09-05T00:00:00Z" }),
      entry({ $id: "ok", userId: "other", createdAt: "2026-09-06T00:00:00Z" }),
    ];
    expect(selectWaitlistCandidate(entries, "doc1", SLOT, "me")?.$id).toBe("ok");
    expect(selectWaitlistCandidate(entries.slice(0, 5), "doc1", SLOT, "me")).toBeNull();
  });

  it("window edges are inclusive and ties break by id", () => {
    const entries = [
      entry({ $id: "b", earliest: SLOT.toISOString(), latest: SLOT.toISOString() }),
      entry({ $id: "a", earliest: SLOT.toISOString(), latest: SLOT.toISOString() }),
    ];
    expect(selectWaitlistCandidate(entries, "doc1", SLOT)?.$id).toBe("a");
  });
});

describe("offerFreedSlotToWaitlist", () => {
  beforeEach(() => {
    resetDb();
    vi.clearAllMocks();
  });

  const put = (over: Record<string, unknown>) =>
    db.waitlist.set(String(over.$id), { $createdAt: "", patientId: "p", ...entry(over) } as any);
  const now = new Date("2026-10-07T08:00:00Z");

  it("marks the first match offered, stores the slot and calls the hook", async () => {
    put({ $id: "w1", userId: "u1", createdAt: "2026-10-02T00:00:00Z" });
    put({ $id: "w2", userId: "u2", createdAt: "2026-10-01T00:00:00Z" });
    const offered = await offerFreedSlotToWaitlist("doc1", SLOT, { now });
    expect(offered?.$id).toBe("w2");
    expect(db.waitlist.get("w2")).toMatchObject({ status: "offered", offeredStart: SLOT.toISOString() });
    expect(db.waitlist.get("w1")?.status).toBe("waiting");
    expect(onWaitlistOffer).toHaveBeenCalledTimes(1);
  });

  it("returns null when nobody matches or the slot is inside the lead time", async () => {
    expect(await offerFreedSlotToWaitlist("doc1", SLOT, { now })).toBeNull();
    put({ $id: "w1", userId: "u1" });
    expect(await offerFreedSlotToWaitlist("doc1", new Date("2026-10-07T08:30:00Z"), { now })).toBeNull();
    expect(db.waitlist.get("w1")?.status).toBe("waiting");
  });

  it("never throws, even if the hook or repository fails", async () => {
    put({ $id: "w1", userId: "u1" });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(onWaitlistOffer).mockRejectedValueOnce(new Error("sms down"));
    await expect(offerFreedSlotToWaitlist("doc1", SLOT, { now })).resolves.toMatchObject({ $id: "w1" });
    db.waitlist.clear();
    db.waitlist.set("broken", null as any);
    await expect(offerFreedSlotToWaitlist("doc1", SLOT, { now })).resolves.toBeNull();
  });
});

describe("waitlist actions", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-07T08:00:00.000Z"));
    resetDb();
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    addDoctor();
    addPatient("u1");
    addPatient("u2");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const join = (over: Record<string, unknown> = {}) =>
    joinWaitlist({
      userId: "u1", patientId: "patient-u1", doctorId: "doc1",
      earliest: "2026-10-08T00:00:00Z", latest: "2026-10-15T00:00:00Z", ...over,
    } as any);

  it("joins, lists and leaves", async () => {
    const joined = await join();
    expect(joined).toMatchObject({ ok: true, data: { status: "waiting", doctorId: "doc1" } });
    const mine = await listMyWaitlist("u1");
    expect(mine).toMatchObject({ ok: true });
    if (mine.ok) expect(mine.data).toHaveLength(1);
    expect(await listMyWaitlist("u2")).toEqual({ ok: true, data: [] });

    if (!joined.ok) return;
    expect(await leaveWaitlist({ entryId: joined.data.$id, userId: "u2" })).toEqual({ ok: false, error: "Waitlist entry not found" });
    expect(db.waitlist.size).toBe(1);
    expect(await leaveWaitlist({ entryId: joined.data.$id, userId: "u1" })).toEqual({ ok: true, data: null });
    expect(db.waitlist.size).toBe(0);
  });

  it("rejects duplicates per doctor, bad windows, unknown doctors and foreign patients", async () => {
    await join();
    expect(await join()).toMatchObject({ ok: false, error: expect.stringMatching(/already on the waitlist/) });
    expect((await join({ doctorId: "ghost" })).ok).toBe(false);
    expect((await join({ latest: "2026-10-07T00:00:00Z" })).ok).toBe(false);
    expect((await join({ latest: "2027-06-01T00:00:00Z", doctorId: "doc1" })).ok).toBe(false);
    expect(await join({ patientId: "patient-u2" })).toEqual({ ok: false, error: "Patient not found" });
  });

  it("enforces ownership", async () => {
    vi.mocked(assertPatientOrStaffOwns).mockRejectedValueOnce(new PatientAuthError());
    expect(await join()).toEqual({ ok: false, error: "Unauthorized" });
    expect(db.waitlist.size).toBe(0);
  });
});
