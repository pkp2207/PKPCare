// Read-only data access for the FHIR facade. Server only. Kept in one module
// so the handler can be unit tested against a mock of it.
//
// Documents are returned RAW (patient fields may be ciphertext): decryption is
// the handler's decision, taken only when the token scope allows it.
import { Query } from "node-appwrite";

import { DOCTORS_COLLECTION_ID } from "@/constants";
import * as appointmentRepo from "@/lib/appwrite/appointment.repository";
import { getClients, isNotFound } from "@/lib/appwrite/client";
import * as slotRepo from "@/lib/appwrite/slot.repository";
import {
  type ConsentRecord,
  getConsentHistory,
} from "@/lib/compliance/consent";
import { getEnv } from "@/lib/env";
import type { Appointment, Doctor, Patient } from "@/types/appwrite.types";

export type Page<T> = { documents: T[]; total: number };

const orNull = async <T>(load: () => Promise<T>): Promise<T | null> => {
  try {
    return await load();
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
};

// ---- patients --------------------------------------------------------------

export const getPatientById = (id: string): Promise<Patient | null> => {
  const { DATABASE_ID, PATIENT_COLLECTION_ID } = getEnv();
  return orNull(() =>
    getClients().databases.getDocument<Patient>(
      DATABASE_ID,
      PATIENT_COLLECTION_ID,
      id,
    ),
  );
};

/** Exactly one of `userId` / `email` (exact match). Both are plaintext fields. */
export const findPatients = async ({
  userId,
  email,
  limit,
  offset,
}: {
  userId?: string;
  email?: string;
  limit: number;
  offset: number;
}): Promise<Page<Patient>> => {
  const { DATABASE_ID, PATIENT_COLLECTION_ID } = getEnv();
  const queries = [Query.limit(limit), Query.offset(offset)];
  if (userId) queries.push(Query.equal("userId", [userId]));
  if (email) queries.push(Query.equal("email", [email]));
  return getClients().databases.listDocuments<Patient>(
    DATABASE_ID,
    PATIENT_COLLECTION_ID,
    queries,
  );
};

// ---- doctors ---------------------------------------------------------------

export const getDoctorById = (id: string): Promise<Doctor | null> => {
  const { DATABASE_ID } = getEnv();
  return orNull(() =>
    getClients().databases.getDocument<Doctor>(
      DATABASE_ID,
      DOCTORS_COLLECTION_ID,
      id,
    ),
  );
};

export const listDoctorsPage = async ({
  limit,
  offset,
}: {
  limit: number;
  offset: number;
}): Promise<Page<Doctor>> => {
  const { DATABASE_ID } = getEnv();
  try {
    return await getClients().databases.listDocuments<Doctor>(
      DATABASE_ID,
      DOCTORS_COLLECTION_ID,
      [Query.orderAsc("name"), Query.limit(limit), Query.offset(offset)],
    );
  } catch (error) {
    if (isNotFound(error)) return { documents: [], total: 0 };
    throw error;
  }
};

/** Doctors by id, for display names / durations (missing ids are skipped). */
export const getDoctorsByIds = async (ids: string[]): Promise<Doctor[]> => {
  const unique = Array.from(new Set(ids)).slice(0, 100);
  if (unique.length === 0) return [];
  const { DATABASE_ID } = getEnv();
  try {
    const result = await getClients().databases.listDocuments<Doctor>(
      DATABASE_ID,
      DOCTORS_COLLECTION_ID,
      [Query.equal("$id", unique), Query.limit(unique.length)],
    );
    return result.documents;
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }
};

// ---- appointments ----------------------------------------------------------

export const getAppointmentById = (id: string): Promise<Appointment | null> =>
  orNull(() => appointmentRepo.getAppointmentDocument(id));

export const searchAppointments = async ({
  userId,
  doctorId,
  status,
  gte,
  lt,
  limit,
  offset,
}: {
  userId?: string;
  doctorId?: string;
  status?: string[];
  /** Inclusive lower bound on `schedule` (epoch ms). */
  gte?: number;
  /** Exclusive upper bound on `schedule` (epoch ms). */
  lt?: number;
  limit: number;
  offset: number;
}): Promise<Page<Appointment>> => {
  const { DATABASE_ID, APPOINTMENT_COLLECTION_ID } = getEnv();
  const queries = [
    Query.orderAsc("schedule"),
    Query.limit(limit),
    Query.offset(offset),
  ];
  if (userId) queries.push(Query.equal("userId", [userId]));
  if (doctorId) queries.push(Query.equal("doctorId", [doctorId]));
  if (status && status.length > 0) queries.push(Query.equal("status", status));
  if (gte !== undefined) {
    queries.push(Query.greaterThanEqual("schedule", new Date(gte).toISOString()));
  }
  if (lt !== undefined) {
    queries.push(Query.lessThan("schedule", new Date(lt).toISOString()));
  }
  return getClients().databases.listDocuments<Appointment>(
    DATABASE_ID,
    APPOINTMENT_COLLECTION_ID,
    queries,
  );
};

// ---- slots -----------------------------------------------------------------

export const listHeldSlots = (doctorId: string, from: Date, to: Date) =>
  slotRepo.listSlots(doctorId, from, to);

/** Legacy appointments (no slot document) holding a doctor's time. */
export const listLegacyScheduleTimes = (
  doctorName: string,
  from: Date,
  to: Date,
) => appointmentRepo.listActiveScheduleTimes(doctorName, from, to);

// ---- consent ---------------------------------------------------------------

export const listConsentHistory = (userId: string): Promise<ConsentRecord[]> =>
  getConsentHistory(userId);
