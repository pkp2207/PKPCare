// Treat model output as untrusted text: strip markup, links and control
// characters so it is safe to render as plain text (React escapes it; we also
// never use dangerouslySetInnerHTML anywhere in components/ai).
import { z } from "zod";

// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;
const BIDI_ZW_RE = /[\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g;
const TAG_RE = /<\/?[a-zA-Z!][^>]*>?/g;
const MD_IMAGE_RE = /!\[[^\]]*\]\([^)]*\)/g;
const MD_LINK_RE = /\[([^\]]*)\]\([^)]*\)/g;
const URL_RE = /\b(?:https?:\/\/|www\.)\S+/gi;

/** Plain, single-line-ish text: no tags, links, markdown emphasis or control characters. */
export const cleanModelText = (value: string): string =>
  value
    .replace(CONTROL_RE, " ")
    .replace(BIDI_ZW_RE, "")
    .replace(MD_IMAGE_RE, "")
    .replace(MD_LINK_RE, "$1")
    .replace(TAG_RE, " ")
    .replace(URL_RE, "")
    .replace(/[<>]/g, " ")
    .replace(/[*_`#]{1,}/g, "")
    .replace(/^\s*[-•]\s+/, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * zod string that is REJECTED when oversized (no silent truncation of model
 * output), then cleaned, and must be non-empty after cleaning.
 */
export const safeText = (max: number) =>
  z
    .string()
    .max(max)
    .transform(cleanModelText)
    .pipe(z.string().min(1));

export const ConfidenceSchema = z.enum(["low", "medium", "high"]);
export type Confidence = z.infer<typeof ConfidenceSchema>;
