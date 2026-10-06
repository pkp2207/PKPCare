import { describe, expect, it } from "vitest";

import {
  canModifyAppointment,
  type DashboardAppointment,
  findDoctorFor,
  modifyBlockedReason,
  splitAppointments,
  videoLinkState,
} from "@/components/portal/appointments";
import { BookingFormSchema, pickDefaultDoctorId, validateBooking } from "@/components/portal/booking";

const NOW = new Date("2026-10-06T12:00:00Z");
const appt = (id: string, schedule: string, status: DashboardAppointment["status"] = "scheduled") =>
  ({ $id: id, schedule, status, primaryPhysician: "John Green" }) as DashboardAppointment;

describe("splitAppointments", () => {
  it("separates upcoming from past and puts cancelled in past", () => {
    const { upcoming, past } = splitAppointments(
      [
        appt("late", "2026-10-20T10:00:00Z"),
        appt("soon", "2026-10-07T10:00:00Z", "pending"),
        appt("old", "2026-09-01T10:00:00Z"),
        appt("older", "2026-08-01T10:00:00Z"),
        appt("cancelled", "2026-10-10T10:00:00Z", "cancelled"),
      ],
      NOW
    );
    expect(upcoming.map((a) => a.$id)).toEqual(["soon", "late"]);
    expect(past.map((a) => a.$id)).toEqual(["cancelled", "old", "older"]);
  });
});

describe("modify rules", () => {
  it("only active future appointments can be changed", () => {
    expect(canModifyAppointment(appt("a", "2026-10-07T10:00:00Z"), NOW)).toBe(true);
    expect(canModifyAppointment(appt("a", "2026-10-05T10:00:00Z"), NOW)).toBe(false);
    expect(canModifyAppointment(appt("a", "2026-10-07T10:00:00Z", "cancelled"), NOW)).toBe(false);
    expect(modifyBlockedReason(appt("a", "2026-10-05T10:00:00Z"), NOW)).toMatch(/taken place/);
    expect(modifyBlockedReason(appt("a", "2026-10-07T10:00:00Z"), NOW)).toBeNull();
  });

  it("finds the doctor by id, else by name", () => {
    const doctors = [
      { id: "d1", name: "John Green" },
      { id: "d2", name: "Jane Powell" },
    ];
    expect(findDoctorFor({ doctorId: "d2", primaryPhysician: "John Green" }, doctors)?.id).toBe("d2");
    expect(findDoctorFor({ doctorId: null, primaryPhysician: "John Green" }, doctors)?.id).toBe("d1");
    expect(findDoctorFor({ doctorId: "gone", primaryPhysician: "Nobody" }, doctors)).toBeNull();
  });
});

describe("videoLinkState", () => {
  const ok = (url: string, opensAt: string) => ({ ok: true as const, data: { url, opensAt } });

  it("opens the link once the visit window is open", () => {
    expect(videoLinkState(ok("https://v.example.com/x", "2026-10-06T11:00:00Z"), NOW)).toEqual({
      kind: "open",
      url: "https://v.example.com/x",
    });
  });

  it("says when the visit opens if it is too early", () => {
    expect(videoLinkState(ok("https://v.example.com/x", "2026-10-06T13:00:00Z"), NOW)).toEqual({
      kind: "early",
      opensAt: "2026-10-06T13:00:00Z",
    });
  });

  it("tolerates failures and unsafe urls", () => {
    expect(videoLinkState({ ok: false, error: "Not available yet" }, NOW)).toEqual({
      kind: "unavailable",
      message: "Not available yet",
    });
    expect(videoLinkState(null, NOW).kind).toBe("unavailable");
    expect(videoLinkState(ok("javascript:alert(1)", "2026-10-06T11:00:00Z"), NOW).kind).toBe("unavailable");
  });
});

describe("booking validation", () => {
  const base = {
    doctorId: "d1",
    legacy: false,
    visitType: "in_person" as const,
    slotStart: "2026-10-07T10:00:00.000Z",
    legacySchedule: new Date(),
    reason: "Check-up",
    note: "",
  };

  it("accepts a slot booking", () => {
    expect(validateBooking(base)).toEqual({});
  });

  it("requires a slot for scheduled doctors and a future date for legacy doctors", () => {
    expect(validateBooking({ ...base, slotStart: undefined }).slotStart).toBeTruthy();
    const legacyPast = { ...base, legacy: true, legacySchedule: new Date(Date.now() - 60_000) };
    expect(validateBooking(legacyPast).legacySchedule).toBeTruthy();
    const legacyOk = { ...base, legacy: true, slotStart: undefined, legacySchedule: new Date(Date.now() + 3_600_000) };
    expect(validateBooking(legacyOk)).toEqual({});
  });

  it("requires a doctor and a reason", () => {
    const errors = validateBooking({ ...base, doctorId: "", reason: " " });
    expect(errors.doctorId).toBeTruthy();
    expect(errors.reason).toBeTruthy();
    expect(BookingFormSchema.safeParse({ ...base, visitType: "phone" }).success).toBe(false);
  });

  it("picks the default doctor", () => {
    const doctors = [
      { id: "d1", name: "John Green" },
      { id: "d2", name: "Jane Powell" },
    ];
    expect(pickDefaultDoctorId(doctors, { initialDoctorId: "d2", primaryPhysicianName: "John Green" })).toBe("d2");
    expect(pickDefaultDoctorId(doctors, { primaryPhysicianName: "John Green" })).toBe("d1");
    expect(pickDefaultDoctorId(doctors, { initialDoctorId: "zz" })).toBe("");
  });
});
