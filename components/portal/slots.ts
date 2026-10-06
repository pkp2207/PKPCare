// Pure slot helpers for the booking / reschedule pickers. No React, no server
// imports: safe on the client and unit tested (tests/portal/slots.test.ts).
//
// Slots arrive from `getAvailability` as ISO instants. Everything the patient
// sees is formatted in the DOCTOR's timezone (the working hours are wall-clock
// there), and the timezone is always labelled so nothing is ambiguous.

import { AVAILABILITY_MAX_WINDOW_DAYS, BOOKING_MAX_HORIZON_DAYS } from "@/constants";
import { DAY_MS, getLocalDate, isValidTimeZone } from "@/lib/scheduling/time";

export type Slot = { start: string; end: string };

export type DaySlot = { start: string; end: string; label: string };

export type SlotDay = {
  /** YYYY-MM-DD in the doctor's timezone. */
  key: string;
  /** Short label for a day button, e.g. "Wed, Oct 7". */
  label: string;
  /** Full label for headings / announcements, e.g. "Wednesday, October 7". */
  longLabel: string;
  slots: DaySlot[];
};

const safeZone = (timeZone: string) => (isValidTimeZone(timeZone) ? timeZone : "UTC");

const pad = (n: number) => String(n).padStart(2, "0");

/** YYYY-MM-DD of `iso` in `timeZone`. */
export const dayKeyInZone = (iso: string | Date, timeZone: string): string => {
  const { year, month, day } = getLocalDate(new Date(iso), safeZone(timeZone));
  return `${year}-${pad(month)}-${pad(day)}`;
};

/** "9:00 AM" in `timeZone`. */
export const formatTimeInZone = (iso: string | Date, timeZone: string): string =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: safeZone(timeZone),
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));

/** "Wed, Oct 7" in `timeZone`. */
export const formatDayShort = (iso: string | Date, timeZone: string): string =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: safeZone(timeZone),
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));

/** "Wednesday, October 7" in `timeZone`. */
export const formatDayLong = (iso: string | Date, timeZone: string): string =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: safeZone(timeZone),
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(iso));

/** "Wed, Oct 7, 2026 at 9:00 AM" in `timeZone`. */
export const formatSlotLong = (iso: string | Date, timeZone: string): string => {
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: safeZone(timeZone),
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(iso));
  return `${date} at ${formatTimeInZone(iso, timeZone)}`;
};

/** "GMT+5:30" style offset for `timeZone` at `at` (falls back to the zone name). */
export const timeZoneOffsetLabel = (timeZone: string, at: Date | string = new Date()): string => {
  const zone = safeZone(timeZone);
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "shortOffset",
    }).formatToParts(new Date(at));
    return parts.find((part) => part.type === "timeZoneName")?.value ?? zone;
  } catch {
    return zone;
  }
};

/** "Asia/Kolkata (GMT+5:30)". */
export const timeZoneLabel = (timeZone: string, at: Date | string = new Date()): string => {
  const zone = safeZone(timeZone);
  return `${zone.replace(/_/g, " ")} (${timeZoneOffsetLabel(zone, at)})`;
};

/**
 * Groups slots by calendar day in the doctor's timezone. Sorted, de-duplicated
 * by start instant, and days with no slots never appear.
 */
export const groupSlotsByDay = (slots: readonly Slot[], timeZone: string): SlotDay[] => {
  const unique = new Map<number, Slot>();
  for (const slot of slots) {
    const ms = Date.parse(slot.start);
    if (!Number.isNaN(ms) && !unique.has(ms)) unique.set(ms, slot);
  }

  const sorted = Array.from(unique.entries()).sort((a, b) => a[0] - b[0]);
  const days: SlotDay[] = [];
  const byKey = new Map<string, SlotDay>();

  for (const [, slot] of sorted) {
    const key = dayKeyInZone(slot.start, timeZone);
    let day = byKey.get(key);
    if (!day) {
      day = {
        key,
        label: formatDayShort(slot.start, timeZone),
        longLabel: formatDayLong(slot.start, timeZone),
        slots: [],
      };
      byKey.set(key, day);
      days.push(day);
    }
    day.slots.push({
      start: slot.start,
      end: slot.end,
      label: formatTimeInZone(slot.start, timeZone),
    });
  }
  return days;
};

/** Merges two slot lists, de-duplicated by start and sorted. */
export const mergeSlots = (a: readonly Slot[], b: readonly Slot[]): Slot[] => {
  const map = new Map<number, Slot>();
  for (const slot of [...a, ...b]) {
    const ms = Date.parse(slot.start);
    if (!Number.isNaN(ms)) map.set(ms, slot);
  }
  return Array.from(map.entries())
    .sort((x, y) => x[0] - y[0])
    .map(([, slot]) => slot);
};

/** How many windows of `AVAILABILITY_MAX_WINDOW_DAYS` fit in the booking horizon. */
export const MAX_AVAILABILITY_WINDOWS = Math.ceil(
  BOOKING_MAX_HORIZON_DAYS / AVAILABILITY_MAX_WINDOW_DAYS
);

/**
 * The index-th consecutive availability window starting at `start`. Windows are
 * exactly `AVAILABILITY_MAX_WINDOW_DAYS` long (the server limit) and never run
 * past the booking horizon.
 */
export const availabilityWindow = (start: Date, index: number) => {
  const horizonEnd = start.getTime() + BOOKING_MAX_HORIZON_DAYS * DAY_MS;
  const from = start.getTime() + index * AVAILABILITY_MAX_WINDOW_DAYS * DAY_MS;
  const to = Math.min(from + AVAILABILITY_MAX_WINDOW_DAYS * DAY_MS, horizonEnd);
  return { from: new Date(from), to: new Date(to) };
};

export const hasMoreWindows = (loadedWindows: number) => loadedWindows < MAX_AVAILABILITY_WINDOWS;

/** Index to focus/select after an arrow key in a radio group, or null to ignore. */
export const nextRadioIndex = (key: string, current: number, length: number): number | null => {
  if (length <= 0) return null;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (current + 1) % length;
    case "ArrowLeft":
    case "ArrowUp":
      return (current - 1 + length) % length;
    case "Home":
      return 0;
    case "End":
      return length - 1;
    default:
      return null;
  }
};

/** True for the server's "slot was just taken" booking conflict messages. */
export const isSlotTakenError = (message: string | null | undefined): boolean =>
  typeof message === "string" && /just taken|no longer available|already booked/i.test(message);

/** The patient's own timezone (browser only; "UTC" where unavailable). */
export const browserTimeZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

/** "8:30 PM" in the patient's zone when it differs from the doctor's, else null. */
export const patientLocalTimeNote = (
  iso: string,
  doctorZone: string,
  patientZone: string
): string | null => {
  const a = safeZone(doctorZone);
  const b = safeZone(patientZone);
  if (a === b) return null;
  const sameOffset =
    timeZoneOffsetLabel(a, iso) === timeZoneOffsetLabel(b, iso);
  if (sameOffset) return null;
  return `${formatSlotLong(iso, b)} in your time zone (${timeZoneLabel(b, iso)})`;
};
