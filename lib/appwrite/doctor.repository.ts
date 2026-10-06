import { ID, Query } from "node-appwrite";

import { DOCTORS_COLLECTION_ID } from "@/constants";
import { getEnv } from "@/lib/env";
import { Doctor } from "@/types/appwrite.types";

import { getClients, isNotFound } from "./client";

export type DoctorData = {
  name: string;
  specialty: string;
  image: string;
  email?: string | null;
  staffUserId?: string | null;
  active: boolean;
  slotMinutes: number;
  timezone: string;
  weeklyHours: string;
  timeOff: string;
};

export const generateDoctorId = () => ID.unique();

export const listDoctors = async ({
  activeOnly = false,
  limit = 100,
}: { activeOnly?: boolean; limit?: number } = {}) => {
  const { DATABASE_ID } = getEnv();
  const queries = [Query.orderAsc("name"), Query.limit(limit)];
  if (activeOnly) queries.push(Query.equal("active", [true]));
  const result = await getClients().databases.listDocuments<Doctor>(
    DATABASE_ID,
    DOCTORS_COLLECTION_ID,
    queries
  );
  return result.documents;
};

/** Total doctors regardless of `active`; 0 when the collection is missing. */
export const countDoctors = async (): Promise<number> => {
  const { DATABASE_ID } = getEnv();
  try {
    const result = await getClients().databases.listDocuments<Doctor>(
      DATABASE_ID,
      DOCTORS_COLLECTION_ID,
      [Query.limit(1)]
    );
    return result.total;
  } catch (error) {
    if (isNotFound(error)) return 0;
    throw error;
  }
};

export const getDoctor = async (doctorId: string) => {
  const { DATABASE_ID } = getEnv();
  return getClients().databases.getDocument<Doctor>(
    DATABASE_ID,
    DOCTORS_COLLECTION_ID,
    doctorId
  );
};

export const findDoctorByName = async (name: string) => {
  const { DATABASE_ID } = getEnv();
  const result = await getClients().databases.listDocuments<Doctor>(
    DATABASE_ID,
    DOCTORS_COLLECTION_ID,
    [Query.equal("name", [name]), Query.limit(1)]
  );
  return result.documents[0] ?? null;
};

export const findDoctorByStaffUserId = async (staffUserId: string) => {
  const { DATABASE_ID } = getEnv();
  const result = await getClients().databases.listDocuments<Doctor>(
    DATABASE_ID,
    DOCTORS_COLLECTION_ID,
    [Query.equal("staffUserId", [staffUserId]), Query.limit(1)]
  );
  return result.documents[0] ?? null;
};

export const createDoctor = async (doctorId: string, data: DoctorData) => {
  const { DATABASE_ID } = getEnv();
  return getClients().databases.createDocument<Doctor>(
    DATABASE_ID,
    DOCTORS_COLLECTION_ID,
    doctorId,
    data
  );
};

export const updateDoctor = async (
  doctorId: string,
  data: Partial<DoctorData>
) => {
  const { DATABASE_ID } = getEnv();
  return getClients().databases.updateDocument<Doctor>(
    DATABASE_ID,
    DOCTORS_COLLECTION_ID,
    doctorId,
    data
  );
};
