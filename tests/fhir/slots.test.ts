import { describe, expect, it } from "vitest";

import { buildSlots } from "@/lib/fhir/slots";
import type { DoctorSchedule } from "@/lib/scheduling/schedule";

const doctor: DoctorSchedule = {
  id: "doc1",
  slotMinutes: 30,
  timezone: "UTC",
  weeklyHours: { thu: [["09:00", "11:00"]] },
  timeOff: [],
};

// 2026-10-08 is a Thursday.
const from = new Date("2026-10-08T00:00:00.000Z");
const to = new Date("2026-10-09T00:00:00.000Z");
const now = new Date("2026-10-01T00:00:00.000Z");

const run = (overrides: Partial<Parameters<typeof buildSlots>[0]> = {}) =>
  buildSlots({ doctor, held: [], legacyStarts: [], from, to, now, ...overrides });

const statuses = (slots: ReturnType<typeof run>) =>
  slots.map((s) => `${s.start.toISOString().slice(11, 16)}:${s.status}`);

describe("buildSlots", () => {
  it("expands weekly hours into free slots", () => {
    expect(statuses(run())).toEqual([
      "09:00:free",
      "09:30:free",
      "10:00:free",
      "10:30:free",
    ]);
  });

  it("marks booked slot documents busy and blocked ones busy-unavailable", () => {
    const slots = run({
      held: [
        { start: "2026-10-08T09:00:00.000Z", end: "2026-10-08T09:30:00.000Z", status: "booked" },
        { start: "2026-10-08T10:00:00.000Z", end: "2026-10-08T10:30:00.000Z", status: "blocked" },
      ],
    });
    expect(statuses(slots)).toEqual([
      "09:00:busy",
      "09:30:free",
      "10:00:busy-unavailable",
      "10:30:free",
    ]);
  });

  it("marks legacy appointments busy", () => {
    expect(statuses(run({ legacyStarts: ["2026-10-08T09:30:00.000Z"] }))[1]).toBe("09:30:busy");
  });

  it("time off is busy-unavailable", () => {
    const slots = run({
      doctor: {
        ...doctor,
        timeOff: [{ start: "2026-10-08T09:00:00.000Z", end: "2026-10-08T10:00:00.000Z" }],
      },
    });
    expect(statuses(slots).slice(0, 3)).toEqual([
      "09:00:busy-unavailable",
      "09:30:busy-unavailable",
      "10:00:free",
    ]);
  });

  it("slots inside the lead time or in the past are not free", () => {
    const soon = new Date("2026-10-08T09:10:00.000Z");
    expect(statuses(run({ now: soon }))).toEqual([
      "09:00:busy-unavailable",
      "09:30:busy-unavailable",
      "10:00:busy-unavailable",
      "10:30:free",
    ]);
  });

  it("reports held slots outside working hours as busy", () => {
    const slots = run({
      held: [
        { start: "2026-10-08T13:00:00.000Z", end: "2026-10-08T13:30:00.000Z", status: "booked" },
      ],
    });
    expect(statuses(slots).pop()).toBe("13:00:busy");
  });
});
