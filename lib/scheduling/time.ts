// Timezone math on top of Intl only (no dependencies). Pure and client-safe.
//
// Convention for wall-clock -> instant conversion across DST:
//  - a wall time that does not exist (spring-forward gap) resolves to the
//    instant AFTER the gap (02:30 becomes 03:30);
//  - a wall time that occurs twice (fall-back overlap) resolves to the FIRST
//    occurrence.

export const MINUTE_MS = 60 * 1000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

export const WEEKDAY_KEYS = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
] as const;

export type WeekdayKey = (typeof WEEKDAY_KEYS)[number];

export type ZonedParts = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: WeekdayKey;
};

const WEEKDAY_FROM_SHORT: Record<string, WeekdayKey> = {
  Sun: "sun",
  Mon: "mon",
  Tue: "tue",
  Wed: "wed",
  Thu: "thu",
  Fri: "fri",
  Sat: "sat",
};

const formatters = new Map<string, Intl.DateTimeFormat>();

const getFormatter = (timeZone: string) => {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
};

export const isValidTimeZone = (timeZone: unknown): timeZone is string => {
  if (typeof timeZone !== "string" || timeZone.length === 0) return false;
  try {
    getFormatter(timeZone);
    return true;
  } catch {
    return false;
  }
};

export const getZonedParts = (
  instant: Date | number,
  timeZone: string
): ZonedParts => {
  const ms = typeof instant === "number" ? instant : instant.getTime();
  const parts = getFormatter(timeZone).formatToParts(new Date(ms));
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const hour = Number(get("hour"));
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: hour === 24 ? 0 : hour,
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: WEEKDAY_FROM_SHORT[get("weekday")] ?? "sun",
  };
};

/** Offset of `timeZone` from UTC at the given instant, in ms (east = positive). */
export const getOffsetMs = (instant: Date | number, timeZone: string) => {
  const ms = typeof instant === "number" ? instant : instant.getTime();
  const p = getZonedParts(ms, timeZone);
  const wallAsUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second
  );
  return wallAsUtc - Math.floor(ms / 1000) * 1000;
};

export type LocalDate = { year: number; month: number; day: number };

export const getLocalDate = (
  instant: Date | number,
  timeZone: string
): LocalDate => {
  const { year, month, day } = getZonedParts(instant, timeZone);
  return { year, month, day };
};

export const addLocalDays = (date: LocalDate, days: number): LocalDate => {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
};

export const weekdayOfLocalDate = (date: LocalDate): WeekdayKey =>
  WEEKDAY_KEYS[new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay()];

/**
 * Instant (ms since epoch) at which the wall clock in `timeZone` reads
 * `date` + `minutesOfDay` (0..1440; 1440 means next midnight).
 * See the DST convention at the top of this file.
 */
export const zonedWallTimeToUtc = (
  timeZone: string,
  date: LocalDate,
  minutesOfDay: number
): number => {
  const wall = Date.UTC(
    date.year,
    date.month - 1,
    date.day,
    0,
    minutesOfDay,
    0
  );
  // Offsets a day either side bracket any transition near `wall`.
  const before = getOffsetMs(wall - DAY_MS, timeZone);
  const after = getOffsetMs(wall + DAY_MS, timeZone);
  const candidates = Array.from(new Set([wall - before, wall - after])).sort(
    (a, b) => a - b
  );
  const exact = candidates.find(
    (candidate) => candidate + getOffsetMs(candidate, timeZone) === wall
  );
  // No exact match => the wall time falls in a spring-forward gap; the
  // pre-transition offset lands just after the gap.
  return exact ?? wall - before;
};

/** "HH:MM" -> minutes since midnight (0..1440), or null if malformed. "24:00" is allowed. */
export const parseHHMM = (value: unknown): number | null => {
  if (typeof value !== "string") return null;
  const match = /^([01]\d|2[0-4]):([0-5]\d)$/.exec(value);
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes > 1440 ? null : minutes;
};
