// Edge-safe pure helpers for post-login redirects.

const BASE = "http://pkpcare.invalid";

// Validates a user-supplied `next` target. Returns a same-origin relative path
// (path + query + hash) or `fallback`. Rejects absolute URLs, protocol-relative
// URLs ("//evil.com"), backslash tricks ("/\evil.com"), control characters and
// anything that resolves to a different origin.
export function safeNextPath(
  next: string | string[] | null | undefined,
  fallback = "/"
): string {
  const value = Array.isArray(next) ? next[0] : next;
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) {
    return fallback;
  }
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  // Backslashes are treated as slashes by browsers; control chars enable header/
  // scheme smuggling. Reject both outright.
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return fallback;

  try {
    const url = new URL(value, BASE);
    if (url.origin !== BASE) return fallback;
    // Re-check after normalisation (e.g. "/.//evil.com" collapses).
    if (url.pathname.startsWith("//")) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
