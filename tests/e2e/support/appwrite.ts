import { Client, Databases, Query, Storage, Users } from "node-appwrite";

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (loaded from .env)`);
  return value;
};

const clients = () => {
  const client = new Client()
    .setEndpoint(required("NEXT_PUBLIC_ENDPOINT"))
    .setProject(required("PROJECT_ID"))
    .setKey(required("API_KEY"));
  return {
    databases: new Databases(client),
    users: new Users(client),
    storage: new Storage(client),
    db: required("DATABASE_ID"),
    patients: required("PATIENT_COLLECTION_ID"),
    appointments: required("APPOINTMENT_COLLECTION_ID"),
    bucket: required("NEXT_PUBLIC_BUCKET_ID"),
  };
};

const attempt = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
  } catch {
    /* already gone */
  }
};

/**
 * Removes everything a test patient created: appointments, their slots, the patient
 * document, the uploaded ID file and the Appwrite user. Consent, audit and
 * deletion-request rows are append-only by design and stay.
 */
export const cleanupTestPatient = async (email: string) => {
  const c = clients();
  const found = await c.users.list([Query.equal("email", [email]), Query.limit(1)]);
  const user = found.users[0];
  if (!user) return;

  const appointments = await c.databases.listDocuments(c.db, c.appointments, [
    Query.equal("userId", [user.$id]),
    Query.limit(100),
  ]);
  for (const appointment of appointments.documents) {
    const slots = await c.databases
      .listDocuments(c.db, "slots", [Query.equal("appointmentId", [appointment.$id]), Query.limit(10)])
      .catch(() => ({ documents: [] as { $id: string }[] }));
    for (const slot of slots.documents) {
      await attempt(() => c.databases.deleteDocument(c.db, "slots", slot.$id));
    }
    await attempt(() => c.databases.deleteDocument(c.db, c.appointments, appointment.$id));
  }

  const patients = await c.databases.listDocuments(c.db, c.patients, [
    Query.equal("userId", [user.$id]),
    Query.limit(5),
  ]);
  for (const patient of patients.documents) {
    const fileId = (patient as unknown as { identificationDocumentId?: string | null })
      .identificationDocumentId;
    if (fileId) await attempt(() => c.storage.deleteFile(c.bucket, fileId));
    await attempt(() => c.databases.deleteDocument(c.db, c.patients, patient.$id));
  }
  await attempt(() => c.users.delete(user.$id));
};

/** Direct read used to prove encryption at rest. */
export const getRawPatientByEmail = async (email: string) => {
  const c = clients();
  const user = (await c.users.list([Query.equal("email", [email]), Query.limit(1)])).users[0];
  if (!user) return null;
  const result = await c.databases.listDocuments(c.db, c.patients, [
    Query.equal("userId", [user.$id]),
    Query.limit(1),
  ]);
  return (result.documents[0] as unknown as Record<string, unknown>) ?? null;
};
