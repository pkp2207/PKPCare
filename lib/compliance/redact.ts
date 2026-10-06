// Log/telemetry redaction helpers. Pure and dependency-free so they can be
// reused anywhere (audit, error reporting, future AI prompts/logs).
// Best effort masking of obvious identifiers: it reduces accidental leakage,
// it is not a guarantee that no personal data remains.

const MAX_DEPTH = 6;
const MAX_KEYS = 50;
const MAX_ARRAY = 50;

const EMAIL_RE =
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const JWT_RE = /\beyJ[\w-]+\.[\w-]+\.[\w-]+/g;
const BEARER_RE = /\bBearer\s+[\w.~+/=-]{8,}/gi;
// Digit runs that may contain common phone/ID separators.
const SEPARATED_DIGITS_RE = /[+(]?\d[\d\s().-]{7,}\d/g;
const LONG_DIGITS_RE = /\d{9,}/g;
const ISO_DATE_PREFIX_RE = /^\d{4}-\d{2}-\d{2}/;

// Keys whose values are masked wholesale regardless of content.
const SENSITIVE_KEY_RE =
  /pass(word|phrase)?|secret|token|api[-_]?key|authorization|cookie|session|ssn|aadhaar|identification|policy(number)?|allerg|medication|history|diagnos|address|birth|^name$|email|phone|note|reason/i;

const countDigits = (value: string) => value.replace(/\D/g, "").length;

const redactString = (input: string): string =>
  input
    .replace(EMAIL_RE, "[email]")
    .replace(JWT_RE, "[token]")
    .replace(BEARER_RE, "Bearer [token]")
    .replace(SEPARATED_DIGITS_RE, (match) => {
      if (ISO_DATE_PREFIX_RE.test(match.trim())) return match;
      return countDigits(match) >= 9 ? "[number]" : match;
    })
    .replace(LONG_DIGITS_RE, "[number]");

const redactValue = (
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
): unknown => {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return "[number]";
  if (typeof value === "function" || typeof value === "symbol")
    return undefined;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error)
    return redactString(`${value.name}: ${value.message}`);

  if (typeof value === "object") {
    if (depth >= MAX_DEPTH) return "[truncated]";
    if (seen.has(value as object)) return "[circular]";
    seen.add(value as object);

    if (Array.isArray(value)) {
      return value
        .slice(0, MAX_ARRAY)
        .map((item) => redactValue(item, depth + 1, seen));
    }

    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(
      value as Record<string, unknown>,
    ).slice(0, MAX_KEYS)) {
      out[key] = SENSITIVE_KEY_RE.test(key)
        ? "[REDACTED]"
        : redactValue(item, depth + 1, seen);
    }
    return out;
  }
  return undefined;
};

/**
 * Masks emails, phone-like numbers, long digit strings (9+ digits) and bearer
 * tokens / JWTs in strings; recursively masks whole values for sensitive keys
 * in objects. Returns a copy; never mutates or throws.
 */
type Redact = {
  (value: string): string;
  (value: unknown): unknown;
};

export const redactForLogs: Redact = (value: unknown): any => {
  try {
    return redactValue(value, 0, new WeakSet());
  } catch {
    return "[unredactable]";
  }
};

/** Single-line, length-bounded, redacted string for console output. */
export const safeLogLine = (value: unknown, max = 200): string => {
  const text = typeof value === "string" ? value : String(redactForLogs(value));
  return redactString(text)
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, max);
};
