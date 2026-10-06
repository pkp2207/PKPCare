// Pure scheduling math: candidate slots, working hours, time off, bookability.
// No I/O. All instants are UTC ms / Date; wall-clock rules live in the doctor's
// IANA timezone.

import {
  APPOINTMENT_CLOCK_SKEW_MINUTES,
  BOOKING_MAX_HORIZON_DAYS,
  BOOKING_MIN_LEAD_MINUTES,
  DEFAULT_SLOT_MINUTES,
  DEFAULT_TIMEZONE,
} from "@/constants";
import type { Doctor } from "@/types/appwrite.types";

import {
  addLocalDays,
  DAY_MS,
  getLocalDate,
  isValidTimeZone,
  LocalDate,
  MINUTE_MS,
  parseHHMM,
  WEEKDAY_KEYS,
  weekdayOfLocalDate,
  zonedWallTimeToUtc,
} from "./time";

export type TimeSlot = { start: Date; end: Date };
export type BusyInterval = { start: number; end: number };

/** Parsed, validated doctor scheduling profile. */
export type DoctorSchedule = {
  id: string;
  slotMinutes: number;
  timezone: string;
  weeklyHours: WeeklyHours;
  timeOff: TimeOffEntry[];
};

// ---------------------------------------------------------------------------
// Parsing (tolerant: malformed stored JSON degrades to "no hours / no time off"
// rather than throwing inside a request)
// ---------------------------------------------------------------------------

const parseJson = (raw: unknown): unknown => {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

export const parseWeeklyHours = (raw: unknown): WeeklyHours => {
  const value = parseJson(raw);
  const result: WeeklyHours = {};
  if (!value || typeof value !== "object") return result;

  for (const key of WEEKDAY_KEYS) {
    const list = (value as Record<string, unknown>)[key];
    if (!Array.isArray(list)) continue;
    const intervals: [string, string][] = [];
    for (const pair of list) {
      if (!Array.isArray(pair) || pair.length !== 2) continue;
      const from = parseHHMM(pair[0]);
      const to = parseHHMM(pair[1]);
      if (from === null || to === null || to <= from) continue;
      intervals.push([pair[0], pair[1]]);
    }
    intervals.sort((a, b) => (parseHHMM(a[0]) ?? 0) - (parseHHMM(b[0]) ?? 0));
    result[key] = intervals;
  }
  return result;
};

export const parseTimeOff = (raw: unknown): TimeOffEntry[] => {
  const value = parseJson(raw);
  if (!Array.isArray(value)) return [];
  const entries: TimeOffEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const { start, end, reason } = item as Record<string, unknown>;
    if (typeof start !== "string" || typeof end !== "string") continue;
    const s = Date.parse(start);
    const e = Date.parse(end);
    if (Number.isNaN(s) || Number.isNaN(e) || e <= s) continue;
    entries.push({
      start,
      end,
      ...(typeof reason === "string" ? { reason } : {}),
    });
  }
  return entries;
};

export const toDoctorSchedule = (
  doc: Pick<
    Doctor,
    "$id" | "slotMinutes" | "timezone" | "weeklyHours" | "timeOff"
  >
): DoctorSchedule => {
  const slotMinutes =
    Number.isInteger(doc.slotMinutes) && doc.slotMinutes > 0
      ? doc.slotMinutes
      : DEFAULT_SLOT_MINUTES;
  return {
    id: doc.$id,
    slotMinutes,
    timezone: isValidTimeZone(doc.timezone) ? doc.timezone : DEFAULT_TIMEZONE,
    weeklyHours: parseWeeklyHours(doc.weeklyHours),
    timeOff: parseTimeOff(doc.timeOff),
  };
};

// ---------------------------------------------------------------------------
// Working hours
// ---------------------------------------------------------------------------

type DayInterval = { start: number; end: number };

