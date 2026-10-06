"use server";

import { z } from "zod";

import * as complianceRepo from "@/lib/appwrite/compliance.repository";
import * as patientRepo from "@/lib/appwrite/patient.repository";
import { requireRole } from "@/lib/auth/admin";
import {
  assertPatientOrStaffOwns,
  getPatientSession,
} from "@/lib/auth/patient";
import { recordAudit } from "@/lib/compliance/audit";
import {
  CONSENT_PURPOSES,
  type ConsentState,
  CURRENT_POLICY_VERSION,
  deriveConsentState,
  getConsentHistory,
  getConsentState,
  recordConsentChange,
} from "@/lib/compliance/consent";
import {
  decryptFields,
  SENSITIVE_PATIENT_FIELDS,
} from "@/lib/compliance/crypto";
import { parseStringify } from "@/lib/utils";
import { IdSchema } from "@/lib/validation";

// All actions resolve to ActionResult and never throw. Error strings are
// generic on purpose: detail goes to the audit log / server console only.

const GENERIC = "Something went wrong. Please try again.";
const DENIED = "You are not authorized to do that.";

const fail = (error: string): { ok: false; error: string } => ({
  ok: false,
  error,
});

type Actor = { id: string | null; role: string };

type OwnerCheck =
  | { ok: true; actor: Actor }
  | { ok: false; result: { ok: false; error: string } };

// Verifies the caller may act on `userId`'s data (the patient themself or
// staff). Denials are audited.
const authorizeOwner = async (
  userId: string,
  action: string,
  resource: string,
): Promise<OwnerCheck> => {
  try {
    const check = await assertPatientOrStaffOwns(userId);
    if (check.actor === "staff" && check.staff) {
      return {
        ok: true,
        actor: { id: check.staff.userId, role: check.staff.role },
      };
    }
    let sessionUserId: string | null = null;
    try {
      sessionUserId = (await getPatientSession())?.userId ?? null;
    } catch {
      sessionUserId = null;
    }
    return { ok: true, actor: { id: sessionUserId, role: "patient" } };
  } catch {
    await recordAudit({
      actorId: null,
      actorRole: "unknown",
      action,
      resource,
      resourceId: userId,
      outcome: "denied",
    });
    return { ok: false, result: fail(DENIED) };
  }
};

type AdminCheck =
  | { ok: true; actor: Actor }
  | { ok: false; result: { ok: false; error: string } };

const authorizeAdmin = async (
  action: string,
  resource: string,
): Promise<AdminCheck> => {
  try {
    const staff = await requireRole("admin");
    return { ok: true, actor: { id: staff.userId, role: staff.role } };
  } catch {
    await recordAudit({
      actorId: null,
      actorRole: "unknown",
      action,
      resource,
      outcome: "denied",
    });
    return { ok: false, result: fail(DENIED) };
  }
};

const errorMeta = (error: unknown) => ({
  errorName: (error as { name?: string } | null)?.name ?? "Error",
  errorCode: (error as { code?: number | string } | null)?.code ?? null,
});

// --- patient-facing -------------------------------------------------------

export const getMyConsents = async (
  userId: string,
): Promise<ActionResult<ConsentState[]>> => {
  const parsed = IdSchema.safeParse(userId);
  if (!parsed.success) return fail("Invalid user id");

  const auth = await authorizeOwner(parsed.data, "consent.view", "consent");
  if (!auth.ok) return auth.result;

  try {
    const state = await getConsentState(parsed.data);
    await recordAudit({
      actorId: auth.actor.id,
      actorRole: auth.actor.role,
      action: "consent.view",
      resource: "consent",
      resourceId: parsed.data,
    });
    return { ok: true, data: state };
  } catch (error) {
    console.error("getMyConsents failed");
    await recordAudit({
      actorId: auth.actor.id,
      actorRole: auth.actor.role,
      action: "consent.view",
      resource: "consent",
      resourceId: parsed.data,
      outcome: "error",
      meta: errorMeta(error),
    });
    return fail(GENERIC);
  }
};

const WithdrawSchema = z.object({
  userId: IdSchema,
  purpose: z.enum(CONSENT_PURPOSES),
});

