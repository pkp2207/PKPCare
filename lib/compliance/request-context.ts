import { headers } from "next/headers";

export type RequestContext = { requestId: string | null; ip: string | null };

const clean = (value: string | null | undefined, max: number) => {
  if (!value) return null;
  const trimmed = value
    .replace(/[^\w.:,\- ]/g, "")
    .trim()
    .slice(0, max);
  return trimmed || null;
};

/**
 * Best-effort request metadata. `headers()` throws when called outside a
 * request scope (scripts, tests, cron internals), which is handled here.
 * Note: x-forwarded-for is only trustworthy behind a proxy you control.
 */
export const getRequestContext = (): RequestContext => {
  try {
    const h = headers();
    const forwarded = h.get("x-forwarded-for")?.split(",")[0];
    return {
      requestId: clean(h.get("x-request-id") ?? h.get("x-vercel-id"), 64),
      ip: clean(forwarded ?? h.get("x-real-ip"), 64),
    };
  } catch {
    return { requestId: null, ip: null };
  }
};
