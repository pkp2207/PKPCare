import { describe, expect, it } from "vitest";

import {
  computeAvailability,
  DoctorSchedule,
  generateCandidateSlots,
  isWithinWorkingHours,
  parseTimeOff,
  parseWeeklyHours,
  subtractTimeOff,
  toDoctorSchedule,
  validateSlotBookable,
} from "@/lib/scheduling/schedule";

const WEEKDAYS: [string, string][] = [["09:00", "17:00"]];
const workweek: WeeklyHours = {
  mon: WEEKDAYS,
  tue: WEEKDAYS,
  wed: WEEKDAYS,
  thu: WEEKDAYS,
  fri: WEEKDAYS,
};

const doctor = (over: Partial<DoctorSchedule> = {}): DoctorSchedule => ({
  id: "doc1",
  slotMinutes: 30,
  timezone: "UTC",
  weeklyHours: workweek,
  timeOff: [],
  ...over,
});

const d = (s: string) => new Date(s);
const starts = (slots: { start: Date }[]) => slots.map((s) => s.start.toISOString());

describe("parsing", () => {
  it("drops malformed hours and tolerates bad JSON", () => {
    expect(parseWeeklyHours("not json")).toEqual({});
    expect(parseWeeklyHours(null)).toEqual({});
    const parsed = parseWeeklyHours(
      JSON.stringify({ mon: [["09:00", "17:00"], ["18:00", "17:00"], ["x", "y"]], funday: [["09:00", "10:00"]] })
    );
    expect(parsed).toEqual({ mon: [["09:00", "17:00"]] });
  });

  it("parses time off and ignores invalid entries", () => {
    const parsed = parseTimeOff(
      JSON.stringify([
        { start: "2026-10-08T00:00:00Z", end: "2026-10-09T00:00:00Z", reason: "leave" },
        { start: "2026-10-09T00:00:00Z", end: "2026-10-08T00:00:00Z" },
        { start: "bad", end: "worse" },
      ])
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0].reason).toBe("leave");
  });

  it("toDoctorSchedule falls back for bad timezone and slot length", () => {
    const schedule = toDoctorSchedule({
      $id: "x",
      slotMinutes: 0,
      timezone: "Nope/Zone",
      weeklyHours: JSON.stringify({ mon: [["09:00", "10:00"]] }),
      timeOff: "[]",
    });
    expect(schedule.slotMinutes).toBe(30);
    expect(schedule.timezone).toBe("UTC");
    expect(schedule.weeklyHours.mon).toEqual([["09:00", "10:00"]]);
  });
});

