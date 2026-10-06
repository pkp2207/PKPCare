// Pure appointment-filter model shared by the admin page (URL search params),
// the server actions (input validation) and the tests. No I/O, client-safe.

export const APPOINTMENT_STATUSES = ["scheduled", "pending", "cancelled"] as const;
export const VISIT_TYPE_VALUES = ["in_person", "video"] as const;
export const APPOINTMENT_SORTS = [
  "created_desc",
  "schedule_asc",
  "schedule_desc",
] as const;
export type AppointmentSort = (typeof APPOINTMENT_SORTS)[number];

export const DEFAULT_SORT: AppointmentSort = "created_desc";
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 50;
const MAX_PAGE = 100_000;
const MAX_QUERY_LENGTH = 100;

export type AppointmentFilters = {
  q?: string;
  status?: Status;
  doctorId?: string;
  /** YYYY-MM-DD, interpreted as a UTC day (inclusive). */
  from?: string;
  /** YYYY-MM-DD, interpreted as a UTC day (inclusive). */
  to?: string;
  visitType?: VisitType;
  sort: AppointmentSort;
  page: number;
  pageSize: number;
};

const first = (value: unknown): unknown =>
  Array.isArray(value) ? value[0] : value;

const text = (value: unknown): string | undefined => {
  const v = first(value);
  return typeof v === "string" ? v : undefined;
};

export const isStatusValue = (value: unknown): value is Status =>
  typeof value === "string" &&
  (APPOINTMENT_STATUSES as readonly string[]).includes(value);

const isVisitType = (value: unknown): value is VisitType =>
  typeof value === "string" &&
  (VISIT_TYPE_VALUES as readonly string[]).includes(value);

const isSort = (value: unknown): value is AppointmentSort =>
  typeof value === "string" &&
  (APPOINTMENT_SORTS as readonly string[]).includes(value);

// Appwrite custom-id charset (same rule as IdSchema in lib/validation).
const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/;

/** Strict YYYY-MM-DD that is a real calendar date, else undefined. */
export const parseDateParam = (value: unknown): string | undefined => {
  const v = text(value)?.trim();
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  const date = new Date(`${v}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString().slice(0, 10) === v ? v : undefined;
};

const positiveInt = (value: unknown, fallback: number, max: number) => {
  const v = first(value);
  const n =
    typeof v === "number" ? v : typeof v === "string" ? Number(v.trim()) : NaN;
  if (!Number.isFinite(n)) return fallback;
  const int = Math.floor(n);
  return int >= 1 ? Math.min(int, max) : fallback;
};

/**
 * Normalises untrusted input (URL params or action arguments) into a safe
 * filter object. Unknown / malformed values are dropped, never thrown on.
 */
export const normalizeAppointmentFilters = (
  input: Record<string, unknown> | null | undefined
): AppointmentFilters => {
  const raw = input ?? {};

  const q = text(raw.q)?.replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_LENGTH);
  const statusRaw = text(raw.status);
  const doctorRaw = text(raw.doctorId)?.trim();
  const visitRaw = text(raw.visitType);
  const sortRaw = text(raw.sort);

  let from = parseDateParam(raw.from);
  let to = parseDateParam(raw.to);
  if (from && to && from > to) [from, to] = [to, from];

  return {
    ...(q ? { q } : {}),
    ...(isStatusValue(statusRaw) ? { status: statusRaw } : {}),
    ...(doctorRaw && ID_RE.test(doctorRaw) ? { doctorId: doctorRaw } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(isVisitType(visitRaw) ? { visitType: visitRaw } : {}),
    sort: isSort(sortRaw) ? sortRaw : DEFAULT_SORT,
    page: positiveInt(raw.page, 1, MAX_PAGE),
    pageSize: positiveInt(raw.pageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE),
  };
};

/** `?a=b` style search params (Next `searchParams`) to filters. */
export const parseAppointmentFilters = (
  searchParams: Record<string, string | string[] | undefined> | undefined
): AppointmentFilters => normalizeAppointmentFilters(searchParams);

const DAY_MS = 24 * 60 * 60 * 1000;

/** ISO instants for the schedule range: [fromIso, toIso) in UTC. */
export const dateRangeBounds = ({
  from,
  to,
}: {
  from?: string;
  to?: string;
}): { fromIso?: string; toIso?: string } => {
  const fromMs = from ? Date.parse(`${from}T00:00:00.000Z`) : NaN;
  const toMs = to ? Date.parse(`${to}T00:00:00.000Z`) + DAY_MS : NaN;
  return {
    ...(Number.isNaN(fromMs) ? {} : { fromIso: new Date(fromMs).toISOString() }),
    ...(Number.isNaN(toMs) ? {} : { toIso: new Date(toMs).toISOString() }),
  };
};

/**
 * Builds a shareable URL. Defaults (page 1, default sort and page size) are
 * omitted so links stay short and stable.
 */
export const buildAppointmentsHref = (
  filters: Partial<AppointmentFilters>,
  overrides: Partial<AppointmentFilters> = {},
  basePath = "/admin"
): string => {
  const merged = { ...filters, ...overrides };
  const params = new URLSearchParams();
  if (merged.q) params.set("q", merged.q);
  if (merged.status) params.set("status", merged.status);
  if (merged.doctorId) params.set("doctorId", merged.doctorId);
  if (merged.visitType) params.set("visitType", merged.visitType);
  if (merged.from) params.set("from", merged.from);
  if (merged.to) params.set("to", merged.to);
  if (merged.sort && merged.sort !== DEFAULT_SORT) {
    params.set("sort", merged.sort);
  }
  if (merged.pageSize && merged.pageSize !== DEFAULT_PAGE_SIZE) {
    params.set("pageSize", String(merged.pageSize));
  }
  if (merged.page && merged.page > 1) params.set("page", String(merged.page));
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
};

/** True when any narrowing filter (not sort / paging) is set. */
export const hasActiveFilters = (filters: Partial<AppointmentFilters>) =>
  Boolean(
    filters.q ||
      filters.status ||
      filters.doctorId ||
      filters.visitType ||
      filters.from ||
      filters.to
  );

/**
 * Case-insensitive match of every whitespace-separated token of `q` against
 * patient name, physician and reason (AND across tokens, OR across fields).
 */
export const matchesQuery = (
  fields: {
    patientName?: string | null;
    primaryPhysician?: string | null;
    reason?: string | null;
  },
  q: string | undefined
): boolean => {
  const tokens = (q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const haystacks = [
    fields.patientName,
    fields.primaryPhysician,
    fields.reason,
  ].map((value) => (value ?? "").toLowerCase());
  return tokens.every((token) =>
    haystacks.some((haystack) => haystack.includes(token))
  );
};

/** Next sort when the date header is activated: asc -> desc -> default. */
export const nextScheduleSort = (
  current: AppointmentSort | undefined
): AppointmentSort =>
  current === "schedule_asc"
    ? "schedule_desc"
    : current === "schedule_desc"
      ? "created_desc"
      : "schedule_asc";

/** `aria-sort` value of the date column for the current sort. */
export const ariaSortForSort = (
  sort: AppointmentSort | undefined
): "ascending" | "descending" | "none" =>
  sort === "schedule_asc"
    ? "ascending"
    : sort === "schedule_desc"
      ? "descending"
      : "none";
