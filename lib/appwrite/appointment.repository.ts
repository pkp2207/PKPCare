import { ID, Query } from "node-appwrite";

import { getEnv } from "@/lib/env";
import { Appointment } from "@/types/appwrite.types";

import { getClients } from "./client";

export type NewAppointmentData = {
  userId: string;
  patient: string;
  primaryPhysician: string;
  reason: string;
  schedule: Date;
  status: Status;
  note?: string;
};

export type AppointmentUpdateData = {
  primaryPhysician?: string;
  schedule?: Date;
  status?: Status;
  cancellationReason?: string | null;
};

export const createAppointmentDocument = async (data: NewAppointmentData) => {
  const { DATABASE_ID, APPOINTMENT_COLLECTION_ID } = getEnv();
  return getClients().databases.createDocument(
    DATABASE_ID,
    APPOINTMENT_COLLECTION_ID,
    ID.unique(),
    data
  );
};

export const listAppointments = async ({
  status,
  limit,
  offset,
}: {
  status?: Status;
  limit: number;
  offset: number;
}) => {
  const { DATABASE_ID, APPOINTMENT_COLLECTION_ID } = getEnv();
  const queries = [
    Query.orderDesc("$createdAt"),
    Query.limit(limit),
    Query.offset(offset),
  ];
  if (status) queries.push(Query.equal("status", [status]));
  return getClients().databases.listDocuments(
    DATABASE_ID,
    APPOINTMENT_COLLECTION_ID,
    queries
  );
};

/** Count via Appwrite `total` (limit 1 keeps the payload tiny). */
export const countAppointments = async (status?: Status): Promise<number> => {
  const { DATABASE_ID, APPOINTMENT_COLLECTION_ID } = getEnv();
  const queries = [Query.limit(1)];
  if (status) queries.push(Query.equal("status", [status]));
  const result = await getClients().databases.listDocuments(
    DATABASE_ID,
    APPOINTMENT_COLLECTION_ID,
    queries
  );
  return result.total;
};

/**
 * Returns a non-cancelled appointment for the physician whose schedule lies
 * strictly between `after` and `before`, or null. `excludeId` skips the
 * appointment being rescheduled.
 */
export const findConflictingAppointment = async ({
  primaryPhysician,
  after,
  before,
  excludeId,
}: {
  primaryPhysician: string;
  after: Date;
  before: Date;
  excludeId?: string;
}) => {
  const { DATABASE_ID, APPOINTMENT_COLLECTION_ID } = getEnv();
  const queries = [
    Query.equal("primaryPhysician", [primaryPhysician]),
    Query.notEqual("status", "cancelled"),
    Query.greaterThan("schedule", after.toISOString()),
    Query.lessThan("schedule", before.toISOString()),
    Query.limit(1),
  ];
  if (excludeId) queries.push(Query.notEqual("$id", excludeId));
  const result = await getClients().databases.listDocuments(
    DATABASE_ID,
    APPOINTMENT_COLLECTION_ID,
    queries
  );
  return result.documents[0] ?? null;
};

export const updateAppointmentDocument = async (
  appointmentId: string,
  data: AppointmentUpdateData
) => {
  const { DATABASE_ID, APPOINTMENT_COLLECTION_ID } = getEnv();
  return getClients().databases.updateDocument(
    DATABASE_ID,
    APPOINTMENT_COLLECTION_ID,
    appointmentId,
    data
  );
};

export const getAppointmentDocument = async (appointmentId: string) => {
  const { DATABASE_ID, APPOINTMENT_COLLECTION_ID } = getEnv();
  return getClients().databases.getDocument<Appointment>(
    DATABASE_ID,
    APPOINTMENT_COLLECTION_ID,
    appointmentId
  );
};

export const sendSms = async (userId: string, content: string) => {
  return getClients().messaging.createSms(ID.unique(), content, [], [userId]);
};
