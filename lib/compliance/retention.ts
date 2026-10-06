// Retention. The numbers below are PLACEHOLDERS, not legal advice: the actual
// periods depend on jurisdiction, record type and contract, and must be set by
// counsel / the data protection owner. `null` disables that purge entirely.
import * as complianceRepo from "@/lib/appwrite/compliance.repository";
import { getEnv } from "@/lib/env";

import { recordAudit } from "./audit";
import {
  AUDIT_LOGS_COLLECTION_ID,
  DELETION_REQUESTS_COLLECTION_ID,
} from "./constants";

export const RETENTION: {
  /** Days to keep audit log rows. PLACEHOLDER (~6 years). */
  auditLogDays: number | null;
  /**
   * Days to keep an uploaded ID document before it is deleted from storage and
   * detached from the patient record. There is no "verified at" marker yet, so
   * the clock starts at patient registration. Disabled by default (null) so
   * nothing is deleted until counsel sets a period. PLACEHOLDER.
   */
  idDocumentDaysAfterVerification: number | null;
  /** Days to keep approved/rejected deletion requests. PLACEHOLDER (~3 years). */
  closedDeletionRequestDays: number | null;
} = {
  auditLogDays: 2190,
  idDocumentDaysAfterVerification: null,
  closedDeletionRequestDays: 1095,
};

/** Upper bound per record type per run, to keep a cron invocation short. */
export const MAX_PURGE_PER_RUN = 500;
const PAGE = 100;

export type PurgeResult = {
  dryRun: boolean;
  /** Dry run: rows that WOULD be purged. Otherwise: rows actually purged. */
  auditLogs: number;
  idDocuments: number;
  deletionRequests: number;
  errors: number;
};

const cutoffIso = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString();

type Doc = { $id: string } & Record<string, unknown>;

const purgeCollection = async ({
  collectionId,
  field,
  days,
  dryRun,
  remove,
  result,
}: {
  collectionId: string;
  field: string;
  days: number | null;
  dryRun: boolean;
  remove: (doc: Doc) => Promise<void>;
  result: PurgeResult;
}): Promise<number> => {
  if (days === null) return 0;
  const cutoff = cutoffIso(days);

  if (dryRun) {
    const probe = await complianceRepo.listOlderThan({
      collectionId,
      field,
      cutoffIso: cutoff,
      limit: 1,
    });
    return probe.total;
  }

  let purged = 0;
  while (purged < MAX_PURGE_PER_RUN) {
    const page = await complianceRepo.listOlderThan({
      collectionId,
      field,
      cutoffIso: cutoff,
      limit: Math.min(PAGE, MAX_PURGE_PER_RUN - purged),
    });
    if (page.documents.length === 0) break;

    let progressed = 0;
    for (const doc of page.documents as unknown as Doc[]) {
      try {
        await remove(doc);
        purged += 1;
        progressed += 1;
      } catch {
        result.errors += 1;
      }
    }
    // Avoid spinning on rows that keep failing.
    if (progressed === 0) break;
  }
  return purged;
};

const MAX_SCAN_PER_RUN = 2000;

// Patients can't be filtered on "has an ID document" without an extra index,
// so scan the expired window and act on rows that still hold a document.
const purgeIdDocuments = async ({
  dryRun,
  result,
}: {
  dryRun: boolean;
  result: PurgeResult;
}): Promise<number> => {
  const days = RETENTION.idDocumentDaysAfterVerification;
  if (days === null) return 0;

  const collectionId = getEnv().PATIENT_COLLECTION_ID;
  const cutoff = cutoffIso(days);
  let scanned = 0;
  let affected = 0;

  while (scanned < MAX_SCAN_PER_RUN && affected < MAX_PURGE_PER_RUN) {
    const page = await complianceRepo.listOlderThan({
      collectionId,
      field: "$createdAt",
      cutoffIso: cutoff,
      limit: PAGE,
      offset: scanned,
    });
    if (page.documents.length === 0) break;
    scanned += page.documents.length;

    for (const doc of page.documents as unknown as Doc[]) {
      const fileId = doc.identificationDocumentId;
      if (typeof fileId !== "string" || !fileId) continue;
      if (affected >= MAX_PURGE_PER_RUN) break;
      if (dryRun) {
        affected += 1;
        continue;
      }
      try {
        await complianceRepo.deleteStoredFile(fileId);
        await complianceRepo.clearPatientIdentificationDocument(doc.$id);
        affected += 1;
      } catch {
        result.errors += 1;
      }
    }
    if (page.documents.length < PAGE) break;
  }
  return affected;
};

/**
 * Server function (NOT a public server action). Invoked by the cron route.
 * Dry run only counts; a real run is bounded by MAX_PURGE_PER_RUN per type.
 */
export const purgeExpiredRecords = async ({
  dryRun,
}: {
  dryRun: boolean;
}): Promise<PurgeResult> => {
  const result: PurgeResult = {
    dryRun,
    auditLogs: 0,
    idDocuments: 0,
    deletionRequests: 0,
    errors: 0,
  };

  const step = async (fn: () => Promise<number>): Promise<number> => {
    try {
      return await fn();
    } catch {
      result.errors += 1;
      return 0;
    }
  };

  result.auditLogs = await step(() =>
    purgeCollection({
      collectionId: AUDIT_LOGS_COLLECTION_ID,
      field: "createdAt",
      days: RETENTION.auditLogDays,
      dryRun,
      result,
      remove: (doc) =>
        complianceRepo.deleteDocumentById(AUDIT_LOGS_COLLECTION_ID, doc.$id),
    }),
  );

  result.idDocuments = await step(() => purgeIdDocuments({ dryRun, result }));

  result.deletionRequests = await step(() =>
    purgeCollection({
      collectionId: DELETION_REQUESTS_COLLECTION_ID,
      field: "resolvedAt",
      days: RETENTION.closedDeletionRequestDays,
      dryRun,
      result,
      remove: (doc) =>
        complianceRepo.deleteDocumentById(
          DELETION_REQUESTS_COLLECTION_ID,
          doc.$id,
        ),
    }),
  );

  await recordAudit({
    actorId: null,
    actorRole: "system",
    action: "retention.purge",
    resource: "retention",
    outcome: result.errors > 0 ? "error" : "success",
    meta: {
      dryRun,
      auditLogs: result.auditLogs,
      idDocuments: result.idDocuments,
      deletionRequests: result.deletionRequests,
      errors: result.errors,
    },
  });

  return result;
};
