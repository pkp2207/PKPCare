// Stricter-than-logging redaction applied to every string BEFORE it is sent to a
// model. Best effort: it removes obvious direct identifiers; it cannot
// guarantee that free text contains no personal data (names in prose, rare
// conditions, places...). Do not describe it as anonymisation.
import { redactForLogs } from "@/lib/compliance/redact";

export const DEFAULT_MODEL_TEXT_MAX = 800;

const URL_RE = /\b(?:https?:\/\/|www\.)\S+/gi;
const HANDLE_RE = /(^|\s)@[A-Za-z0-9_.]{2,}/g;
// Any run of 6+ digits once separators are ignored (phones, ids, policy numbers).
const SEPARATED_DIGITS_RE = /\+?\d[\d\s().\-/]{4,}\d/g;
// Mixed letter+digit tokens of 6+ chars (passport, PAN, licence numbers: AB1234567).
const ALNUM_ID_RE = /\b(?=[A-Za-z0-9-]*\d)(?=[A-Za-z0-9-]*[A-Za-z])[A-Za-z0-9-]{6,}\b/g;
// Clinical terms that mix letters and digits and are not identifiers.
const CLINICAL_TOKEN_RE = /^(?:covid|sars|mers|hiv|hba1c|h\d+n\d+|vitamin|type|hepatitis)/i;
// Full dates with a 4-digit year (dates of birth); relative times are left alone.
const DATE_RE =
  /\b(?:\d{1,2}[\s./-]\d{1,2}[\s./-](?:19|20)\d{2}|(?:19|20)\d{2}[\s./-]\d{1,2}[\s./-]\d{1,2})\b/g;
const NAME_INTRO_RE =
  /\b(?:[Mm]y [Nn]ame is|[Nn]ame is|[Nn]ame:|[Pp]atient [Nn]ame:?|[Ii](?: am|'m) called)\s+(?:[A-Z][\p{L}'-]+)(?:\s+[A-Z][\p{L}'-]+){0,2}/gu;
// Characters that could close/open our delimiters or inject markup.
const ANGLE_RE = /[<>]/g;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;
const BIDI_ZW_RE = /[\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g;

const escapeRe = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export type RedactForModelOptions = {
  /** Hard cap on the returned length (default 800). */
  maxLength?: number;
  /** Exact strings known to identify the person (name, email, phone...). Removed case-insensitively. */
  knownTerms?: readonly (string | null | undefined)[];
};

/**
 * Returns a single-purpose, length-bounded, identifier-scrubbed copy of `text`.
 * Order matters: known terms first (so a name is removed everywhere), then the
 * shared log redaction, then the stricter model-only rules.
 */
export const redactForModel = (
  text: string,
  options: RedactForModelOptions = {},
): string => {
  const max = options.maxLength ?? DEFAULT_MODEL_TEXT_MAX;
  let out = String(text ?? "")
    .replace(CONTROL_RE, " ")
    .replace(BIDI_ZW_RE, "");

  const terms = (options.knownTerms ?? [])
    .map((term) => (typeof term === "string" ? term.trim() : ""))
    .filter((term) => term.length >= 3);
  // Also strip each word of multi-word names (first / last name alone).
  const expanded = new Set<string>();
  terms.forEach((term) => {
    expanded.add(term);
    term.split(/\s+/).forEach((part) => {
      if (part.length >= 3) expanded.add(part);
    });
  });
  // Longest first so "John Smith" goes before "John".
  Array.from(expanded)
    .sort((a, b) => b.length - a.length)
    .forEach((term) => {
      out = out.replace(new RegExp(escapeRe(term), "gi"), "[redacted]");
    });

  out = redactForLogs(out) as string;
  out = out
    .replace(URL_RE, "[link]")
    .replace(HANDLE_RE, "$1[handle]")
    .replace(NAME_INTRO_RE, "[name]")
    .replace(DATE_RE, "[date]")
    .replace(SEPARATED_DIGITS_RE, (match) =>
      match.replace(/\D/g, "").length >= 6 ? "[number]" : match,
    )
    .replace(ALNUM_ID_RE, (token) => (CLINICAL_TOKEN_RE.test(token) ? token : "[id]"))
    .replace(ANGLE_RE, " ")
    .replace(/\s+/g, " ")
    .trim();

  return out.length > max ? `${out.slice(0, max).trimEnd()}...` : out;
};