describe("generateCandidateSlots", () => {
  it("generates a weekday of 30-minute slots and nothing on weekends", () => {
    // Wed 2026-10-07 .. Sun 2026-10-11 00:00Z
    const slots = generateCandidateSlots(doctor(), d("2026-10-07T00:00:00Z"), d("2026-10-11T00:00:00Z"));
    expect(slots).toHaveLength(16 * 3); // Wed, Thu, Fri
    expect(slots[0].start.toISOString()).toBe("2026-10-07T09:00:00.000Z");
    expect(slots[0].end.toISOString()).toBe("2026-10-07T09:30:00.000Z");
    expect(slots[15].start.toISOString()).toBe("2026-10-07T16:30:00.000Z");
    expect(slots.some((s) => s.start.getUTCDay() === 6 || s.start.getUTCDay() === 0)).toBe(false);
  });

  it("respects the [from, to) window and returns [] for an empty window", () => {
    const slots = generateCandidateSlots(doctor(), d("2026-10-07T10:00:00Z"), d("2026-10-07T11:00:00Z"));
    expect(starts(slots)).toEqual(["2026-10-07T10:00:00.000Z", "2026-10-07T10:30:00.000Z"]);
    expect(generateCandidateSlots(doctor(), d("2026-10-07T10:00:00Z"), d("2026-10-07T10:00:00Z"))).toEqual([]);
  });

  it("supports multiple intervals per day (lunch break)", () => {
    const lunch = doctor({ weeklyHours: { wed: [["09:00", "13:00"], ["14:00", "17:00"]] } });
    const slots = generateCandidateSlots(lunch, d("2026-10-07T00:00:00Z"), d("2026-10-08T00:00:00Z"));
    expect(slots).toHaveLength(8 + 6);
    expect(starts(slots)).not.toContain("2026-10-07T13:00:00.000Z");
    expect(starts(slots)).toContain("2026-10-07T14:00:00.000Z");
  });

  it("drops a trailing partial slot (45-minute slots in 8 hours = 10)", () => {
    const slots = generateCandidateSlots(doctor({ slotMinutes: 45 }), d("2026-10-07T00:00:00Z"), d("2026-10-08T00:00:00Z"));
    expect(slots).toHaveLength(10);
    expect(slots[9].end.toISOString()).toBe("2026-10-07T16:30:00.000Z");
  });

  it("uses the doctor's wall clock (Asia/Kolkata half-hour offset)", () => {
    const kolkata = doctor({ timezone: "Asia/Kolkata" });
    const slots = generateCandidateSlots(kolkata, d("2026-10-07T00:00:00Z"), d("2026-10-08T00:00:00Z"));
    expect(slots).toHaveLength(16);
    expect(slots[0].start.toISOString()).toBe("2026-10-07T03:30:00.000Z");
  });

  it("handles a doctor whose local day straddles the UTC date (Pacific/Auckland)", () => {
    // Monday 2026-10-12 09:00 NZDT (UTC+13) = Sunday 2026-10-11T20:00Z.
    const nz = doctor({ timezone: "Pacific/Auckland" });
    const slots = generateCandidateSlots(nz, d("2026-10-11T00:00:00Z"), d("2026-10-12T06:00:00Z"));
    expect(slots).toHaveLength(16);
    expect(slots[0].start.toISOString()).toBe("2026-10-11T20:00:00.000Z");
  });

  it("keeps local 09:00 across US spring-forward", () => {
    const ny = doctor({ timezone: "America/New_York" });
    const fri = generateCandidateSlots(ny, d("2024-03-08T00:00:00Z"), d("2024-03-09T00:00:00Z"));
    const mon = generateCandidateSlots(ny, d("2024-03-11T00:00:00Z"), d("2024-03-12T00:00:00Z"));
    expect(fri[0].start.toISOString()).toBe("2024-03-08T14:00:00.000Z"); // EST
    expect(mon[0].start.toISOString()).toBe("2024-03-11T13:00:00.000Z"); // EDT
  });

  it("spring-forward day has one fewer real hour", () => {
    const ny = doctor({ timezone: "America/New_York", slotMinutes: 60, weeklyHours: { sun: [["00:00", "06:00"]] } });
    const slots = generateCandidateSlots(ny, d("2024-03-10T00:00:00Z"), d("2024-03-11T12:00:00Z"));
    expect(slots).toHaveLength(5);
    expect(new Set(starts(slots)).size).toBe(5);
  });

  it("fall-back day has one extra real hour", () => {
    const ny = doctor({ timezone: "America/New_York", slotMinutes: 60, weeklyHours: { sun: [["00:00", "06:00"]] } });
    const slots = generateCandidateSlots(ny, d("2024-11-03T00:00:00Z"), d("2024-11-04T12:00:00Z"));
    expect(slots).toHaveLength(7);
    expect(new Set(starts(slots)).size).toBe(7);
  });

  it("never emits a duplicated start when the fall-back hour repeats", () => {
    const ny = doctor({ timezone: "America/New_York", slotMinutes: 30, weeklyHours: { sun: [["00:00", "04:00"]] } });
    const slots = generateCandidateSlots(ny, d("2024-11-03T00:00:00Z"), d("2024-11-04T00:00:00Z"));
    expect(slots).toHaveLength(10); // 5 real hours * 2
    expect(new Set(starts(slots)).size).toBe(10);
  });

  it("supports an interval ending at 24:00", () => {
    const late = doctor({ weeklyHours: { wed: [["22:00", "24:00"]] } });
    const slots = generateCandidateSlots(late, d("2026-10-07T00:00:00Z"), d("2026-10-09T00:00:00Z"));
    expect(slots).toHaveLength(4);
    expect(slots[3].end.toISOString()).toBe("2026-10-08T00:00:00.000Z");
  });
});