/** Working intervals (UTC ms) for one local calendar day of the doctor. */
const intervalsForLocalDate = (
  doctor: DoctorSchedule,
  date: LocalDate
): DayInterval[] => {
  const list = doctor.weeklyHours[weekdayOfLocalDate(date)] ?? [];
  const intervals: DayInterval[] = [];
  for (const [from, to] of list) {
    const fromMin = parseHHMM(from);
    const toMin = parseHHMM(to);
    if (fromMin === null || toMin === null || toMin <= fromMin) continue;
    const start = zonedWallTimeToUtc(doctor.timezone, date, fromMin);
    const end = zonedWallTimeToUtc(doctor.timezone, date, toMin);
    if (end > start) intervals.push({ start, end });
  }
  return intervals;
};

/** The working interval of start's local day that fully contains [start, end). */
const findContainingInterval = (
  doctor: DoctorSchedule,
  startMs: number,
  endMs: number
): DayInterval | null => {
  const date = getLocalDate(startMs, doctor.timezone);
  return (
    intervalsForLocalDate(doctor, date).find(
      (interval) => interval.start <= startMs && endMs <= interval.end
    ) ?? null
  );
};

const slotMs = (doctor: DoctorSchedule) => doctor.slotMinutes * MINUTE_MS;

/**
 * True when [start, end) (end defaults to start + slot length) lies inside one
 * of the doctor's working intervals on start's local day. Does not look at
 * time off or alignment.
 */
export const isWithinWorkingHours = (
  doctor: DoctorSchedule,
  start: Date,
  end?: Date
): boolean => {
  const startMs = start.getTime();
  if (Number.isNaN(startMs)) return false;
  const endMs = end ? end.getTime() : startMs + slotMs(doctor);
  return findContainingInterval(doctor, startMs, endMs) !== null;
};

// ---------------------------------------------------------------------------
// Time off
// ---------------------------------------------------------------------------

export const overlapsTimeOff = (
  slot: TimeSlot,
  timeOff: TimeOffEntry[]
): boolean =>
  timeOff.some((entry) => {
    const offStart = Date.parse(entry.start);
    const offEnd = Date.parse(entry.end);
    if (Number.isNaN(offStart) || Number.isNaN(offEnd)) return false;
    return slot.start.getTime() < offEnd && slot.end.getTime() > offStart;
  });

/** Removes every slot that overlaps any time-off window. */
export const subtractTimeOff = (
  slots: TimeSlot[],
  timeOff: TimeOffEntry[]
): TimeSlot[] =>
  timeOff.length === 0
    ? slots
    : slots.filter((slot) => !overlapsTimeOff(slot, timeOff));

// ---------------------------------------------------------------------------
// Candidate generation
// ---------------------------------------------------------------------------

/**
 * Every slot whose start lies in [from, to), ignoring bookings and time off.
 * Slots are stepped in absolute time from each working interval's start, so a
 * DST change inside an interval shortens/lengthens the day by real elapsed
 * time, never producing duplicate or missing wall-clock slots.
 */
export const generateCandidateSlots = (
  doctor: DoctorSchedule,
  fromDate: Date,
  toDate: Date
): TimeSlot[] => {
  const fromMs = fromDate.getTime();
  const toMs = toDate.getTime();
  if (Number.isNaN(fromMs) || Number.isNaN(toMs) || toMs <= fromMs) return [];

  const step = slotMs(doctor);
  const byStart = new Map<number, TimeSlot>();

  // One extra local day either side covers timezone/UTC date disagreement.
  const first = addLocalDays(getLocalDate(fromMs, doctor.timezone), -1);
  const last = addLocalDays(getLocalDate(toMs, doctor.timezone), 1);
  const spanDays = Math.round(
    (Date.UTC(last.year, last.month - 1, last.day) -
      Date.UTC(first.year, first.month - 1, first.day)) /
      DAY_MS
  );

  for (let i = 0; i <= spanDays; i += 1) {
    const date = addLocalDays(first, i);
    for (const interval of intervalsForLocalDate(doctor, date)) {
      for (
        let start = interval.start;
        start + step <= interval.end;
        start += step
      ) {
        if (start >= fromMs && start < toMs && !byStart.has(start)) {
          byStart.set(start, {
            start: new Date(start),
            end: new Date(start + step),
          });
        }
      }
    }
  }

  return Array.from(byStart.values()).sort(
    (a, b) => a.start.getTime() - b.start.getTime()
  );
};

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

