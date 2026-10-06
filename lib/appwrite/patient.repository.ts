import { ID, InputFile, Query } from "node-appwrite";

import { getEnv } from "@/lib/env";

import { getClients } from "./client";

export type PatientDocumentData = Omit<
  RegisterUserParams,
  "identificationDocument"
> & {
  identificationDocumentId?: string | null;
  identificationDocumentUrl?: string | null;
};

export const createUser = async (user: CreateUserParams) => {
  const { users } = getClients();
  try {
    return await users.create(
      ID.unique(),
      user.email,
      user.phone,
      undefined,
      user.name
    );
  } catch (error: any) {
    if (error?.code === 409) {
      const existing = await users.list([Query.equal("email", [user.email])]);
      return existing.users[0];
    }
    throw error;
  }
};

export const getUser = async (userId: string) => {
  return getClients().users.get(userId);
};

export const uploadIdentificationFile = async (
  blob: Blob,
  fileName: string
): Promise<{ id: string; url: string }> => {
  const { ENDPOINT, PROJECT_ID, BUCKET_ID } = getEnv();
  const inputFile = InputFile.fromBlob(blob, fileName);
  const file = await getClients().storage.createFile(
    BUCKET_ID,
    ID.unique(),
    inputFile
  );
  return {
    id: file.$id,
    url: `${ENDPOINT}/storage/buckets/${BUCKET_ID}/files/${file.$id}/view?project=${PROJECT_ID}`,
  };
};

export const deleteFile = async (fileId: string) => {
  const { BUCKET_ID } = getEnv();
  return getClients().storage.deleteFile(BUCKET_ID, fileId);
};

export const createPatientDocument = async (patient: PatientDocumentData) => {
  const { DATABASE_ID, PATIENT_COLLECTION_ID } = getEnv();
  return getClients().databases.createDocument(
    DATABASE_ID,
    PATIENT_COLLECTION_ID,
    ID.unique(),
    patient
  );
};

export const getPatientByUserId = async (userId: string) => {
  const { DATABASE_ID, PATIENT_COLLECTION_ID } = getEnv();
  const result = await getClients().databases.listDocuments(
    DATABASE_ID,
    PATIENT_COLLECTION_ID,
    [Query.equal("userId", [userId]), Query.limit(1)]
  );
  return result.documents[0] ?? null;
};