describe("isWithinWorkingHours", () => {
  it("requires the whole slot to fit", () => {
    const doc = doctor();
    expect(isWithinWorkingHours(doc, d("2026-10-07T09:00:00Z"))).toBe(true);
    expect(isWithinWorkingHours(doc, d("2026-10-07T16:30:00Z"))).toBe(true);
    expect(isWithinWorkingHours(doc, d("2026-10-07T16:45:00Z"))).toBe(false);
    expect(isWithinWorkingHours(doc, d("2026-10-07T08:30:00Z"))).toBe(false);
    expect(isWithinWorkingHours(doc, d("2026-10-10T10:00:00Z"))).toBe(false); // Saturday
    expect(isWithinWorkingHours(doc, new Date("nope"))).toBe(false);
  });

  it("does not let a slot straddle a lunch break", () => {
    const lunch = doctor({ weeklyHours: { wed: [["09:00", "13:00"], ["14:00", "17:00"]] } });
    expect(isWithinWorkingHours(lunch, d("2026-10-07T12:30:00Z"))).toBe(true);
    expect(isWithinWorkingHours(lunch, d("2026-10-07T12:45:00Z"))).toBe(false);
    expect(isWithinWorkingHours(lunch, d("2026-10-07T13:30:00Z"))).toBe(false);
  });

  it("evaluates in the doctor's timezone", () => {
    const ny = doctor({ timezone: "America/New_York" });
    expect(isWithinWorkingHours(ny, d("2026-10-07T13:00:00Z"))).toBe(true); // 09:00 EDT
    expect(isWithinWorkingHours(ny, d("2026-10-07T12:30:00Z"))).toBe(false); // 08:30 EDT
  });
});

describe("subtractTimeOff", () => {
  const slots = generateCandidateSlots(doctor(), d("2026-10-07T00:00:00Z"), d("2026-10-08T00:00:00Z"));

  it("removes every overlapping slot, half-open at the edges", () => {
    const result = subtractTimeOff(slots, [
      { start: "2026-10-07T10:15:00Z", end: "2026-10-07T11:00:00Z" },
    ]);
    const s = starts(result);
    expect(s).not.toContain("2026-10-07T10:00:00.000Z"); // overlaps 10:15
    expect(s).not.toContain("2026-10-07T10:30:00.000Z");
    expect(s).toContain("2026-10-07T11:00:00.000Z"); // starts exactly at the end
    expect(s).toContain("2026-10-07T09:30:00.000Z");
  });

  it("is a no-op without time off and ignores garbage entries", () => {
    expect(subtractTimeOff(slots, [])).toBe(slots);
    expect(subtractTimeOff(slots, [{ start: "x", end: "y" }])).toHaveLength(slots.length);
  });

  it("handles multi-day leave", () => {
    const week = generateCandidateSlots(doctor(), d("2026-10-07T00:00:00Z"), d("2026-10-10T00:00:00Z"));
    const result = subtractTimeOff(week, [{ start: "2026-10-08T00:00:00Z", end: "2026-10-09T00:00:00Z" }]);
    expect(result).toHaveLength(32);
  });
});

