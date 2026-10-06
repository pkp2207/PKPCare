import { recordAudit } from "@/lib/compliance/audit";

type AuditEntry = Parameters<typeof recordAudit>[0];

/**
 * Fire-and-forget audit: never awaited by callers, never throws (recordAudit
 * itself should not throw, this guards against sync errors and rejections).
 */
export const auditSafe = (entry: AuditEntry): void => {
  try {
    Promise.resolve(recordAudit(entry)).catch(() => undefined);
  } catch {
    // Auditing must never break the request.
  }
};