export const withdrawConsent = async (params: {
  userId: string;
  purpose: string;
}): Promise<ActionResult<ConsentState[]>> => {
  const parsed = WithdrawSchema.safeParse(params);
  if (!parsed.success) return fail("Invalid request");
  const { userId, purpose } = parsed.data;

  const auth = await authorizeOwner(userId, "consent.withdraw", "consent");
  if (!auth.ok) return auth.result;

  try {
    // Append-only: withdrawal is a new row, earlier grants stay as history.
    await recordConsentChange({
      userId,
      purpose,
      granted: false,
      policyVersion: CURRENT_POLICY_VERSION,
      source: "withdrawal",
    });
    await recordAudit({
      actorId: auth.actor.id,
      actorRole: auth.actor.role,
      action: "consent.withdraw",
      resource: "consent",
      resourceId: userId,
      meta: { purpose },
    });
    return { ok: true, data: await getConsentState(userId) };
  } catch (error) {
    console.error("withdrawConsent failed");
    await recordAudit({
      actorId: auth.actor.id,
      actorRole: auth.actor.role,
      action: "consent.withdraw",
      resource: "consent",
      resourceId: userId,
      outcome: "error",
      meta: { purpose, ...errorMeta(error) },
    });
    return fail(GENERIC);
  }
};

const stripSystemFields = (doc: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(doc).filter(
      ([key]) => !key.startsWith("$") || key === "$id" || key === "$createdAt",
    ),
  );

export type MyDataExport = {
  exportedAt: string;
  user: Record<string, unknown>;
  patient: Record<string, unknown> | null;
  appointments: Record<string, unknown>[];
  consents: { current: ConsentState[]; history: Record<string, unknown>[] };
};

export const exportMyData = async (
  userId: string,
): Promise<ActionResult<MyDataExport>> => {
  const parsed = IdSchema.safeParse(userId);
  if (!parsed.success) return fail("Invalid user id");
  const id = parsed.data;

  const auth = await authorizeOwner(id, "data.export", "user_data");
  if (!auth.ok) return auth.result;

  try {
    const [user, patientDoc, appointmentDocs, history] = await Promise.all([
      patientRepo.getUser(id),
      patientRepo.getPatientByUserId(id),
      complianceRepo.listAppointmentsForUser(id),
      getConsentHistory(id),
    ]);

    const patient = patientDoc
      ? stripSystemFields(
          decryptFields(
            patientDoc as unknown as Record<string, unknown>,
            SENSITIVE_PATIENT_FIELDS,
          ),
        )
      : null;

    const data: MyDataExport = parseStringify({
      exportedAt: new Date().toISOString(),
      user: {
        id: user.$id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        registeredAt: user.$createdAt,
      },
      patient,
      appointments: appointmentDocs.map((doc) =>
        stripSystemFields(doc as unknown as Record<string, unknown>),
      ),
      consents: { current: deriveConsentState(history), history },
    });

    await recordAudit({
      actorId: auth.actor.id,
      actorRole: auth.actor.role,
      action: "data.export",
      resource: "user_data",
      resourceId: id,
      meta: {
        appointments: appointmentDocs.length,
        patientFound: patient !== null,
      },
    });
    return { ok: true, data };
  } catch (error) {
    console.error("exportMyData failed");
    await recordAudit({
      actorId: auth.actor.id,
      actorRole: auth.actor.role,
      action: "data.export",
      resource: "user_data",
      resourceId: id,
      outcome: "error",
      meta: errorMeta(error),
    });
    return fail(GENERIC);
  }
};

const DeletionRequestSchema = z.object({
  userId: IdSchema,
  reason: z.string().trim().max(500).optional(),
});

export type DeletionRequestSummary = {
  id: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
};

// Creates a request only. Nothing is deleted here: an administrator reviews it
// (legal retention obligations may require keeping some records).
export const requestAccountDeletion = async (params: {
  userId: string;
  reason?: string;
}): Promise<ActionResult<DeletionRequestSummary>> => {
  const parsed = DeletionRequestSchema.safeParse(params);
  if (!parsed.success) return fail("Invalid request");
  const { userId, reason } = parsed.data;

  const auth = await authorizeOwner(
    userId,
    "deletion.request",
    "deletion_request",
  );
  if (!auth.ok) return auth.result;

  try {
    const existing = await complianceRepo.findPendingDeletionRequest(userId);
    const doc =
      existing ??
      (await complianceRepo.createDeletionRequest({
        userId,
        status: "pending",
        reason: reason || null,
        createdAt: new Date().toISOString(),
      }));

    await recordAudit({
      actorId: auth.actor.id,
      actorRole: auth.actor.role,
      action: "deletion.request",
      resource: "deletion_request",
      resourceId: doc.$id,
      meta: { alreadyPending: existing !== null },
    });
    return {
      ok: true,
      data: {
        id: doc.$id,
        status: "pending",
        createdAt: String(doc.createdAt ?? doc.$createdAt),
      },
    };
  } catch (error) {
    console.error("requestAccountDeletion failed");
    await recordAudit({
      actorId: auth.actor.id,
      actorRole: auth.actor.role,
      action: "deletion.request",
      resource: "deletion_request",
      resourceId: userId,
      outcome: "error",
      meta: errorMeta(error),
    });
    return fail(GENERIC);
  }
};

