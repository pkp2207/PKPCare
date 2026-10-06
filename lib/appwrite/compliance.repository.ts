import { ID, type Models, Query } from "node-appwrite";

import {
  AUDIT_LOGS_COLLECTION_ID,
  CONSENTS_COLLECTION_ID,
  DELETION_REQUESTS_COLLECTION_ID,
} from "@/lib/compliance/constants";
import { getEnv } from "@/lib/env";

import { getClients } from "./client";

// Server-only. Collections here carry no document/collection permissions; they
// are reachable only through the server API key.

export type AuditOutcome = "success" | "denied" | "error";

export type AuditLogData = {
  actorId: string | null;
  actorRole: string;
  action: string;
  resource: string;
  resourceId: string | null;
  outcome: AuditOutcome;
  requestId: string | null;
  ip: string | null;
  meta: string | null;
  createdAt: string;
};

export type ConsentRecordData = {
  userId: string;
  purpose: string;
  granted: boolean;
  policyVersion: string;
  source: string | null;
  ip: string | null;
  createdAt: string;
};

export type DeletionRequestStatus = "pending" | "approved" | "rejected";

export type DeletionRequestData = {
  userId: string;
  status: DeletionRequestStatus;
  reason: string | null;
  createdAt: string;
  note?: string | null;
  resolvedBy?: string | null;
  resolvedAt?: string | null;
  erasureSummary?: string | null;
};

// Collection schemas are defined in scripts/schema; documents are loosely typed.
export type AnyDocument = Models.Document & Record<string, any>;

const isNotFound = (error: unknown) =>
  (error as { code?: number } | null)?.code === 404;

const db = () => {
  const { DATABASE_ID } = getEnv();
  return { databases: getClients().databases, DATABASE_ID };
};

// --- audit logs -----------------------------------------------------------

export const createAuditLog = async (data: AuditLogData) => {
  const { databases, DATABASE_ID } = db();
  return databases.createDocument(
    DATABASE_ID,
    AUDIT_LOGS_COLLECTION_ID,
    ID.unique(),
    data,
  );
};

export const listAuditLogDocuments = async ({
  limit,
  offset,
  action,
  actorId,
  from,
  to,
}: {
  limit: number;
  offset: number;
  action?: string;
  actorId?: string;
  from?: string;
  to?: string;
}) => {
  const { databases, DATABASE_ID } = db();
  const queries = [
    Query.orderDesc("createdAt"),
    Query.limit(limit),
    Query.offset(offset),
  ];
  if (action) queries.push(Query.equal("action", [action]));
  if (actorId) queries.push(Query.equal("actorId", [actorId]));
  if (from) queries.push(Query.greaterThanEqual("createdAt", from));
  if (to) queries.push(Query.lessThanEqual("createdAt", to));
  return databases.listDocuments<AnyDocument>(
    DATABASE_ID,
    AUDIT_LOGS_COLLECTION_ID,
    queries,
  );
};

// --- consents (append-only) ---------------------------------------------

export const createConsentRecord = async (data: ConsentRecordData) => {
  const { databases, DATABASE_ID } = db();
  return databases.createDocument(
    DATABASE_ID,
    CONSENTS_COLLECTION_ID,
    ID.unique(),
    data,
  );
};

/** All consent rows for a user, newest first (bounded). */
export const listConsentRecords = async (userId: string) => {
  const { databases, DATABASE_ID } = db();
  const result = await databases.listDocuments<AnyDocument>(
    DATABASE_ID,
    CONSENTS_COLLECTION_ID,
    [
      Query.equal("userId", [userId]),
      Query.orderDesc("createdAt"),
      Query.orderDesc("$createdAt"),
      Query.limit(500),
    ],
  );
  return result.documents;
};

// --- deletion requests ----------------------------------------------------

export const createDeletionRequest = async (data: DeletionRequestData) => {
  const { databases, DATABASE_ID } = db();
  return databases.createDocument<AnyDocument>(
    DATABASE_ID,
    DELETION_REQUESTS_COLLECTION_ID,
    ID.unique(),
    data,
  );
};

