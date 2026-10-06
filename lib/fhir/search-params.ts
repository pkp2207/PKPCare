// Parsing / validation of FHIR search parameters. Pure.

/** Appwrite-compatible document id (also what doctors / patients use). */
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/;

export const isValidId = (value: unknown): value is string =>
  typeof value === "string" && ID.test(value);

/** `Type/id` or bare `id` -> id, or null when malformed / wrong type. */
export const parseReferenceId = (
  value: string | null,
  type: string,
): string | null => {
  if (!value) return null;
  const prefix = `${type}/`;
  const id = value.startsWith(prefix) ? value.slice(prefix.length) : value;
  return isValidId(id) ? id : null;
};

/** Names of unsupported params (names only, never values). `_format` is checked separately. */
export const unsupportedParams = (
  params: URLSearchParams,
  allowed: readonly string[],
): string[] => {
  const common = new Set(["_count", "_offset", "_include", "_format"]);
  const ok = new Set(allowed);
  const bad = new Set<string>();
  params.forEach((_value, key) => {
    if (!ok.has(key) && !common.has(key)) bad.add(key.slice(0, 40));
  });
  return Array.from(bad);
};

const FORMATS = new Set(["json", "application/json", "application/fhir+json"]);

export const isSupportedFormat = (params: URLSearchParams): boolean => {
  const format = params.get("_format");
  return format === null || FORMATS.has(format.trim().toLowerCase());
};

/** `_include=sensitive` is our own switch (see docs/interop.md). */
export const wantsSensitive = (
  params: URLSearchParams,
): { ok: true; sensitive: boolean } | { ok: false } => {
  const values = params.getAll("_include");
  if (values.length === 0) return { ok: true, sensitive: false };
  if (values.length === 1 && values[0] === "sensitive") {
    return { ok: true, sensitive: true };
  }
  return { ok: false };
};

// ---------------------------------------------------------------------------
// date / start parameters
// ---------------------------------------------------------------------------

export type DateBound = { prefix: string; from: number; to: number };

const DATE_RE =
  /^(eq|ge|gt|le|lt)?(\d{4})(?:-(\d{2})(?:-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?)?)?$/;

/**
 * One date-range value -> half-open period [from, to) in epoch ms.
 * Year / month / day values are UTC periods; a full datetime is a 1 s period.
 * A datetime without an offset is treated as UTC.
 */
export const parseDateParam = (raw: string): DateBound | null => {
  const match = DATE_RE.exec(raw.trim().replace(/ /g, "+"));
  if (!match) return null;
  const [, prefix = "eq", y, mo, d, hh, mm, ss, tz] = match;
  const year = Number(y);
  const month = mo === undefined ? 1 : Number(mo);
  const day = d === undefined ? 1 : Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  let from: number;
  let to: number;
  if (hh !== undefined) {
    if (mm === undefined) return null;
    const iso = `${y}-${mo}-${d}T${hh}:${mm}:${ss ?? "00"}${tz ?? "Z"}`;
    from = Date.parse(iso);
    to = from + 1000;
  } else if (d !== undefined) {
    from = Date.UTC(year, month - 1, day);
    to = Date.UTC(year, month - 1, day + 1);
  } else if (mo !== undefined) {
    from = Date.UTC(year, month - 1, 1);
    to = Date.UTC(year, month, 1);
  } else {
    from = Date.UTC(year, 0, 1);
    to = Date.UTC(year + 1, 0, 1);
  }
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  // Reject rolled-over calendar dates such as 2026-02-31.
  if (d !== undefined && hh === undefined) {
    if (new Date(from).getUTCDate() !== day) return null;
  }
  return { prefix, from, to };
};

export type DateRange = {
  /** Inclusive lower bound on the resource start (epoch ms), if any. */
  gte?: number;
  /** Exclusive upper bound (epoch ms), if any. */
  lt?: number;
};

/**
 * Combines every value of a date parameter (repeated params are ANDed) into
 * one range. Returns null when any value is malformed.
 */
export const parseDateRange = (values: string[]): DateRange | null => {
  const range: DateRange = {};
  for (const raw of values) {
    const bound = parseDateParam(raw);
    if (!bound) return null;
    const lower: number | undefined =
      bound.prefix === "eq" || bound.prefix === "ge"
        ? bound.from
        : bound.prefix === "gt"
          ? bound.to
          : undefined;
    const upper: number | undefined =
      bound.prefix === "eq"
        ? bound.to
        : bound.prefix === "lt"
          ? bound.from
          : bound.prefix === "le"
            ? bound.to
            : undefined;
    if (lower !== undefined) range.gte = Math.max(range.gte ?? lower, lower);
    if (upper !== undefined) range.lt = Math.min(range.lt ?? upper, upper);
  }
  return range;
};