// --- admin ----------------------------------------------------------------

export type DeletionRequestRow = {
  id: string;
  userId: string;
  status: "pending" | "approved" | "rejected";
  reason: string | null;
  note: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
};

const toRow = (doc: Record<string, any>): DeletionRequestRow => ({
  id: doc.$id,
  userId: doc.userId,
  status: doc.status,
  reason: doc.reason ?? null,
  note: doc.note ?? null,
  createdAt: String(doc.createdAt ?? doc.$createdAt),
  resolvedAt: doc.resolvedAt ?? null,
  resolvedBy: doc.resolvedBy ?? null,
});

export const listDeletionRequests = async (): Promise<
  ActionResult<DeletionRequestRow[]>
> => {
  const auth = await authorizeAdmin("deletion.list", "deletion_request");
  if (!auth.ok) return auth.result;

  try {
    const result = await complianceRepo.listDeletionRequestDocuments({
      limit: 100,
      offset: 0,
    });
    await recordAudit({
      actorId: auth.actor.id,
      actorRole: auth.actor.role,
      action: "deletion.list",
      resource: "deletion_request",
      meta: { count: result.documents.length },
    });
    return {
      ok: true,
      data: result.documents.map((d) => toRow(d as Record<string, any>)),
    };
  } catch (error) {
    console.error("listDeletionRequests failed");
    await recordAudit({
      actorId: auth.actor.id,
      actorRole: auth.actor.role,
      action: "deletion.list",
      resource: "deletion_request",
      outcome: "error",
      meta: errorMeta(error),
    });
    return fail(GENERIC);
  }
};

const ResolveSchema = z.object({
  id: IdSchema,
  decision: z.enum(["approved", "rejected"]),
  note: z.string().trim().max(500).optional(),
});

type ErasureSummary = {
  files: number;
  appointments: number;
  patientFound: boolean;
};

// Erases personal data for a user. Every step tolerates "already gone" so a
// partially failed run can be retried. Anonymized appointment stats, consent
// history and audit rows are deliberately retained (see docs/compliance.md).
const eraseUserData = async (userId: string): Promise<ErasureSummary> => {
  const summary: ErasureSummary = {
    files: 0,
    appointments: 0,
    patientFound: false,
  };

  const patient = await patientRepo.getPatientByUserId(userId);
  if (patient) {
    summary.patientFound = true;
    const fileId = (
      patient as unknown as { identificationDocumentId?: string | null }
    ).identificationDocumentId;
    if (fileId) {
      await complianceRepo.deleteStoredFile(fileId);
      summary.files += 1;
    }
  }

  const appointments = await complianceRepo.listAppointmentsForUser(userId);
  for (const appointment of appointments) {
    await complianceRepo.anonymizeAppointment(appointment.$id);
    summary.appointments += 1;
  }

  if (patient) await complianceRepo.deletePatientDocument(patient.$id);
  await complianceRepo.deleteAuthUser(userId);
  return summary;
};