export const getDeletionRequest = async (id: string) => {
  const { databases, DATABASE_ID } = db();
  try {
    return await databases.getDocument<AnyDocument>(
      DATABASE_ID,
      DELETION_REQUESTS_COLLECTION_ID,
      id,
    );
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
};

export const findPendingDeletionRequest = async (userId: string) => {
  const { databases, DATABASE_ID } = db();
  const result = await databases.listDocuments<AnyDocument>(
    DATABASE_ID,
    DELETION_REQUESTS_COLLECTION_ID,
    [
      Query.equal("userId", [userId]),
      Query.equal("status", ["pending"]),
      Query.limit(1),
    ],
  );
  return result.documents[0] ?? null;
};

export const listDeletionRequestDocuments = async ({
  status,
  limit,
  offset,
}: {
  status?: DeletionRequestStatus;
  limit: number;
  offset: number;
}) => {
  const { databases, DATABASE_ID } = db();
  const queries = [
    Query.orderDesc("createdAt"),
    Query.limit(limit),
    Query.offset(offset),
  ];
  if (status) queries.push(Query.equal("status", [status]));
  return databases.listDocuments<AnyDocument>(
    DATABASE_ID,
    DELETION_REQUESTS_COLLECTION_ID,
    queries,
  );
};

export const updateDeletionRequest = async (
  id: string,
  data: Partial<DeletionRequestData>,
) => {
  const { databases, DATABASE_ID } = db();
  return databases.updateDocument<AnyDocument>(
    DATABASE_ID,
    DELETION_REQUESTS_COLLECTION_ID,
    id,
    data,
  );
};

// --- erasure helpers (all idempotent: 404 is treated as already done) ---

export const listAppointmentsForUser = async (userId: string, max = 500) => {
  const { APPOINTMENT_COLLECTION_ID } = getEnv();
  const { databases, DATABASE_ID } = db();
  const documents: AnyDocument[] = [];
  while (documents.length < max) {
    const page = await databases.listDocuments<AnyDocument>(
      DATABASE_ID,
      APPOINTMENT_COLLECTION_ID,
      [
        Query.equal("userId", [userId]),
        Query.orderAsc("$createdAt"),
        Query.limit(Math.min(100, max - documents.length)),
        Query.offset(documents.length),
      ],
    );
    documents.push(...page.documents);
    if (page.documents.length === 0 || documents.length >= page.total) break;
  }
  return documents;
};

export const ERASED_PLACEHOLDER = "[erased]";
export const ERASED_USER_ID = "erased";

/**
 * Strips personal/free-text content from an appointment but keeps the fields
 * needed for anonymized statistics (schedule, status, physician).
 */
export const anonymizeAppointment = async (appointmentId: string) => {
  const { APPOINTMENT_COLLECTION_ID } = getEnv();
  const { databases, DATABASE_ID } = db();
  const base = {
    userId: ERASED_USER_ID,
    reason: ERASED_PLACEHOLDER,
    note: "",
    cancellationReason: null,
  };
  try {
    // Detach the patient relationship first so deleting the patient document
    // cannot cascade-delete the appointment (depends on relationship config).
    await databases.updateDocument(
      DATABASE_ID,
      APPOINTMENT_COLLECTION_ID,
      appointmentId,
      {
        ...base,
        patient: null,
      },
    );
  } catch (error) {
    if (isNotFound(error)) return;
    // Relationship not nullable in this schema: still scrub the content.
    try {
      await databases.updateDocument(
        DATABASE_ID,
        APPOINTMENT_COLLECTION_ID,
        appointmentId,
        base,
      );
    } catch (inner) {
      if (!isNotFound(inner)) throw inner;
    }
  }
};

export const deletePatientDocument = async (documentId: string) => {
  const { PATIENT_COLLECTION_ID } = getEnv();
  const { databases, DATABASE_ID } = db();
  try {
    await databases.deleteDocument(
      DATABASE_ID,
      PATIENT_COLLECTION_ID,
      documentId,
    );
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
};

export const deleteStoredFile = async (fileId: string) => {
  const { BUCKET_ID } = getEnv();
  try {
    await getClients().storage.deleteFile(BUCKET_ID, fileId);
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
};

export const deleteAuthUser = async (userId: string) => {
  try {
    await getClients().users.delete(userId);
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
};

// --- retention helpers ----------------------------------------------------

/** Documents whose `field` is older than `cutoffIso`; `total` is the full match count. */
export const listOlderThan = async ({
  collectionId,
  field,
  cutoffIso,
  limit,
  offset = 0,
}: {
  collectionId: string;
  field: string;
  cutoffIso: string;
  limit: number;
  offset?: number;
}) => {
  const { databases, DATABASE_ID } = db();
  return databases.listDocuments<AnyDocument>(DATABASE_ID, collectionId, [
    Query.lessThan(field, cutoffIso),
    Query.orderAsc(field),
    Query.limit(limit),
    Query.offset(offset),
  ]);
};

export const deleteDocumentById = async (
  collectionId: string,
  documentId: string,
) => {
  const { databases, DATABASE_ID } = db();
  try {
    await databases.deleteDocument(DATABASE_ID, collectionId, documentId);
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
};

export const clearPatientIdentificationDocument = async (
  patientDocumentId: string,
) => {
  const { PATIENT_COLLECTION_ID } = getEnv();
  const { databases, DATABASE_ID } = db();
  return databases.updateDocument(
    DATABASE_ID,
    PATIENT_COLLECTION_ID,
    patientDocumentId,
    {
      identificationDocumentId: null,
      identificationDocumentUrl: null,
    },
  );
};
