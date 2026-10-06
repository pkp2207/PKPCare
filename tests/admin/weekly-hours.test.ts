import { describe, expect, it } from "vitest";

import {
  addRange,
  copyDay,
  emptyModel,
  fromWeeklyHours,
  removeRange,
  summarizeDay,
  toWeeklyHours,
  updateRange,
  validateModel,
  weeklyMinutes,
} from "@/components/admin/weekly-hours";
import { WeeklyHoursSchema } from "@/lib/validation";

describe("weekly hours model", () => {
  it("round-trips the stored JSON shape and passes the server schema", () => {
    const stored = { mon: [["14:00", "17:00"], ["09:00", "13:00"]], sat: [] } as WeeklyHours;
    const model = fromWeeklyHours(stored);
    expect(model.mon).toEqual([
      { start: "09:00", end: "13:00" },
      { start: "14:00", end: "17:00" },
    ]);
    const out = toWeeklyHours(model);
    expect(out.mon).toEqual([["09:00", "13:00"], ["14:00", "17:00"]]);
    expect(out.sun).toEqual([]);
    expect(WeeklyHoursSchema.safeParse(out).success).toBe(true);
  });

  it("accepts touching ranges and 24:00 ends", () => {
    const model = { ...emptyModel(), tue: [{ start: "00:00", end: "12:00" }, { start: "12:00", end: "24:00" }] };
    expect(validateModel(model)).toEqual([]);
    expect(weeklyMinutes(model)).toBe(1440);
  });

  it("flags bad format, start>=end and overlaps", () => {
    const model = {
      ...emptyModel(),
      mon: [{ start: "9:00", end: "12:00" }],
      tue: [{ start: "13:00", end: "13:00" }],
      wed: [{ start: "09:00", end: "12:00" }, { start: "11:00", end: "15:00" }],
    };
    const errors = validateModel(model);
    expect(errors.find((e) => e.day === "mon")?.message).toMatch(/HH:MM/);
    expect(errors.find((e) => e.day === "tue")?.message).toMatch(/before/);
    expect(errors.find((e) => e.day === "wed")?.message).toMatch(/Overlaps/);
    // Server schema agrees on the overlap.
    expect(WeeklyHoursSchema.safeParse(toWeeklyHours({ ...emptyModel(), wed: model.wed })).success).toBe(false);
  });

  it("limits ranges per day to 6", () => {
    let model = emptyModel();
    for (let i = 0; i < 10; i += 1) model = addRange(model, "mon");
    expect(model.mon.length).toBeLessThanOrEqual(6);
    const errors = validateModel({ ...emptyModel(), mon: Array.from({ length: 7 }, (_, i) => ({ start: `${String(i).padStart(2, "0")}:00`, end: `${String(i).padStart(2, "0")}:30` })) });
    expect(errors.some((e) => /At most 6/.test(e.message))).toBe(true);
  });

  it("editing helpers are immutable", () => {
    const base = addRange(emptyModel(), "thu");
    const edited = updateRange(base, "thu", 0, { end: "18:00" });
    expect(base.thu[0].end).toBe("17:00");
    expect(edited.thu[0].end).toBe("18:00");
    expect(removeRange(edited, "thu", 0).thu).toEqual([]);
    const copied = copyDay(edited, "thu", ["fri", "thu"]);
    expect(copied.fri).toEqual(edited.thu);
    expect(copied.fri).not.toBe(edited.thu);
  });

  it("summarises days", () => {
    expect(summarizeDay([])).toBe("Closed");
    expect(summarizeDay([{ start: "09:00", end: "13:00" }, { start: "14:00", end: "17:00" }])).toBe("09:00-13:00, 14:00-17:00");
  });
});
