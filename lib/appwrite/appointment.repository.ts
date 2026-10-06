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
  doctorId?: string;
  slotId?: string;
  visitType?: VisitType;
};

export type AppointmentUpdateData = {
  primaryPhysician?: string;
  schedule?: Date;
  status?: Status;
  cancellationReason?: string | null;
  doctorId?: string | null;
  slotId?: string | null;
  visitType?: VisitType;
  cancelledBy?: "patient" | "staff" | "system";
  reminderSentAt?: string | null;
};

/** Pre-generate an id so a slot document can reference its appointment. */
export const generateAppointmentId = () => ID.unique();

export const createAppointmentDocument = async (
  data: NewAppointmentData,
  id: string = ID.unique()
) => {
  const { DATABASE_ID, APPOINTMENT_COLLECTION_ID } = getEnv();
  return getClients().databases.createDocument(
    DATABASE_ID,
    APPOINTMENT_COLLECTION_ID,
    id,
    data
  );
};

export const listAppointments = async ({
  status,
  doctorId,
  limit,
  offset,
}: {
  status?: Status;
  doctorId?: string;
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
  if (doctorId) queries.push(Query.equal("doctorId", [doctorId]));
  return getClients().databases.listDocuments<Appointment>(
    DATABASE_ID,
    APPOINTMENT_COLLECTION_ID,
    queries
  );
};

/** Count via Appwrite `total` (limit 1 keeps the payload tiny). */
export const countAppointments = async (
  status?: Status,
  doctorId?: string
): Promise<number> => {
  const { DATABASE_ID, APPOINTMENT_COLLECTION_ID } = getEnv();
  const queries = [Query.limit(1)];
  if (status) queries.push(Query.equal("status", [status]));
  if (doctorId) queries.push(Query.equal("doctorId", [doctorId]));
  const result = await getClients().databases.listDocuments(
    DATABASE_ID,
    APPOINTMENT_COLLECTION_ID,
    queries
  );
  return result.total;
};

/** A user's own appointments, soonest first. */
export const listAppointmentsByUser = async (userId: string, limit = 50) => {
  const { DATABASE_ID, APPOINTMENT_COLLECTION_ID } = getEnv();
  const result = await getClients().databases.listDocuments<Appointment>(
    DATABASE_ID,
    APPOINTMENT_COLLECTION_ID,
    [
      Query.equal("userId", [userId]),
      Query.orderDesc("schedule"),
      Query.limit(limit),
    ]
  );
  return result.documents;
};

/**
 * Returns a non-cancelled appointment for the physician whose schedule lies
 * strictly between `after` and `before`, or null. `excludeId` skips the
 * appointment being rescheduled. Defence in depth next to the atomic slot
 * document, and the only guard for legacy appointments that have no slotId.
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

/**
 * Schedules (ISO) of a physician's non-cancelled appointments in
 * [from, to). Used so availability also hides legacy bookings that have no
 * slot document.
 */
export const listActiveScheduleTimes = async (
  primaryPhysician: string,
  from: Date,
  to: Date
): Promise<string[]> => {
  const { DATABASE_ID, APPOINTMENT_COLLECTION_ID } = getEnv();
  const result = await getClients().databases.listDocuments<Appointment>(
    DATABASE_ID,
    APPOINTMENT_COLLECTION_ID,
    [
      Query.equal("primaryPhysician", [primaryPhysician]),
      Query.notEqual("status", "cancelled"),
      Query.greaterThanEqual("schedule", from.toISOString()),
      Query.lessThan("schedule", to.toISOString()),
      Query.limit(100),
    ]
  );
  return result.documents.map((doc) => String(doc.schedule));
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
