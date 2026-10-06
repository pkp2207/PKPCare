// Pure analytics over a list of appointment facts. No I/O, no PHI: inputs are
// status / timestamps / doctor id only, so results are safe to show anywhere.
import { getZonedParts, type WeekdayKey } from "@/lib/scheduling/time";

export type AnalyticsAppointment = {
  status: Status;
  /** ISO instant of the appointment. */
  schedule: string;
  /** ISO instant the request was created. */
  createdAt: string;
  doctorId: string | null;
};

const HOUR_MS = 60 * 60 * 1000;

const ms = (iso: string) => Date.parse(iso);

/** num / den, or null when there is nothing to divide by. */
export const ratio = (num: number, den: number): number | null =>
  den > 0 ? num / den : null;

export type StatusCounts = {
  total: number;
  pending: number;
  scheduled: number;
  cancelled: number;
};

export const statusCounts = (apps: readonly AnalyticsAppointment[]): StatusCounts => {
  const counts: StatusCounts = { total: 0, pending: 0, scheduled: 0, cancelled: 0 };
  for (const app of apps) {
    counts.total += 1;
    if (app.status === "pending") counts.pending += 1;
    else if (app.status === "scheduled") counts.scheduled += 1;
    else if (app.status === "cancelled") counts.cancelled += 1;
  }
  return counts;
};

export type RateResult = { count: number; of: number; rate: number | null };

/** Cancelled share of all appointments in the window. */
export const cancellationRate = (
  apps: readonly AnalyticsAppointment[]
): RateResult => {
  const cancelled = apps.filter((app) => app.status === "cancelled").length;
  return { count: cancelled, of: apps.length, rate: ratio(cancelled, apps.length) };
};

/**
 * No-show PROXY. The app has no attendance status, so a true no-show cannot be
 * measured. This counts appointments whose time has passed while still
 * `pending` (never confirmed, never cancelled) as a share of all past,
 * non-cancelled appointments. Confirmed appointments that the patient skipped
 * are invisible until an attendance status exists.
 */
export const noShowProxy = (
  apps: readonly AnalyticsAppointment[],
  now: Date
): RateResult => {
  const nowMs = now.getTime();
  let past = 0;
  let unconfirmed = 0;
  for (const app of apps) {
    if (app.status === "cancelled") continue;
    const t = ms(app.schedule);
    if (Number.isNaN(t) || t >= nowMs) continue;
    past += 1;
    if (app.status === "pending") unconfirmed += 1;
  }
  return { count: unconfirmed, of: past, rate: ratio(unconfirmed, past) };
};

// ---------------------------------------------------------------------------
// Lead time (schedule - created)
// ---------------------------------------------------------------------------

export const LEAD_TIME_BUCKETS = [
  { key: "lt1d", label: "Under 1 day", maxHours: 24 },
  { key: "1to3d", label: "1 to 3 days", maxHours: 72 },
  { key: "3to7d", label: "3 to 7 days", maxHours: 168 },
  { key: "1to2w", label: "1 to 2 weeks", maxHours: 336 },
  { key: "2to4w", label: "2 to 4 weeks", maxHours: 672 },
  { key: "gt4w", label: "Over 4 weeks", maxHours: Number.POSITIVE_INFINITY },
] as const;

export type LeadTimeDistribution = {
  buckets: { key: string; label: string; count: number }[];
  considered: number;
  /** Median lead time in hours, or null when there is no data. */
  medianHours: number | null;
};

/** Hours between request and appointment; negative (back-entered) clamps to 0. */
export const leadTimeHours = (app: AnalyticsAppointment): number | null => {
  const scheduled = ms(app.schedule);
  const created = ms(app.createdAt);
  if (Number.isNaN(scheduled) || Number.isNaN(created)) return null;
  return Math.max(0, (scheduled - created) / HOUR_MS);
};

export const leadTimeDistribution = (
  apps: readonly AnalyticsAppointment[]
): LeadTimeDistribution => {
  const buckets = LEAD_TIME_BUCKETS.map(({ key, label }) => ({
    key,
    label,
    count: 0,
  }));
  const hours: number[] = [];

  for (const app of apps) {
    const h = leadTimeHours(app);
    if (h === null) continue;
    hours.push(h);
    const index = LEAD_TIME_BUCKETS.findIndex((bucket) => h < bucket.maxHours);
    buckets[index === -1 ? buckets.length - 1 : index].count += 1;
  }

  hours.sort((a, b) => a - b);
  let medianHours: number | null = null;
  if (hours.length > 0) {
    const mid = Math.floor(hours.length / 2);
    medianHours =
      hours.length % 2 === 1 ? hours[mid] : (hours[mid - 1] + hours[mid]) / 2;
  }
  return { buckets, considered: hours.length, medianHours };
};

