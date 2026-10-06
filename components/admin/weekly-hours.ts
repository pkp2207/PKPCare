// Editor model for a doctor's weekly working hours. Pure (no React, no I/O):
// converts to/from the F2 `weeklyHours` JSON shape and validates edits with the
// same rules the server enforces (lib/validation WeeklyHoursSchema).
import { parseHHMM } from "@/lib/scheduling/time";

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

/** Display order (Monday first). */
export const WEEK_ORDER: readonly Weekday[] = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
];

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

export const MAX_RANGES_PER_DAY = 6;

export type HoursRange = { start: string; end: string };
export type WeeklyModel = Record<Weekday, HoursRange[]>;

export const emptyModel = (): WeeklyModel => ({
  mon: [],
  tue: [],
  wed: [],
  thu: [],
  fri: [],
  sat: [],
  sun: [],
});

const byStart = (a: HoursRange, b: HoursRange) =>
  (parseHHMM(a.start) ?? 0) - (parseHHMM(b.start) ?? 0);

/** Stored `weeklyHours` (already parsed) to the editable model. Unknown keys are ignored. */
export const fromWeeklyHours = (
  weekly: Partial<Record<string, [string, string][]>> | null | undefined
): WeeklyModel => {
  const model = emptyModel();
  if (!weekly) return model;
  for (const day of WEEK_ORDER) {
    const list = weekly[day];
    if (!Array.isArray(list)) continue;
    model[day] = list
      .filter((pair) => Array.isArray(pair) && pair.length === 2)
      .map(([start, end]) => ({ start, end }))
      .sort(byStart);
  }
  return model;
};

/** Editable model to the JSON shape `upsertDoctor` expects (sorted, all 7 keys). */
export const toWeeklyHours = (model: WeeklyModel): WeeklyHours => {
  const out: WeeklyHours = {};
  for (const day of WEEK_ORDER) {
    out[day] = [...model[day]]
      .sort(byStart)
      .map((range) => [range.start, range.end] as [string, string]);
  }
  return out;
};

export type HoursError = {
  day: Weekday;
  /** Index into the day's (unsorted) range list; undefined for day-level errors. */
  index?: number;
  message: string;
};

/**
 * Checks: HH:MM (00:00-24:00) format, start before end, no overlaps (touching
 * ranges are fine), at most 6 ranges per day. Returns every problem found.
 */
export const validateModel = (model: WeeklyModel): HoursError[] => {
  const errors: HoursError[] = [];
  for (const day of WEEK_ORDER) {
    const ranges = model[day];
    if (ranges.length > MAX_RANGES_PER_DAY) {
      errors.push({
        day,
        message: `At most ${MAX_RANGES_PER_DAY} ranges per day`,
      });
    }

    const valid: { index: number; start: number; end: number }[] = [];
    ranges.forEach((range, index) => {
      const start = parseHHMM(range.start);
      const end = parseHHMM(range.end);
      if (start === null || end === null) {
        errors.push({ day, index, message: "Use HH:MM (00:00 to 24:00)" });
      } else if (end <= start) {
        errors.push({ day, index, message: "Start must be before end" });
      } else {
        valid.push({ index, start, end });
      }
    });

    valid.sort((a, b) => a.start - b.start);
    for (let i = 1; i < valid.length; i += 1) {
      if (valid[i].start < valid[i - 1].end) {
        errors.push({
          day,
          index: valid[i].index,
          message: "Overlaps another range",
        });
      }
    }
  }
  return errors;
};

const toHHMM = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

/** Appends a sensible new range: after the last end (1h), else 09:00-17:00. */
export const addRange = (model: WeeklyModel, day: Weekday): WeeklyModel => {
  const existing = model[day];
  if (existing.length >= MAX_RANGES_PER_DAY) return model;
  let next: HoursRange = { start: "09:00", end: "17:00" };
  if (existing.length > 0) {
    const lastEnd = Math.max(...existing.map((r) => parseHHMM(r.end) ?? 0));
    if (lastEnd >= 1440 - 30) return model;
    const start = Math.min(lastEnd + 60, 1440 - 30);
    next = { start: toHHMM(start), end: toHHMM(Math.min(start + 240, 1440)) };
  }
  return { ...model, [day]: [...existing, next] };
};

export const removeRange = (
  model: WeeklyModel,
  day: Weekday,
  index: number
): WeeklyModel => ({
  ...model,
  [day]: model[day].filter((_, i) => i !== index),
});

export const updateRange = (
  model: WeeklyModel,
  day: Weekday,
  index: number,
  patch: Partial<HoursRange>
): WeeklyModel => ({
  ...model,
  [day]: model[day].map((range, i) =>
    i === index ? { ...range, ...patch } : range
  ),
});

/** Copies one day's ranges onto other days (replacing them). */
export const copyDay = (
  model: WeeklyModel,
  from: Weekday,
  to: readonly Weekday[]
): WeeklyModel => {
  const next = { ...model };
  for (const day of to) {
    if (day === from) continue;
    next[day] = model[from].map((range) => ({ ...range }));
  }
  return next;
};

/** "09:00-13:00, 14:00-17:00" or "Closed". */
export const summarizeDay = (ranges: readonly HoursRange[]): string =>
  ranges.length === 0
    ? "Closed"
    : [...ranges]
        .sort(byStart)
        .map((r) => `${r.start}-${r.end}`)
        .join(", ");

/** Total weekly open minutes (ignores invalid ranges). */
export const weeklyMinutes = (model: WeeklyModel): number => {
  let total = 0;
  for (const day of WEEK_ORDER) {
    for (const range of model[day]) {
      const start = parseHHMM(range.start);
      const end = parseHHMM(range.end);
      if (start !== null && end !== null && end > start) total += end - start;
    }
  }
  return total;
};
