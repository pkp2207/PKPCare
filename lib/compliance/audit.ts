// Audit trail. Records WHO did WHAT to WHICH resource and the outcome, never
// the content of patient data. Designed to be called from any server path:
// it never throws and never blocks the caller's result on audit failure
// (failures are logged as one safe line; monitor for them).
import * as complianceRepo from "@/lib/appwrite/compliance.repository";

import { redactForLogs, safeLogLine } from "./redact";
import { getRequestContext } from "./request-context";

export type AuditEntry = {
  actorId: string | null;
  actorRole: string;
  action: string;
  resource: string;
  resourceId?: string;
  outcome?: "success" | "denied" | "error";
  meta?: Record<string, unknown>;
};

/**
 * Allow-list of meta keys. Anything else is dropped (names, emails, phones,
 * free text and tokens must never be added here). Values must be short
 * primitives (or short arrays of primitives).
 */
export const AUDIT_META_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "count",
  "errors",
  "total",
  "page",
  "pageSize",
  "status",
  "purpose",
  "decision",
  "policyVersion",
  "dryRun",
  "durationMs",
  "errorCode",
  "errorName",
  "filterAction",
  "hasActorFilter",
  "patientFound",
  "files",
  "appointments",
  "auditLogs",
  "idDocuments",
  "deletionRequests",
  "alreadyResolved",
  "alreadyPending",
  "actor",
  "step",
]);

const MAX_META_STRING = 64;
const MAX_META_ARRAY = 10;
const MAX_META_JSON = 1000;

const bound = (value: string, max: number) =>
  value.replace(/[\r\n\t]+/g, " ").slice(0, max);

const sanitizeScalar = (
  value: unknown,
): string | number | boolean | null | undefined => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number")
    return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    return bound(redactForLogs(value) as string, MAX_META_STRING);
  }
  if (value === null) return null;
  return undefined;
};

/** Exported for tests. Returns a JSON-safe, bounded object; drops disallowed keys. */
export const sanitizeAuditMeta = (
  meta: Record<string, unknown> | undefined,
): Record<string, unknown> | null => {
  if (!meta || typeof meta !== "object") return null;

  const out: Record<string, unknown> = {};
  let dropped = 0;

  for (const [key, value] of Object.entries(meta)) {
    if (!AUDIT_META_ALLOWED_KEYS.has(key)) {
      dropped += 1;
      continue;
    }
    if (Array.isArray(value)) {
      const items = value
        .slice(0, MAX_META_ARRAY)
        .map(sanitizeScalar)
        .filter((item) => item !== undefined);
      out[key] = items;
      continue;
    }
    const scalar = sanitizeScalar(value);
    if (scalar === undefined) {
      dropped += 1;
      continue;
    }
    out[key] = scalar;
  }

  if (dropped > 0) out._dropped = dropped;
  if (Object.keys(out).length === 0) return null;

  if (JSON.stringify(out).length > MAX_META_JSON) return { _truncated: true };
  return out;
};

export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    const { requestId, ip } = getRequestContext();
    const meta = sanitizeAuditMeta(entry.meta);

    await complianceRepo.createAuditLog({
      actorId: entry.actorId ? bound(String(entry.actorId), 64) : null,
      actorRole: bound(String(entry.actorRole || "unknown"), 32),
      action: bound(String(entry.action), 64),
      resource: bound(String(entry.resource), 64),
      resourceId: entry.resourceId ? bound(String(entry.resourceId), 64) : null,
      outcome: entry.outcome ?? "success",
      requestId,
      ip,
      meta: meta ? JSON.stringify(meta) : null,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    try {
      const code = (error as { code?: unknown } | null)?.code;
      console.error(
        `[audit] write failed action=${safeLogLine(entry?.action, 64)} resource=${safeLogLine(
          entry?.resource,
          64,
        )} outcome=${safeLogLine(entry?.outcome ?? "success", 16)} code=${safeLogLine(code ?? "n/a", 16)}`,
      );
    } catch {
      // Audit must never throw, even while reporting its own failure.
    }
  }
}
