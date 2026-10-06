// Authentication, scopes and rate limiting for the FHIR facade. Server only.
//
// FHIR_API_TOKENS: entries separated by "," or newlines, each
//   name:scopes:token
// where scopes are separated by "+", "|" or spaces (commas separate entries),
// e.g.  epic-sandbox:read:patient+read:appointment:<32+ char random token>
// name  = [A-Za-z0-9_.-]{1,32}, used as the audit actor id.
// token = at least 32 characters, no ":" , "," or whitespace.
import { createHash, timingSafeEqual } from "node:crypto";

import { getStaffSession } from "@/lib/auth/admin";
import { createRateLimiter, type RateLimiter } from "@/lib/auth/rate-limit";

export const FHIR_SCOPES = [
  "read:patient",
  "read:appointment",
  "read:practitioner",
  "read:slot",
  "read:consent",
  "read:sensitive",
] as const;

export type FhirScope = (typeof FHIR_SCOPES)[number];

/** Every scope except `read:sensitive`, which must always be granted explicitly. */
export const NON_SENSITIVE_SCOPES: readonly FhirScope[] = FHIR_SCOPES.filter(
  (scope) => scope !== "read:sensitive",
);

const MIN_TOKEN_LENGTH = 32;
const NAME_RE = /^[A-Za-z0-9_.-]{1,32}$/;

export type FhirTokenEntry = {
  name: string;
  scopes: ReadonlySet<FhirScope>;
  digest: Buffer;
};

export type FhirPrincipal = {
  name: string;
  kind: "token" | "session";
  /** Audit actor role. */
  role: string;
  scopes: ReadonlySet<FhirScope>;
};

export const isFhirEnabled = (): boolean =>
  process.env.FHIR_API_ENABLED === "true";

const sha256 = (value: string) => createHash("sha256").update(value).digest();

const isScope = (value: string): value is FhirScope =>
  (FHIR_SCOPES as readonly string[]).includes(value);

/**
 * Lenient about whitespace, strict about content: malformed entries are
 * dropped (fail closed) and a one-line warning without the token is logged.
 */
export const parseFhirTokens = (raw: string | undefined): FhirTokenEntry[] => {
  if (!raw) return [];
  const entries: FhirTokenEntry[] = [];

  for (const chunk of raw.split(/[,\n]/)) {
    const entry = chunk.trim();
    if (!entry) continue;

    const first = entry.indexOf(":");
    const last = entry.lastIndexOf(":");
    const name = first > 0 ? entry.slice(0, first) : "";
    const token = last > first ? entry.slice(last + 1) : "";
    const scopeText = last > first ? entry.slice(first + 1, last) : "";

    const scopes = scopeText
      .split(/[+|\s]+/)
      .map((scope) => scope.trim())
      .filter(isScope);

    if (
      !NAME_RE.test(name) ||
      token.length < MIN_TOKEN_LENGTH ||
      /\s/.test(token) ||
      scopes.length === 0
    ) {
      console.warn(
        `[fhir] ignoring malformed FHIR_API_TOKENS entry (name=${NAME_RE.test(name) ? name : "invalid"})`,
      );
      continue;
    }
    entries.push({ name, scopes: new Set(scopes), digest: sha256(token) });
  }
  return entries;
};

/**
 * Hash-then-compare in constant time. Every configured token is compared (no
 * early exit) so neither the length nor the position of a match leaks.
 */
export const matchToken = (
  provided: string,
  entries: readonly FhirTokenEntry[],
): FhirTokenEntry | null => {
  const digest = sha256(provided);
  let match: FhirTokenEntry | null = null;
  for (const entry of entries) {
    if (timingSafeEqual(digest, entry.digest)) match = entry;
  }
  return match;
};

export type AuthResult =
  | { ok: true; principal: FhirPrincipal }
  | { ok: false; attempted: boolean };

/**
 * Bearer token first. A request that presents a Bearer header never falls back
 * to the session cookie. With no Bearer header, a staff session with role
 * `admin` is accepted (testing aid) and gets every non-sensitive read scope.
 */
export const authenticateFhirRequest = async (
  request: Request,
): Promise<AuthResult> => {
  const header = request.headers.get("authorization");

  if (header) {
    const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
    if (!match) return { ok: false, attempted: true };
    const entry = matchToken(match[1], parseFhirTokens(process.env.FHIR_API_TOKENS));
    if (!entry) return { ok: false, attempted: true };
    return {
      ok: true,
      principal: {
        name: entry.name,
        kind: "token",
        role: "fhir-client",
        scopes: entry.scopes,
      },
    };
  }

  try {
    const staff = await getStaffSession();
    if (staff && staff.role === "admin") {
      return {
        ok: true,
        principal: {
          name: `staff-${staff.userId}`.slice(0, 32),
          kind: "session",
          role: "admin",
          scopes: new Set(NON_SENSITIVE_SCOPES),
        },
      };
    }
  } catch {
    // No request scope / cookie access: treated as unauthenticated.
  }
  return { ok: false, attempted: false };
};

// ---------------------------------------------------------------------------
// Rate limiting (per principal, in memory, per server instance)
// ---------------------------------------------------------------------------

const DEFAULT_RATE_PER_MINUTE = 120;
let limiter: { max: number; instance: RateLimiter } | null = null;

const ratePerMinute = () => {
  const parsed = Number.parseInt(process.env.FHIR_RATE_LIMIT_PER_MINUTE ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RATE_PER_MINUTE;
};

const getLimiter = () => {
  const max = ratePerMinute();
  if (!limiter || limiter.max !== max) {
    limiter = { max, instance: createRateLimiter({ max, windowMs: 60_000 }) };
  }
  return limiter.instance;
};

/**
 * NOTE: in-memory and per server instance (counters reset on restart and are
 * not shared between replicas / serverless invocations). Use a shared store
 * for multi-instance deployments. Returns true when the request may proceed.
 */
export const consumeRateLimit = (principalName: string): boolean => {
  const instance = getLimiter();
  if (instance.isLimited(principalName)) return false;
  instance.hit(principalName);
  return true;
};

export const resetFhirRateLimiter = () => {
  limiter = null;
};
