// `payments` collection + the appointment `depositStatus` attribute.
// Server API key only; no client permissions (see scripts/schema/payments.json).
import { createHash } from "node:crypto";

import { type Models, Query } from "node-appwrite";

import { getClients } from "@/lib/appwrite/client";
import { getEnv } from "@/lib/env";

export const PAYMENTS_COLLECTION_ID = "payments";

export type PaymentStatus = "pending" | "paid" | "failed" | "expired" | "refunded";
export type DepositStatus = PaymentStatus | "waived";

export interface PaymentDoc extends Models.Document {
  appointmentId: string;
  userId: string;
  provider: string;
  providerSessionId: string;
  providerPaymentId?: string | null;
  amountMinor: number;
  currency: string;
  status: PaymentStatus;
  checkoutUrl?: string | null;
  eventIds?: string[] | null;
  createdAt: string;
  expiresAt?: string | null;
  paidAt?: string | null;
}

export type NewPayment = Omit<PaymentDoc, keyof Models.Document>;

/** Deterministic id per (appointment, attempt): a concurrent duplicate gets 409. */
export const paymentDocId = (appointmentId: string, attempt: number): string =>
  `p${createHash("sha256").update(`${appointmentId}:${attempt}`).digest("hex").slice(0, 35)}`;

export const createPayment = async (id: string, data: NewPayment) => {
  const { DATABASE_ID } = getEnv();
  return getClients().databases.createDocument<PaymentDoc>(
    DATABASE_ID,
    PAYMENTS_COLLECTION_ID,
    id,
    data
  );
};

export const getPayment = async (id: string) => {
  const { DATABASE_ID } = getEnv();
  return getClients().databases.getDocument<PaymentDoc>(
    DATABASE_ID,
    PAYMENTS_COLLECTION_ID,
    id
  );
};

export const updatePayment = async (id: string, patch: Partial<NewPayment>) => {
  const { DATABASE_ID } = getEnv();
  return getClients().databases.updateDocument<PaymentDoc>(
    DATABASE_ID,
    PAYMENTS_COLLECTION_ID,
    id,
    patch
  );
};

/** All payment attempts for an appointment, newest first. */
export const listPaymentsForAppointment = async (appointmentId: string) => {
  const { DATABASE_ID } = getEnv();
  const result = await getClients().databases.listDocuments<PaymentDoc>(
    DATABASE_ID,
    PAYMENTS_COLLECTION_ID,
    [
      Query.equal("appointmentId", [appointmentId]),
      Query.orderDesc("createdAt"),
      Query.limit(25),
    ]
  );
  return result.documents;
};

export const findPaymentBySession = async (
  providerSessionId: string
): Promise<PaymentDoc | null> => {
  const { DATABASE_ID } = getEnv();
  const result = await getClients().databases.listDocuments<PaymentDoc>(
    DATABASE_ID,
    PAYMENTS_COLLECTION_ID,
    [Query.equal("providerSessionId", [providerSessionId]), Query.limit(1)]
  );
  return result.documents[0] ?? null;
};

/**
 * Best effort mirror of the payment state onto the appointment. Returns false
 * (and logs) when the appointments collection has no `depositStatus` attribute
 * yet; the payments collection stays the source of truth.
 */
export const setAppointmentDepositStatus = async (
  appointmentId: string,
  status: DepositStatus
): Promise<boolean> => {
  const { DATABASE_ID, APPOINTMENT_COLLECTION_ID } = getEnv();
  try {
    await getClients().databases.updateDocument(
      DATABASE_ID,
      APPOINTMENT_COLLECTION_ID,
      appointmentId,
      { depositStatus: status }
    );
    return true;
  } catch (error) {
    if ((error as { code?: number } | null)?.code === 400) {
      console.error("[payments] appointments.depositStatus attribute missing; run appwrite-setup");
      return false;
    }
    throw error;
  }
};