export const resolveDeletionRequest = async (params: {
  id: string;
  decision: "approved" | "rejected";
  note?: string;
}): Promise<ActionResult<DeletionRequestRow>> => {
  const auth = await authorizeAdmin("deletion.resolve", "deletion_request");
  if (!auth.ok) return auth.result;

  const parsed = ResolveSchema.safeParse(params);
  if (!parsed.success) return fail("Invalid request");
  const { id, decision, note } = parsed.data;

  const base = {
    actorId: auth.actor.id,
    actorRole: auth.actor.role,
    action: "deletion.resolve",
    resource: "deletion_request",
    resourceId: id,
  };

  try {
    const request = await complianceRepo.getDeletionRequest(id);
    if (!request) return fail("Request not found");

    // Idempotent: an already-resolved request is never processed twice.
    if (request.status !== "pending") {
      await recordAudit({ ...base, meta: { decision, alreadyResolved: true } });
      if (request.status === decision) {
        return { ok: true, data: toRow(request as Record<string, any>) };
      }
      return fail("This request has already been resolved");
    }

    let erasureSummary: string | null = null;
    if (decision === "approved") {
      try {
        const summary = await eraseUserData(String(request.userId));
        erasureSummary = JSON.stringify(summary);
        await recordAudit({
          ...base,
          action: "deletion.erase",
          resourceId: id,
          meta: {
            files: summary.files,
            appointments: summary.appointments,
            patientFound: summary.patientFound,
          },
        });
      } catch (error) {
        // Stays "pending": safe to retry, every erase step is idempotent.
        console.error("Erasure incomplete for deletion request");
        await recordAudit({
          ...base,
          action: "deletion.erase",
          outcome: "error",
          meta: errorMeta(error),
        });
        return fail("Erasure could not be completed. It is safe to retry.");
      }
    }

    const updated = await complianceRepo.updateDeletionRequest(id, {
      status: decision,
      note: note || null,
      resolvedBy: auth.actor.id,
      resolvedAt: new Date().toISOString(),
      erasureSummary,
    });

    await recordAudit({ ...base, meta: { decision } });
    return { ok: true, data: toRow(updated as Record<string, any>) };
  } catch (error) {
    console.error("resolveDeletionRequest failed");
    await recordAudit({ ...base, outcome: "error", meta: errorMeta(error) });
    return fail(GENERIC);
  }
};

const AuditQuerySchema = z.object({
  page: z.number().int().min(1).max(100_000).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
  action: z.string().trim().min(1).max(64).optional(),
  actorId: z.string().trim().min(1).max(64).optional(),
  from: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), "Invalid date")
    .optional(),
  to: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), "Invalid date")
    .optional(),
});

export type AuditLogRow = {
  id: string;
  createdAt: string;
  actorId: string | null;
  actorRole: string;
  action: string;
  resource: string;
  resourceId: string | null;
  outcome: string;
  requestId: string | null;
  ip: string | null;
  meta: Record<string, unknown> | null;
};

export type AuditLogPage = {
  logs: AuditLogRow[];
  total: number;
  page: number;
  pageSize: number;
};

const parseMeta = (raw: unknown): Record<string, unknown> | null => {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
};

export const listAuditLogs = async (params: {
  page?: number;
  pageSize?: number;
  action?: string;
  actorId?: string;
  from?: string;
  to?: string;
}): Promise<ActionResult<AuditLogPage>> => {
  const auth = await authorizeAdmin("audit.list", "audit_log");
  if (!auth.ok) return auth.result;

  const parsed = AuditQuerySchema.safeParse(params ?? {});
  if (!parsed.success) return fail("Invalid request");
  const { page, pageSize, action, actorId, from, to } = parsed.data;

  try {
    const result = await complianceRepo.listAuditLogDocuments({
      limit: pageSize,
      offset: (page - 1) * pageSize,
      action,
      actorId,
      from: from ? new Date(from).toISOString() : undefined,
      to: to ? new Date(to).toISOString() : undefined,
    });

    // Reading the audit trail is itself audited.
    await recordAudit({
      actorId: auth.actor.id,
      actorRole: auth.actor.role,
      action: "audit.list",
      resource: "audit_log",
      meta: {
        page,
        pageSize,
        total: result.total,
        filterAction: action,
        hasActorFilter: actorId !== undefined,
      },
    });

    return {
      ok: true,
      data: {
        total: result.total,
        page,
        pageSize,
        logs: result.documents.map((doc) => {
          const d = doc as Record<string, any>;
          return {
            id: d.$id,
            createdAt: String(d.createdAt ?? d.$createdAt),
            actorId: d.actorId ?? null,
            actorRole: d.actorRole,
            action: d.action,
            resource: d.resource,
            resourceId: d.resourceId ?? null,
            outcome: d.outcome,
            requestId: d.requestId ?? null,
            ip: d.ip ?? null,
            meta: parseMeta(d.meta),
          };
        }),
      },
    };
  } catch (error) {
    console.error("listAuditLogs failed");
    await recordAudit({
      actorId: auth.actor.id,
      actorRole: auth.actor.role,
      action: "audit.list",
      resource: "audit_log",
      outcome: "error",
      meta: errorMeta(error),
    });
    return fail(GENERIC);
  }
};