describe("validateSlotBookable", () => {
  const now = d("2026-10-07T08:00:00Z"); // Wednesday

  it("accepts an aligned future slot inside working hours", () => {
    const result = validateSlotBookable(doctor(), d("2026-10-08T10:00:00Z"), now);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.end.toISOString()).toBe("2026-10-08T10:30:00.000Z");
  });

  it("rejects the past and invalid dates", () => {
    expect(validateSlotBookable(doctor(), d("2026-10-07T07:00:00Z"), now)).toMatchObject({ ok: false, code: "past" });
    expect(validateSlotBookable(doctor(), d("2026-10-07T08:00:00Z"), now)).toMatchObject({ ok: false, code: "past" });
    expect(validateSlotBookable(doctor(), new Date("x"), now)).toMatchObject({ ok: false, code: "invalid" });
  });

  it("enforces the 60-minute lead time (boundary inclusive)", () => {
    expect(validateSlotBookable(doctor(), d("2026-10-07T08:30:00Z"), now)).toMatchObject({ ok: false, code: "lead_time" });
    expect(validateSlotBookable(doctor(), d("2026-10-07T08:59:00Z"), now)).toMatchObject({ ok: false, code: "lead_time" });
    expect(validateSlotBookable(doctor(), d("2026-10-07T09:00:00Z"), now).ok).toBe(true);
  });

  it("enforces the 90-day horizon", () => {
    // now + 90d = 2027-01-05T08:00Z
    expect(validateSlotBookable(doctor(), d("2027-01-04T10:00:00Z"), now).ok).toBe(true); // Monday, inside
    expect(validateSlotBookable(doctor(), d("2027-01-06T10:00:00Z"), now)).toMatchObject({ ok: false, code: "horizon" });
  });

  it("rejects outside working hours and non-working days", () => {
    expect(validateSlotBookable(doctor(), d("2026-10-08T18:00:00Z"), now)).toMatchObject({ ok: false, code: "outside_hours" });
    expect(validateSlotBookable(doctor(), d("2026-10-08T16:45:00Z"), now)).toMatchObject({ ok: false, code: "outside_hours" });
    expect(validateSlotBookable(doctor(), d("2026-10-10T10:00:00Z"), now)).toMatchObject({ ok: false, code: "outside_hours" });
  });

  it("rejects times not aligned to the slot grid", () => {
    expect(validateSlotBookable(doctor(), d("2026-10-08T10:15:00Z"), now)).toMatchObject({ ok: false, code: "misaligned" });
    expect(validateSlotBookable(doctor(), d("2026-10-08T10:00:30Z"), now)).toMatchObject({ ok: false, code: "misaligned" });
    expect(validateSlotBookable(doctor({ slotMinutes: 15 }), d("2026-10-08T10:15:00Z"), now).ok).toBe(true);
  });

  it("aligns to the interval start, not to the clock (after a lunch break at :15)", () => {
    const odd = doctor({ weeklyHours: { thu: [["09:15", "12:15"]] } });
    expect(validateSlotBookable(odd, d("2026-10-08T09:15:00Z"), now).ok).toBe(true);
    expect(validateSlotBookable(odd, d("2026-10-08T09:30:00Z"), now)).toMatchObject({ ok: false, code: "misaligned" });
  });

  it("rejects time off", () => {
    const off = doctor({ timeOff: [{ start: "2026-10-08T00:00:00Z", end: "2026-10-09T00:00:00Z" }] });
    expect(validateSlotBookable(off, d("2026-10-08T10:00:00Z"), now)).toMatchObject({ ok: false, code: "time_off" });
    expect(validateSlotBookable(off, d("2026-10-09T10:00:00Z"), now).ok).toBe(true);
  });

  it("staff mode waives hours, lead time, horizon and time off but not the past", () => {
    const off = doctor({ timeOff: [{ start: "2026-10-08T00:00:00Z", end: "2026-10-09T00:00:00Z" }] });
    expect(validateSlotBookable(off, d("2026-10-08T23:10:00Z"), now, "staff").ok).toBe(true);
    expect(validateSlotBookable(off, d("2026-10-07T08:10:00Z"), now, "staff").ok).toBe(true);
    expect(validateSlotBookable(off, d("2026-10-07T07:00:00Z"), now, "staff")).toMatchObject({ ok: false, code: "past" });
  });

  describe("DST", () => {
    const ny = doctor({ timezone: "America/New_York" });

    it("working hours follow the wall clock before and after spring-forward", () => {
      const early = d("2024-03-01T12:00:00Z");
      // Mon 2024-03-11 is EDT: 09:00 local = 13:00Z.
      expect(validateSlotBookable(ny, d("2024-03-11T13:00:00Z"), early).ok).toBe(true);
      expect(validateSlotBookable(ny, d("2024-03-11T12:30:00Z"), early)).toMatchObject({ ok: false, code: "outside_hours" });
      // Fri 2024-03-08 is still EST: 09:00 local = 14:00Z.
      expect(validateSlotBookable(ny, d("2024-03-08T14:00:00Z"), early).ok).toBe(true);
      expect(validateSlotBookable(ny, d("2024-03-08T13:00:00Z"), early)).toMatchObject({ ok: false, code: "outside_hours" });
    });

    it("working hours follow the wall clock after fall-back", () => {
      const early = d("2024-10-20T12:00:00Z");
      // Mon 2024-11-04 is EST: 09:00 local = 14:00Z.
      expect(validateSlotBookable(ny, d("2024-11-04T14:00:00Z"), early).ok).toBe(true);
      expect(validateSlotBookable(ny, d("2024-11-04T13:00:00Z"), early)).toMatchObject({ ok: false, code: "outside_hours" });
    });

    it("an interval spanning the fall-back hour stays aligned in real time", () => {
      const dst = doctor({ timezone: "America/New_York", slotMinutes: 60, weeklyHours: { sun: [["00:00", "06:00"]] } });
      const early = d("2024-10-20T12:00:00Z");
      // Slots at 04:00Z,05:00Z,06:00Z (second 01:00 EST),... 10:00Z.
      expect(validateSlotBookable(dst, d("2024-11-03T06:00:00Z"), early).ok).toBe(true);
      expect(validateSlotBookable(dst, d("2024-11-03T10:00:00Z"), early).ok).toBe(true);
      expect(validateSlotBookable(dst, d("2024-11-03T11:00:00Z"), early)).toMatchObject({ ok: false, code: "outside_hours" });
    });
  });
});