// ---------------------------------------------------------------------------
// Utilization
// ---------------------------------------------------------------------------

export type DoctorCapacity = { id: string; name: string; capacity: number };

export type DoctorUtilization = DoctorCapacity & {
  booked: number;
  /** booked / capacity; null when the doctor had no capacity in the window. May exceed 1 when staff override hours. */
  rate: number | null;
};

/** Non-cancelled appointments per doctor against available slot capacity. */
export const utilizationPerDoctor = (
  doctors: readonly DoctorCapacity[],
  apps: readonly AnalyticsAppointment[]
): { rows: DoctorUtilization[]; unassigned: number } => {
  const booked = new Map<string, number>();
  let unassigned = 0;
  for (const app of apps) {
    if (app.status === "cancelled") continue;
    if (!app.doctorId) {
      unassigned += 1;
      continue;
    }
    booked.set(app.doctorId, (booked.get(app.doctorId) ?? 0) + 1);
  }
  const rows = doctors
    .map((doctor) => {
      const count = booked.get(doctor.id) ?? 0;
      return { ...doctor, booked: count, rate: ratio(count, doctor.capacity) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return { rows, unassigned };
};

// ---------------------------------------------------------------------------
// Peak hours heatmap
// ---------------------------------------------------------------------------

/** Display order of the heatmap rows. */
export const HEATMAP_DAYS: readonly WeekdayKey[] = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
];

export type Heatmap = {
  timeZone: string;
  days: readonly WeekdayKey[];
  /** matrix[dayIndex][hour 0-23] = appointments starting in that hour. */
  matrix: number[][];
  max: number;
  total: number;
};

export const peakHoursHeatmap = (
  apps: readonly AnalyticsAppointment[],
  timeZone: string,
  { includeCancelled = false }: { includeCancelled?: boolean } = {}
): Heatmap => {
  const matrix = HEATMAP_DAYS.map(() => new Array<number>(24).fill(0));
  let max = 0;
  let total = 0;
  for (const app of apps) {
    if (!includeCancelled && app.status === "cancelled") continue;
    const t = ms(app.schedule);
    if (Number.isNaN(t)) continue;
    const { weekday, hour } = getZonedParts(t, timeZone);
    const row = HEATMAP_DAYS.indexOf(weekday);
    if (row === -1 || hour < 0 || hour > 23) continue;
    matrix[row][hour] += 1;
    total += 1;
    if (matrix[row][hour] > max) max = matrix[row][hour];
  }
  return { timeZone, days: HEATMAP_DAYS, matrix, max, total };
};

// ---------------------------------------------------------------------------
// Status funnel
// ---------------------------------------------------------------------------

export type FunnelStage = {
  key: "requested" | "confirmed" | "completed_window";
  label: string;
  count: number;
  /** Share of "requested", or null when nothing was requested. */
  share: number | null;
};

export type StatusFunnel = {
  stages: FunnelStage[];
  pending: number;
  cancelled: number;
};

/**
 * Requested -> confirmed (status scheduled) -> confirmed and already past.
 * "Past" is only a proxy for "took place": attendance is not recorded.
 */
export const statusFunnel = (
  apps: readonly AnalyticsAppointment[],
  now: Date
): StatusFunnel => {
  const counts = statusCounts(apps);
  const nowMs = now.getTime();
  const past = apps.filter((app) => {
    const t = ms(app.schedule);
    return app.status === "scheduled" && !Number.isNaN(t) && t < nowMs;
  }).length;

  const stage = (
    key: FunnelStage["key"],
    label: string,
    count: number
  ): FunnelStage => ({ key, label, count, share: ratio(count, counts.total) });

  return {
    stages: [
      stage("requested", "Requested", counts.total),
      stage("confirmed", "Confirmed", counts.scheduled),
      stage("completed_window", "Confirmed and date passed", past),
    ],
    pending: counts.pending,
    cancelled: counts.cancelled,
  };
};

/** Percentage string for a ratio, "n/a" when there is no data. */
export const formatPercent = (value: number | null, digits = 1): string =>
  value === null ? "n/a" : `${(value * 100).toFixed(digits)}%`;
