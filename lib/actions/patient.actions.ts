"use server";

import { headers } from "next/headers";
import { Query } from "node-appwrite";

import { getClients, toUserMessage } from "@/lib/appwrite/client";
import * as patientRepo from "@/lib/appwrite/patient.repository";
import { AdminAuthError } from "@/lib/auth/admin";
import { isPatientAuthEnforced } from "@/lib/auth/config";
import { assertPatientOrStaffOwns, PatientAuthError } from "@/lib/auth/patient";
import { recordConsentGrants } from "@/lib/compliance/consent";
import { auditSafe } from "@/lib/scheduling/audit";
import { resolveDoctorByName } from "@/lib/scheduling/doctors";
import { parseStringify } from "@/lib/utils";
import {
  ALLOWED_ID_DOCUMENT_TYPES,
  CreateUserServerSchema,
  IdSchema,
  MAX_ID_DOCUMENT_BYTES,
  RegisterPatientServerSchema,
} from "@/lib/validation";
import { Patient } from "@/types/appwrite.types";

// Ownership: every userId-scoped action calls assertPatientOrStaffOwns(). That
// is a no-op for anonymous callers until PATIENT_AUTH_ENFORCED=true (patient
// login UI ships in a later phase); until then `userId` is still effectively
// client-supplied, exactly as before. Staff sessions are always recognised, so
// staff reads are audited (`patient.read`).

const fail = (error: string): { ok: false; error: string } => ({
  ok: false,
  error,
});

const firstIssue = (error: { issues: { message: string }[] }) =>
  error.issues[0]?.message ?? "Invalid input";

const UNAUTHORIZED = "Unauthorized";

const SIGN_IN_INSTEAD =
  "We could not start registration with these details. If you already have an account, please sign in.";

const isAuthError = (error: unknown) =>
  error instanceof PatientAuthError || error instanceof AdminAuthError;

// Best effort: outside a request scope headers() throws.
const clientIp = (): string | null => {
  try {
    const forwarded = headers().get("x-forwarded-for");
    return forwarded ? (forwarded.split(",")[0]?.trim() ?? null) : null;
  } catch {
    return null;
  }
};

// Detect the real file type from magic bytes; the client-declared MIME type
// is untrusted.
const sniffMimeType = async (blob: Blob): Promise<string | null> => {
  const bytes = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const startsWith = (sig: number[], offset = 0) =>
    sig.every((byte, i) => bytes[offset + i] === byte);

  if (startsWith([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return "image/png";
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8))
    return "image/webp";
  if (startsWith([0x25, 0x50, 0x44, 0x46])) return "application/pdf";
  return null;
};

const sanitizeFileName = (name: string) => {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[^\w.\- ]/g, "_").slice(-100).trim();
  return cleaned || "identification-document";
};

type ValidatedFile = { blob: Blob; fileName: string };

const validateIdentificationFile = async (
  formData: FormData | undefined
): Promise<ActionResult<ValidatedFile | null>> => {
  if (!formData) return { ok: true, data: null };

  const blob = formData.get("blobFile");
  const rawName = formData.get("fileName");

  if (blob === null) return { ok: true, data: null };
  if (!(blob instanceof Blob) || typeof rawName !== "string") {
    return fail("Invalid identification document");
  }
  if (blob.size === 0) return fail("Identification document is empty");
  if (blob.size > MAX_ID_DOCUMENT_BYTES) {
    return fail("Identification document must be 5 MB or smaller");
  }

  const allowed: readonly string[] = ALLOWED_ID_DOCUMENT_TYPES;
  const typeError =
    "Identification document must be a JPEG, PNG, WebP or PDF file";
  if (!allowed.includes(blob.type)) return fail(typeError);

  const detected = await sniffMimeType(blob);
  if (detected !== blob.type) return fail(typeError);

  return { ok: true, data: { blob, fileName: sanitizeFileName(rawName) } };
};

export const createUser = async (
  user: CreateUserParams
): Promise<ActionResult<User>> => {
  try {
    const parsed = CreateUserServerSchema.safeParse(user);
    if (!parsed.success) return fail(firstIssue(parsed.error));

    const { name, email, phone } = parsed.data;

    // IDOR guard. patientRepo.createUser() returns the EXISTING user on a
    // duplicate email, and this action is callable by anyone. Once patient
    // identity is enforced that would hand out another person's userId, so a
    // duplicate gets the same generic "sign in" answer as any other failure to
    // create. (Flag off: the old anonymous flow is kept on purpose.) The
    // enforced UI uses startPatientRegistration instead, which never returns ids.
    if (isPatientAuthEnforced()) {
      const existing = await getClients().users.list([
        Query.equal("email", [email.trim().toLowerCase()]),
        Query.limit(1),
      ]);
      if (existing.users.length > 0) return fail(SIGN_IN_INSTEAD);
    }

    const newUser = await patientRepo.createUser({ name, email, phone });

    // Race backstop: if a duplicate slipped in between the check above and the
    // create, the repo returned the pre-existing (old) user. Never hand it out.
    if (
      isPatientAuthEnforced() &&
      (!newUser || Date.now() - Date.parse(String(newUser.$createdAt)) > 60_000)
    ) {
      return fail(SIGN_IN_INSTEAD);
    }

    return { ok: true, data: parseStringify(newUser) };
  } catch (error) {
    console.error("An error occurred while creating a new user:", error);
    return fail(toUserMessage(error, "User not found"));
  }
};

