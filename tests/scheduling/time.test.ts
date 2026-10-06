import { describe, expect, it } from "vitest";

import {
  getLocalDate,
  getOffsetMs,
  getZonedParts,
  isValidTimeZone,
  parseHHMM,
  zonedWallTimeToUtc,
} from "@/lib/scheduling/time";

const iso = (ms: number) => new Date(ms).toISOString();
const wall = (tz: string, y: number, m: number, d: number, hh: number, mm = 0) =>
  iso(zonedWallTimeToUtc(tz, { year: y, month: m, day: d }, hh * 60 + mm));

describe("timezone helpers", () => {
  it("validates IANA names", () => {
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Asia/Kolkata")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone(undefined)).toBe(false);
  });

  it("reads zoned parts and offsets", () => {
    const parts = getZonedParts(Date.parse("2024-07-01T13:00:00Z"), "America/New_York");
    expect(parts).toMatchObject({ year: 2024, month: 7, day: 1, hour: 9, minute: 0, weekday: "mon" });
    expect(getOffsetMs(Date.parse("2024-07-01T13:00:00Z"), "America/New_York")).toBe(-4 * 3600_000);
    expect(getOffsetMs(Date.parse("2024-01-01T13:00:00Z"), "America/New_York")).toBe(-5 * 3600_000);
    expect(getOffsetMs(Date.parse("2024-01-01T00:00:00Z"), "Asia/Kolkata")).toBe(5.5 * 3600_000);
  });

  it("reports midnight as hour 0, not 24", () => {
    expect(getZonedParts(Date.parse("2024-07-01T00:00:00Z"), "UTC").hour).toBe(0);
  });

  it("local date differs from the UTC date across the dateline", () => {
    expect(getLocalDate(Date.parse("2024-06-30T21:00:00Z"), "Pacific/Auckland")).toEqual({
      year: 2024,
      month: 7,
      day: 1,
    });
  });

  it("parses HH:MM", () => {
    expect(parseHHMM("09:30")).toBe(570);
    expect(parseHHMM("24:00")).toBe(1440);
    expect(parseHHMM("24:01")).toBeNull();
    expect(parseHHMM("9:30")).toBeNull();
    expect(parseHHMM("25:00")).toBeNull();
    expect(parseHHMM(930)).toBeNull();
  });
});

describe("zonedWallTimeToUtc", () => {
  it("converts ordinary wall times", () => {
    expect(wall("UTC", 2024, 7, 1, 9)).toBe("2024-07-01T09:00:00.000Z");
    expect(wall("America/New_York", 2024, 7, 1, 9)).toBe("2024-07-01T13:00:00.000Z");
    expect(wall("America/New_York", 2024, 1, 15, 9)).toBe("2024-01-15T14:00:00.000Z");
    expect(wall("Asia/Kolkata", 2024, 7, 1, 9)).toBe("2024-07-01T03:30:00.000Z");
  });

  it("24:00 is next midnight", () => {
    expect(wall("UTC", 2024, 7, 1, 24)).toBe("2024-07-02T00:00:00.000Z");
  });

  it("keeps the same wall time across a DST change", () => {
    // 09:00 the day before and the day after US spring-forward (2024-03-10).
    expect(wall("America/New_York", 2024, 3, 9, 9)).toBe("2024-03-09T14:00:00.000Z");
    expect(wall("America/New_York", 2024, 3, 11, 9)).toBe("2024-03-11T13:00:00.000Z");
  });

  it("spring-forward gap resolves to just after the gap", () => {
    // 02:30 does not exist in New York on 2024-03-10; -> 03:30 EDT.
    expect(wall("America/New_York", 2024, 3, 10, 2, 30)).toBe("2024-03-10T07:30:00.000Z");
    // London gap is 01:00-02:00 on 2024-03-31; 01:30 -> 02:30 BST.
    expect(wall("Europe/London", 2024, 3, 31, 1, 30)).toBe("2024-03-31T01:30:00.000Z");
    // Sydney spring-forward 2024-10-06 02:00 -> 03:00.
    expect(wall("Australia/Sydney", 2024, 10, 6, 2, 30)).toBe("2024-10-05T16:30:00.000Z");
  });

  it("fall-back overlap resolves to the first occurrence", () => {
    // 01:30 happens twice in New York on 2024-11-03; first is EDT (UTC-4).
    expect(wall("America/New_York", 2024, 11, 3, 1, 30)).toBe("2024-11-03T05:30:00.000Z");
    // London 01:30 twice on 2024-10-27; first is BST (UTC+1).
    expect(wall("Europe/London", 2024, 10, 27, 1, 30)).toBe("2024-10-27T00:30:00.000Z");
  });

  it("round-trips through getZonedParts for ordinary times", () => {
    const ms = zonedWallTimeToUtc("Europe/Berlin", { year: 2024, month: 6, day: 15 }, 14 * 60 + 15);
    const p = getZonedParts(ms, "Europe/Berlin");
    expect([p.year, p.month, p.day, p.hour, p.minute]).toEqual([2024, 6, 15, 14, 15]);
  });
});