describe("computeAvailability", () => {
  const now = d("2026-10-07T08:00:00Z");

  it("clamps to lead time and removes busy intervals and time off", () => {
    const doc = doctor({ timeOff: [{ start: "2026-10-07T13:00:00Z", end: "2026-10-07T14:00:00Z" }] });
    const busy = [{ start: d("2026-10-07T10:00:00Z").getTime(), end: d("2026-10-07T10:30:00Z").getTime() }];
    const open = computeAvailability({
      doctor: doc,
      from: d("2026-10-07T00:00:00Z"),
      to: d("2026-10-08T00:00:00Z"),
      busy,
      now,
    });
    const s = starts(open);
    expect(s[0]).toBe("2026-10-07T09:00:00.000Z"); // 08:xx is inside lead time / before hours
    expect(s).not.toContain("2026-10-07T10:00:00.000Z");
    expect(s).not.toContain("2026-10-07T13:00:00.000Z");
    expect(s).not.toContain("2026-10-07T13:30:00.000Z");
    expect(s).toContain("2026-10-07T10:30:00.000Z");
    expect(s).toContain("2026-10-07T14:00:00.000Z");
  });

  it("returns nothing beyond the booking horizon", () => {
    const open = computeAvailability({
      doctor: doctor(),
      from: d("2027-02-01T00:00:00Z"),
      to: d("2027-02-05T00:00:00Z"),
      busy: [],
      now,
    });
    expect(open).toEqual([]);
  });

  it("a legacy busy interval blocks overlapping slots only", () => {
    const start = d("2026-10-08T10:15:00Z").getTime();
    const open = computeAvailability({
      doctor: doctor(),
      from: d("2026-10-08T09:00:00Z"),
      to: d("2026-10-08T12:00:00Z"),
      busy: [{ start, end: start + 1800_000 }],
      now,
    });
    const s = starts(open);
    expect(s).not.toContain("2026-10-08T10:00:00.000Z");
    expect(s).not.toContain("2026-10-08T10:30:00.000Z");
    expect(s).toContain("2026-10-08T11:00:00.000Z");
  });
});
