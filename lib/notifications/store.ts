// Data access for the notification features. Kept separate from
// lib/appwrite/appointment.repository so that file stays owned by scheduling;
// these only touch the attributes added in scripts/schema/appointments.json
// (reminder24hSentAt, reminder1hSentAt, confirmedByPatientAt) and read-only
// windows over appointments / offered waitlist entries.
import { Query } from "node-appwrite";

import { WAITLIST_COLLECTION_ID } from "@/constants";
import { getClients } from "@/lib/appwrite/client";
import { getEnv } from "@/lib/env";
import type { Appointment, WaitlistEntry } from "@/types/appwrite.types";

export type NotificationAppointment = Appointment & {
  reminder24hSentAt?: string | null;
  reminder1hSentAt?: string | null;
  confirmedByPatientAt?: string | null;
  depositStatus?: string | null;
};

export type AppointmentFlagPatch = {
  reminder24hSentAt?: string;
  reminder1hSentAt?: string;
  confirmedByPatientAt?: string;
};

/** Scheduled appointments with `from <= schedule <= to`, soonest first. */
export const listScheduledInWindow = async (
  from: Date,
  to: Date,
  limit: number
): Promise<NotificationAppointment[]> => {
  const { DATABASE_ID, APPOINTMENT_COLLECTION_ID } = getEnv();
  const result = await getClients().databases.listDocuments<NotificationAppointment>(
    DATABASE_ID,
    APPOINTMENT_COLLECTION_ID,
    [
      Query.equal("status", ["scheduled"]),
      Query.between("schedule", from.toISOString(), to.toISOString()),
      Query.orderAsc("schedule"),
      Query.limit(limit),
    ]
  );
  return result.documents;
};

export const patchAppointmentFlags = async (
  appointmentId: string,
  patch: AppointmentFlagPatch
) => {
  const { DATABASE_ID, APPOINTMENT_COLLECTION_ID } = getEnv();
  return getClients().databases.updateDocument(
    DATABASE_ID,
    APPOINTMENT_COLLECTION_ID,
    appointmentId,
    patch
  );
};

export const getNotificationAppointment = async (appointmentId: string) => {
  const { DATABASE_ID, APPOINTMENT_COLLECTION_ID } = getEnv();
  return getClients().databases.getDocument<NotificationAppointment>(
    DATABASE_ID,
    APPOINTMENT_COLLECTION_ID,
    appointmentId
  );
};

/**
 * Waitlist entries currently in the `offered` state, oldest offer first.
 * Needs the `idx_status_offered` index from scripts/schema/waitlist_offers.json.
 */
export const listOfferedWaitlist = async (
  limit: number
): Promise<WaitlistEntry[]> => {
  const { DATABASE_ID } = getEnv();
  const result = await getClients().databases.listDocuments<WaitlistEntry>(
    DATABASE_ID,
    WAITLIST_COLLECTION_ID,
    [
      Query.equal("status", ["offered"]),
      Query.orderAsc("offeredAt"),
      Query.limit(limit),
    ]
  );
  return result.documents;
};
