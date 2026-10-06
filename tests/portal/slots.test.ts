import { describe, expect, it } from "vitest";

import {
  availabilityWindow,
  dayKeyInZone,
  formatTimeInZone,
  groupSlotsByDay,
  hasMoreWindows,
  isSlotTakenError,
  MAX_AVAILABILITY_WINDOWS,
  mergeSlots,
  nextRadioIndex,
  patientLocalTimeNote,
  timeZoneLabel,
} from "@/components/portal/slots";

const slot = (start: string) => ({
  start,
  end: new Date(Date.parse(start) + 30 * 60_000).toISOString(),
});

describe("groupSlotsByDay", () => {
  it("groups by the doctor's calendar day, not UTC's", () => {
    // 20:00Z and 21:00Z on Oct 7 are already Oct 8 in Kolkata (+5:30).
    const days = groupSlotsByDay(
      [
        slot("2026-10-07T03:30:00Z"),
        slot("2026-10-07T20:00:00Z"),
        slot("2026-10-07T21:00:00Z"),
      ],
      "Asia/Kolkata"
    );
    expect(days.map((d) => d.key)).toEqual(["2026-10-07", "2026-10-08"]);
    expect(days[0].slots.map((s) => s.label)).toEqual(["9:00 AM"]);
    expect(days[1].slots.map((s) => s.label)).toEqual(["1:30 AM", "2:30 AM"]);
  });

  it("sorts, de-duplicates and ignores garbage", () => {
    const days = groupSlotsByDay(
      [slot("2026-10-07T15:00:00Z"), slot("2026-10-07T14:00:00Z"), slot("2026-10-07T14:00:00Z"), { start: "nope", end: "x" }],
      "UTC"
    );
    expect(days).toHaveLength(1);
    expect(days[0].slots.map((s) => s.label)).toEqual(["2:00 PM", "3:00 PM"]);
  });

  it("labels days and handles empty input", () => {
    const [day] = groupSlotsByDay([slot("2026-10-07T12:00:00Z")], "UTC");
    expect(day.label).toBe("Wed, Oct 7");
    expect(day.longLabel).toBe("Wednesday, October 7");
    expect(groupSlotsByDay([], "UTC")).toEqual([]);
  });

  it("falls back to UTC for an unknown timezone instead of throwing", () => {
    expect(formatTimeInZone("2026-10-07T12:00:00Z", "Mars/Base")).toBe("12:00 PM");
    expect(dayKeyInZone("2026-10-07T12:00:00Z", "Mars/Base")).toBe("2026-10-07");
  });

  it("respects DST in the doctor's zone", () => {
    // New York is UTC-4 in October (EDT) and UTC-5 in December (EST).
    expect(formatTimeInZone("2026-10-07T13:00:00Z", "America/New_York")).toBe("9:00 AM");
    expect(formatTimeInZone("2026-12-07T14:00:00Z", "America/New_York")).toBe("9:00 AM");
  });
});

describe("timezone labels", () => {
  it("shows zone name and GMT offset", () => {
    expect(timeZoneLabel("Asia/Kolkata", "2026-10-07T00:00:00Z")).toBe("Asia/Kolkata (GMT+5:30)");
    expect(timeZoneLabel("America/New_York", "2026-10-07T00:00:00Z")).toBe(
      "America/New York (GMT-4)"
    );
  });

  it("notes the patient's local time only when it differs", () => {
    const iso = "2026-10-07T03:30:00Z";
    expect(patientLocalTimeNote(iso, "Asia/Kolkata", "Asia/Kolkata")).toBeNull();
    expect(patientLocalTimeNote(iso, "Asia/Kolkata", "Asia/Calcutta")).toBeNull();
    const note = patientLocalTimeNote(iso, "Asia/Kolkata", "America/New_York");
    expect(note).toContain("11:30 PM");
    expect(note).toContain("your time zone");
  });
});

describe("availability windows", () => {
  const start = new Date("2026-10-07T00:00:00Z");

  it("builds adjacent 14-day windows", () => {
    const first = availabilityWindow(start, 0);
    const second = availabilityWindow(start, 1);
    expect(first.to.getTime() - first.from.getTime()).toBe(14 * 86_400_000);
    expect(second.from.getTime()).toBe(first.to.getTime());
  });

  it("never runs past the 90 day horizon", () => {
    const last = availabilityWindow(start, MAX_AVAILABILITY_WINDOWS - 1);
    expect(last.to.getTime()).toBe(start.getTime() + 90 * 86_400_000);
    expect(last.to.getTime() - last.from.getTime()).toBeLessThanOrEqual(14 * 86_400_000);
  });

  it("knows when there are more windows", () => {
    expect(hasMoreWindows(1)).toBe(true);
    expect(hasMoreWindows(MAX_AVAILABILITY_WINDOWS)).toBe(false);
  });

  it("merges without duplicates", () => {
    const merged = mergeSlots([slot("2026-10-07T10:00:00Z")], [slot("2026-10-07T10:00:00Z"), slot("2026-10-07T09:00:00Z")]);
    expect(merged.map((s) => s.start)).toEqual(["2026-10-07T09:00:00Z", "2026-10-07T10:00:00Z"]);
  });
});

describe("keyboard + errors", () => {
  it("moves through a radio group with wraparound", () => {
    expect(nextRadioIndex("ArrowRight", 2, 3)).toBe(0);
    expect(nextRadioIndex("ArrowDown", 0, 3)).toBe(1);
    expect(nextRadioIndex("ArrowLeft", 0, 3)).toBe(2);
    expect(nextRadioIndex("ArrowUp", 1, 3)).toBe(0);
    expect(nextRadioIndex("Home", 2, 3)).toBe(0);
    expect(nextRadioIndex("End", 0, 3)).toBe(2);
    expect(nextRadioIndex("Tab", 0, 3)).toBeNull();
    expect(nextRadioIndex("ArrowRight", 0, 0)).toBeNull();
  });

  it("recognises the server's slot-taken message", () => {
    expect(isSlotTakenError("That time was just taken. Please choose another time.")).toBe(true);
    expect(isSlotTakenError("Doctor not found")).toBe(false);
    expect(isSlotTakenError(null)).toBe(false);
  });
});
