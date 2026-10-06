import { ID, Query } from "node-appwrite";

import { WAITLIST_COLLECTION_ID } from "@/constants";
import { getEnv } from "@/lib/env";
import { WaitlistEntry, WaitlistStatus } from "@/types/appwrite.types";

import { getClients } from "./client";

export type NewWaitlistData = {
  userId: string;
  patientId: string;
  doctorId: string;
  earliest: Date;
  latest: Date;
};

export type WaitlistUpdate = {
  status?: WaitlistStatus;
  offeredStart?: string | null;
  offeredAt?: string | null;
};

export const createWaitlistEntry = async (data: NewWaitlistData) => {
  const { DATABASE_ID } = getEnv();
  return getClients().databases.createDocument<WaitlistEntry>(
    DATABASE_ID,
    WAITLIST_COLLECTION_ID,
    ID.unique(),
    {
      userId: data.userId,
      patientId: data.patientId,
      doctorId: data.doctorId,
      earliest: data.earliest.toISOString(),
      latest: data.latest.toISOString(),
      status: "waiting",
      createdAt: new Date().toISOString(),
    }
  );
};

export const getWaitlistEntry = async (entryId: string) => {
  const { DATABASE_ID } = getEnv();
  return getClients().databases.getDocument<WaitlistEntry>(
    DATABASE_ID,
    WAITLIST_COLLECTION_ID,
    entryId
  );
};

export const updateWaitlistEntry = async (
  entryId: string,
  data: WaitlistUpdate
) => {
  const { DATABASE_ID } = getEnv();
  return getClients().databases.updateDocument<WaitlistEntry>(
    DATABASE_ID,
    WAITLIST_COLLECTION_ID,
    entryId,
    data
  );
};

export const deleteWaitlistEntry = async (entryId: string) => {
  const { DATABASE_ID } = getEnv();
  await getClients().databases.deleteDocument(
    DATABASE_ID,
    WAITLIST_COLLECTION_ID,
    entryId
  );
};

/** Entries of a user that are still live (waiting or offered). */
export const listActiveEntriesForUser = async (userId: string) => {
  const { DATABASE_ID } = getEnv();
  const result = await getClients().databases.listDocuments<WaitlistEntry>(
    DATABASE_ID,
    WAITLIST_COLLECTION_ID,
    [
      Query.equal("userId", [userId]),
      Query.equal("status", ["waiting", "offered"]),
      Query.orderAsc("createdAt"),
      Query.limit(50),
    ]
  );
  return result.documents;
};

/** Waiting entries for a doctor, oldest first (fairness = FIFO). */
export const listWaitingForDoctor = async (doctorId: string) => {
  const { DATABASE_ID } = getEnv();
  const result = await getClients().databases.listDocuments<WaitlistEntry>(
    DATABASE_ID,
    WAITLIST_COLLECTION_ID,
    [
      Query.equal("doctorId", [doctorId]),
      Query.equal("status", ["waiting"]),
      Query.orderAsc("createdAt"),
      Query.limit(100),
    ]
  );
  return result.documents;
};