export const getUser = async (userId: string): Promise<ActionResult<User>> => {
  try {
    const parsedId = IdSchema.safeParse(userId);
    if (!parsedId.success) return fail("Invalid user id");
    await assertPatientOrStaffOwns(parsedId.data);

    const user = await patientRepo.getUser(parsedId.data);
    return { ok: true, data: parseStringify(user) };
  } catch (error) {
    if (isAuthError(error)) return fail(UNAUTHORIZED);
    console.error("An error occurred while retrieving the user details:", error);
    return fail(toUserMessage(error, "User not found"));
  }
};

export const registerPatient = async (
  params: RegisterUserParams
): Promise<ActionResult<Patient>> => {
  let uploadedFileId: string | null = null;

  try {
    const { identificationDocument, ...rest } = params ?? ({} as RegisterUserParams);

    const parsed = RegisterPatientServerSchema.safeParse(rest);
    if (!parsed.success) return fail(firstIssue(parsed.error));
    const p = parsed.data;

    const file = await validateIdentificationFile(identificationDocument);
    if (!file.ok) return file;

    const access = await assertPatientOrStaffOwns(p.userId);

    const physician = await resolveDoctorByName(p.primaryPhysician);
    if (!physician) return fail("Select a valid doctor");

    // The user must exist, and must not already have a patient record.
    await patientRepo.getUser(p.userId);
    const existing = await patientRepo.getPatientByUserId(p.userId, {
      decrypt: false,
    });
    if (existing) return fail("This user is already registered as a patient");

    // Consent is recorded BEFORE the patient document exists: if this throws,
    // nothing was created, so a retry is not blocked by the "already
    // registered" check above. (Throws on failure by contract.)
    await recordConsentGrants({
      userId: p.userId,
      grants: {
        treatment: p.treatmentConsent,
        disclosure: p.disclosureConsent,
        privacy: p.privacyConsent,
      },
      ip: clientIp(),
    });

    let documentId: string | null = null;
    let documentUrl: string | null = null;
    if (file.data) {
      const uploaded = await patientRepo.uploadIdentificationFile(
        file.data.blob,
        file.data.fileName
      );
      uploadedFileId = uploaded.id;
      documentId = uploaded.id;
      documentUrl = uploaded.url;
    }

    // Explicit whitelist: nothing from the client reaches the DB unless listed.
    const newPatient = await patientRepo.createPatientDocument({
      userId: p.userId,
      name: p.name,
      email: p.email,
      phone: p.phone,
      birthDate: p.birthDate,
      gender: p.gender,
      address: p.address,
      occupation: p.occupation,
      emergencyContactName: p.emergencyContactName,
      emergencyContactNumber: p.emergencyContactNumber,
      primaryPhysician: p.primaryPhysician,
      insuranceProvider: p.insuranceProvider,
      insurancePolicyNumber: p.insurancePolicyNumber,
      allergies: p.allergies,
      currentMedication: p.currentMedication,
      familyMedicalHistory: p.familyMedicalHistory,
      pastMedicalHistory: p.pastMedicalHistory,
      identificationType: p.identificationType,
      identificationNumber: p.identificationNumber,
      identificationDocumentId: documentId,
      identificationDocumentUrl: documentUrl,
      privacyConsent: p.privacyConsent,
      treatmentConsent: p.treatmentConsent,
      disclosureConsent: p.disclosureConsent,
    });

    auditSafe({
      actorId: access.staff?.userId ?? p.userId,
      actorRole: access.staff?.role ?? "patient",
      action: "patient.register",
      resource: "patient",
      resourceId: String(newPatient.$id),
    });

    return { ok: true, data: parseStringify(newPatient) };
  } catch (error) {
    if (isAuthError(error)) return fail(UNAUTHORIZED);
    // Never log the params or documents: they contain PHI.
    console.error("An error occurred while creating a new patient:", error);

    // Don't leave an orphaned upload behind (best effort).
    if (uploadedFileId) {
      try {
        await patientRepo.deleteFile(uploadedFileId);
      } catch (cleanupError) {
        console.error(
          "Failed to delete orphaned identification document:",
          uploadedFileId,
          cleanupError
        );
      }
    }

    return fail(toUserMessage(error, "User not found"));
  }
};

export const getPatient = async (
  userId: string
): Promise<ActionResult<Patient | null>> => {
  try {
    const parsedId = IdSchema.safeParse(userId);
    if (!parsedId.success) return fail("Invalid user id");
    const access = await assertPatientOrStaffOwns(parsedId.data);

    const patient = await patientRepo.getPatientByUserId(parsedId.data);

    if (access.staff) {
      auditSafe({
        actorId: access.staff.userId,
        actorRole: access.staff.role,
        action: "patient.read",
        resource: "patient",
        resourceId: patient ? String(patient.$id) : undefined,
      });
    }
    return { ok: true, data: parseStringify(patient) };
  } catch (error) {
    if (isAuthError(error)) return fail(UNAUTHORIZED);
    console.error(
      "An error occurred while retrieving the patient details:",
      error
    );
    return fail(toUserMessage(error, "Patient not found"));
  }
};
