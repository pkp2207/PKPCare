import { z } from "zod";

import { Doctors } from "@/constants";

export const UserFormValidation = z.object({
  name: z
    .string()
    .min(2, "Name must be at least 2 characters")
    .max(50, "Name must be at most 50 characters"),
  email: z.string().email("Invalid email address"),
  phone: z
    .string()
    .refine((phone) => /^\+\d{10,15}$/.test(phone), "Invalid phone number"),
});

export const PatientFormValidation = z.object({
  name: z
    .string()
    .min(2, "Name must be at least 2 characters")
    .max(50, "Name must be at most 50 characters"),
  email: z.string().email("Invalid email address"),
  phone: z
    .string()
    .refine((phone) => /^\+\d{10,15}$/.test(phone), "Invalid phone number"),
  birthDate: z.coerce.date(),
  gender: z.enum(["Male", "Female", "Other"]),
  address: z
    .string()
    .min(5, "Address must be at least 5 characters")
    .max(500, "Address must be at most 500 characters"),
  occupation: z
    .string()
    .min(2, "Occupation must be at least 2 characters")
    .max(500, "Occupation must be at most 500 characters"),
  emergencyContactName: z
    .string()
    .min(2, "Contact name must be at least 2 characters")
    .max(50, "Contact name must be at most 50 characters"),
  emergencyContactNumber: z
    .string()
    .refine(
      (emergencyContactNumber) => /^\+\d{10,15}$/.test(emergencyContactNumber),
      "Invalid phone number"
    ),
  primaryPhysician: z.string().min(2, "Select at least one doctor"),
  insuranceProvider: z
    .string()
    .min(2, "Insurance name must be at least 2 characters")
    .max(50, "Insurance name must be at most 50 characters"),
  insurancePolicyNumber: z
    .string()
    .min(2, "Policy number must be at least 2 characters")
    .max(50, "Policy number must be at most 50 characters"),
  allergies: z.string().optional(),
  currentMedication: z.string().optional(),
  familyMedicalHistory: z.string().optional(),
  pastMedicalHistory: z.string().optional(),
  identificationType: z.string().optional(),
  identificationNumber: z.string().optional(),
  identificationDocument: z.custom<File[]>().optional(),
  treatmentConsent: z
    .boolean()
    .default(false)
    .refine((value) => value === true, {
      message: "You must consent to treatment in order to proceed",
    }),
  disclosureConsent: z
    .boolean()
    .default(false)
    .refine((value) => value === true, {
      message: "You must consent to disclosure in order to proceed",
    }),
  privacyConsent: z
    .boolean()
    .default(false)
    .refine((value) => value === true, {
      message: "You must consent to privacy in order to proceed",
    }),
});

export const CreateAppointmentSchema = z.object({
  primaryPhysician: z.string().min(2, "Select at least one doctor"),
  schedule: z.coerce.date(),
  reason: z
    .string()
    .min(2, "Reason must be at least 2 characters")
    .max(500, "Reason must be at most 500 characters"),
  note: z.string().optional(),
  cancellationReason: z.string().optional(),
});

export const ScheduleAppointmentSchema = z.object({
  primaryPhysician: z.string().min(2, "Select at least one doctor"),
  schedule: z.coerce.date(),
  reason: z.string().optional(),
  note: z.string().optional(),
  cancellationReason: z.string().optional(),
});

export const CancelAppointmentSchema = z.object({
  primaryPhysician: z.string().min(2, "Select at least one doctor"),
  schedule: z.coerce.date(),
  reason: z.string().optional(),
  note: z.string().optional(),
  cancellationReason: z
    .string()
    .min(2, "Reason must be at least 2 characters")
    .max(500, "Reason must be at most 500 characters"),
});

export function getAppointmentSchema(type: string) {
  switch (type) {
    case "create":
      return CreateAppointmentSchema;
    case "cancel":
      return CancelAppointmentSchema;
    default:
      return ScheduleAppointmentSchema;
  }
}

// ---------------------------------------------------------------------------
// Server-side schemas. Client-side form schemas above are UX only; actions must
// re-validate everything here because server actions are public endpoints.
// ---------------------------------------------------------------------------

const DoctorNames = Doctors.map((doctor) => doctor.name);

// Appwrite custom id charset: a-z A-Z 0-9 . - _ (max 36, no leading special).
export const IdSchema = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/, "Invalid id");

export const PhysicianSchema = z
  .string()
  .refine((name) => DoctorNames.includes(name), "Select a valid doctor");

export const StatusSchema = z.enum(["pending", "scheduled", "cancelled"]);

const OptionalText = (max: number) => z.string().max(max).optional();

export const CreateUserServerSchema = UserFormValidation;

/** Server schema for RegisterUserParams minus the file (validated separately). */
export const RegisterPatientServerSchema = PatientFormValidation.omit({
  identificationDocument: true,
})
  .extend({
    userId: IdSchema,
    birthDate: z.coerce
      .date()
      .refine((date) => date.getTime() <= Date.now(), "Invalid birth date"),
    primaryPhysician: PhysicianSchema,
    allergies: OptionalText(2000),
    currentMedication: OptionalText(2000),
    familyMedicalHistory: OptionalText(2000),
    pastMedicalHistory: OptionalText(2000),
    identificationType: OptionalText(100),
    identificationNumber: OptionalText(100),
  });

export const CreateAppointmentServerSchema = CreateAppointmentSchema.pick({
  reason: true,
  note: true,
  schedule: true,
})
  .extend({
    userId: IdSchema,
    patient: IdSchema,
    primaryPhysician: PhysicianSchema,
    note: OptionalText(500),
  });

export const ALLOWED_ID_DOCUMENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

export const MAX_ID_DOCUMENT_BYTES = 5 * 1024 * 1024;