/**
 * Bookable slots for a doctor in [from, to): candidates minus time off, minus
 * anything overlapping a busy interval (booked slot docs / legacy
 * appointments), clamped to [now + lead time, now + horizon].
 */
export const computeAvailability = ({
  doctor,
  from,
  to,
  busy,
  now,
}: {
  doctor: DoctorSchedule;
  from: Date;
  to: Date;
  busy: BusyInterval[];
  now: Date;
}): TimeSlot[] => {
  const earliest = now.getTime() + BOOKING_MIN_LEAD_MINUTES * MINUTE_MS;
  const latest = now.getTime() + BOOKING_MAX_HORIZON_DAYS * DAY_MS;
  const fromMs = Math.max(from.getTime(), earliest);
  const toMs = Math.min(to.getTime(), latest);
  if (toMs <= fromMs) return [];

  const candidates = subtractTimeOff(
    generateCandidateSlots(doctor, new Date(fromMs), new Date(toMs)),
    doctor.timeOff
  );
  return candidates.filter(
    (slot) =>
      !busy.some(
        (b) => slot.start.getTime() < b.end && slot.end.getTime() > b.start
      )
  );
};

// ---------------------------------------------------------------------------
// Bookability
// ---------------------------------------------------------------------------

export type BookabilityCode =
  | "invalid"
  | "past"
  | "lead_time"
  | "horizon"
  | "outside_hours"
  | "misaligned"
  | "time_off";

export type Bookability =
  | { ok: true; end: Date }
  | { ok: false; code: BookabilityCode; error: string };

const no = (code: BookabilityCode, error: string): Bookability => ({
  ok: false,
  code,
  error,
});

/**
 * Can `start` be booked with this doctor right now?
 *
 * mode "patient" (default): future, >= lead time, <= horizon, inside working
 *   hours, aligned to the slot grid, not in time off.
 * mode "staff": front desk / admin override - only rejects the past (with
 *   clock-skew tolerance); hours, lead time, horizon and time off are waived.
 */
export const validateSlotBookable = (
  doctor: DoctorSchedule,
  start: Date,
  now: Date,
  mode: "patient" | "staff" = "patient"
): Bookability => {
  const startMs = start.getTime();
  if (Number.isNaN(startMs)) return no("invalid", "Invalid appointment time");
  const end = new Date(startMs + slotMs(doctor));

  if (mode === "staff") {
    if (startMs < now.getTime() - APPOINTMENT_CLOCK_SKEW_MINUTES * MINUTE_MS) {
      return no("past", "Appointment time must be in the future");
    }
    return { ok: true, end };
  }

  if (startMs <= now.getTime()) {
    return no("past", "Appointment time must be in the future");
  }
  if (startMs < now.getTime() + BOOKING_MIN_LEAD_MINUTES * MINUTE_MS) {
    return no(
      "lead_time",
      `Appointments must be booked at least ${BOOKING_MIN_LEAD_MINUTES} minutes in advance`
    );
  }
  if (startMs > now.getTime() + BOOKING_MAX_HORIZON_DAYS * DAY_MS) {
    return no(
      "horizon",
      `Appointments can be booked at most ${BOOKING_MAX_HORIZON_DAYS} days ahead`
    );
  }

  const interval = findContainingInterval(doctor, startMs, end.getTime());
  if (!interval) {
    return no("outside_hours", "The doctor is not available at this time");
  }
  if ((startMs - interval.start) % slotMs(doctor) !== 0) {
    return no("misaligned", "Please choose one of the available time slots");
  }
  if (overlapsTimeOff({ start, end }, doctor.timeOff)) {
    return no("time_off", "The doctor is not available at this time");
  }
  return { ok: true, end };
};
