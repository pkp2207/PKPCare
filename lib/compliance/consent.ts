// Purpose-specific consent, stored as an append-only history: every grant or
// withdrawal is a new row and the current state of a purpose is its latest row.
import * as complianceRepo from "@/lib/appwrite/compliance.repository";

import { getRequestContext } from "./request-context";

/** Bump when consent/privacy wording changes; stored with each consent row. */
export const CURRENT_POLICY_VERSION = "2026-10-01";

export const CONSENT_PURPOSES = ["treatment", "disclosure", "privacy"] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

export type ConsentGrants = Record<ConsentPurpose, boolean>;

export type ConsentRecord = {
  userId: string;
  purpose: string;
  granted: boolean;
  policyVersion: string;
  createdAt: string;
};

export type ConsentState = {
  purpose: ConsentPurpose;
  granted: boolean;
  policyVersion: string | null;
  updatedAt: string | null;
};

export const isConsentPurpose = (value: unknown): value is ConsentPurpose =>
  typeof value === "string" &&
  (CONSENT_PURPOSES as readonly string[]).includes(value);

/**
 * Pure. Latest row per purpose wins (by createdAt; ties resolve to the row
 * that appears first, so pass rows newest first). Purposes with no rows are
 * reported as not granted.
 */
export const deriveConsentState = (
  rows: readonly ConsentRecord[],
): ConsentState[] => {
  const sorted = rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const diff = Date.parse(b.row.createdAt) - Date.parse(a.row.createdAt);
      return Number.isNaN(diff) || diff === 0 ? a.index - b.index : diff;
    });

  return CONSENT_PURPOSES.map((purpose) => {
    const latest = sorted.find(({ row }) => row.purpose === purpose)?.row;
    return {
      purpose,
      granted: latest?.granted === true,
      policyVersion: latest?.policyVersion ?? null,
      updatedAt: latest?.createdAt ?? null,
    };
  });
};

type RecordChangeParams = {
  userId: string;
  purpose: ConsentPurpose;
  granted: boolean;
  policyVersion?: string;
  ip?: string | null;
  source?: string;
};

const writeRecord = ({
  userId,
  purpose,
  granted,
  policyVersion = CURRENT_POLICY_VERSION,
  ip,
  source,
}: RecordChangeParams) =>
  complianceRepo.createConsentRecord({
    userId,
    purpose,
    granted,
    policyVersion,
    source: source ?? null,
    ip: ip ?? getRequestContext().ip,
    createdAt: new Date().toISOString(),
  });

/** Records a single grant/withdrawal. THROWS on failure. */
export const recordConsentChange = async (
  params: RecordChangeParams,
): Promise<void> => {
  if (!params.userId) throw new Error("userId is required");
  if (!isConsentPurpose(params.purpose))
    throw new Error("Unknown consent purpose");
  await writeRecord(params);
};

/** One row per purpose. THROWS on failure (callers must not proceed silently). */
export const recordConsentGrants = async ({
  userId,
  grants,
  policyVersion = CURRENT_POLICY_VERSION,
  ip,
}: {
  userId: string;
  grants: { treatment: boolean; disclosure: boolean; privacy: boolean };
  policyVersion?: string;
  ip?: string | null;
}): Promise<void> => {
  if (!userId) throw new Error("userId is required");
  await Promise.all(
    CONSENT_PURPOSES.map((purpose) =>
      writeRecord({
        userId,
        purpose,
        granted: grants[purpose] === true,
        policyVersion,
        ip,
        source: "registration",
      }),
    ),
  );
};

export const getConsentHistory = async (
  userId: string,
): Promise<ConsentRecord[]> => {
  const docs = await complianceRepo.listConsentRecords(userId);
  return docs.map((doc) => ({
    userId: String(doc.userId),
    purpose: String(doc.purpose),
    granted: doc.granted === true,
    policyVersion: String(doc.policyVersion),
    createdAt: String(doc.createdAt ?? doc.$createdAt),
  }));
};

export const getConsentState = async (
  userId: string,
): Promise<ConsentState[]> =>
  deriveConsentState(await getConsentHistory(userId));

export const hasActiveConsent = async (
  userId: string,
  purpose: ConsentPurpose,
): Promise<boolean> =>
  (await getConsentState(userId)).find((s) => s.purpose === purpose)
    ?.granted === true;
