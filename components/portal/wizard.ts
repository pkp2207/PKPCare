// Registration wizard: step definitions, per-step validation and small pure
// helpers. The validation reuses the SAME zod schema as the server
// (PatientFormValidation), so client messages match what registerPatient
// would say; the server still re-validates everything.

import { IdentificationTypes } from "@/constants";
import { PatientFormValidation } from "@/lib/validation";

export type WizardStepId = "personal" | "medical" | "insurance" | "consent" | "review";

export type WizardStep = {
  id: WizardStepId;
  title: string;
  description: string;
  /** Form fields that belong to the step (empty for the review step). */
  fields: readonly string[];
};

export const WIZARD_STEPS: readonly WizardStep[] = [
  {
    id: "personal",
    title: "Personal",
    description: "Tell us who you are and how to reach you.",
    fields: [
      "name",
      "email",
      "phone",
      "birthDate",
      "gender",
      "address",
      "occupation",
      "emergencyContactName",
      "emergencyContactNumber",
    ],
  },
  {
    id: "medical",
    title: "Medical",
    description: "Your doctor and health background. Leave optional boxes empty if they do not apply.",
    fields: [
      "primaryPhysician",
      "allergies",
      "currentMedication",
      "familyMedicalHistory",
      "pastMedicalHistory",
    ],
  },
  {
    id: "insurance",
    title: "Insurance & ID",
    description: "Insurance details and a photo ID so we can verify who you are.",
    fields: [
      "insuranceProvider",
      "insurancePolicyNumber",
      "identificationType",
      "identificationNumber",
      "identificationDocument",
    ],
  },
  {
    id: "consent",
    title: "Consent",
    description: "Three separate choices. Nothing is ticked for you.",
    fields: ["treatmentConsent", "disclosureConsent", "privacyConsent"],
  },
  {
    id: "review",
    title: "Review",
    description: "Check everything, then submit.",
    fields: [],
  },
];

export const REVIEW_STEP_INDEX = WIZARD_STEPS.length - 1;

/** Human-readable field names for error summaries and the review step. */
export const FIELD_LABELS: Record<string, string> = {
  name: "Full name",
  email: "Email address",
  phone: "Phone number",
  birthDate: "Date of birth",
  gender: "Gender",
  address: "Address",
  occupation: "Occupation",
  emergencyContactName: "Emergency contact name",
  emergencyContactNumber: "Emergency contact number",
  primaryPhysician: "Primary care physician",
  allergies: "Allergies",
  currentMedication: "Current medications",
  familyMedicalHistory: "Family medical history",
  pastMedicalHistory: "Past medical history",
  insuranceProvider: "Insurance provider",
  insurancePolicyNumber: "Insurance policy number",
  identificationType: "Identification type",
  identificationNumber: "Identification number",
  identificationDocument: "Identification document",
  treatmentConsent: "Consent to treatment",
  disclosureConsent: "Consent to share health information",
  privacyConsent: "Privacy notice",
};

export type StepValidation = { ok: boolean; errors: Record<string, string> };

const startOfToday = (now: Date) => {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
};

/**
 * Validates only the fields that belong to `stepId`. Returns one message per
 * field (the first zod issue). The review step validates everything.
 */
export const validateStep = (
  stepId: WizardStepId,
  values: Record<string, unknown>,
  now: Date = new Date()
): StepValidation => {
  const step = WIZARD_STEPS.find((s) => s.id === stepId);
  if (!step) return { ok: true, errors: {} };

  const all = stepId === "review";
  const inStep = (field: string) => all || step.fields.includes(field);
  const errors: Record<string, string> = {};

  const parsed = PatientFormValidation.safeParse(values);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? "");
      if (field && inStep(field) && !errors[field]) errors[field] = issue.message;
    }
  }

  // The form opens with today's date so the picker has a value; that is not an
  // answer. The server also rejects future dates (RegisterPatientServerSchema).
  if (inStep("birthDate") && !errors.birthDate) {
    const raw = values.birthDate;
    const date = raw instanceof Date ? raw : new Date(String(raw ?? ""));
    if (Number.isNaN(date.getTime()) || date.getTime() >= startOfToday(now).getTime()) {
      errors.birthDate = "Enter your date of birth (it must be in the past)";
    }
  }

  return { ok: Object.keys(errors).length === 0, errors };
};

/** Index of the first step with an error across the whole form, or -1. */
export const firstInvalidStepIndex = (
  values: Record<string, unknown>,
  now: Date = new Date()
): number =>
  WIZARD_STEPS.findIndex(
    (step) => step.id !== "review" && !validateStep(step.id, values, now).ok
  );

/** Shows only the last 4 characters: "•••• 1234". Empty input stays empty. */
export const maskValue = (value: string | undefined | null, visible = 4): string => {
  const text = (value ?? "").trim();
  if (!text) return "";
  if (text.length <= visible) return "•".repeat(text.length);
  return `${"•".repeat(Math.min(4, text.length - visible))} ${text.slice(-visible)}`;
};

export type IdPrefillFields = Partial<{
  name: string;
  birthDate: string;
  identificationNumber: string;
  identificationType: string;
}>;

/**
 * Turns A1's IdPrefill suggestions into form values, dropping anything that
 * would not pass the form's own rules (unknown ID type, future / garbled date,
 * over-long strings). The patient reviews the result on the next step.
 */
export const applyIdPrefill = (
  fields: IdPrefillFields,
  now: Date = new Date()
): Partial<{
  name: string;
  birthDate: Date;
  identificationNumber: string;
  identificationType: string;
}> => {
  const out: ReturnType<typeof applyIdPrefill> = {};

  const name = typeof fields.name === "string" ? fields.name.trim() : "";
  if (name.length >= 2 && name.length <= 50) out.name = name;

  if (typeof fields.birthDate === "string" && fields.birthDate.trim()) {
    const date = new Date(fields.birthDate.trim());
    if (!Number.isNaN(date.getTime()) && date.getTime() < startOfToday(now).getTime()) {
      out.birthDate = date;
    }
  }

  const number =
    typeof fields.identificationNumber === "string" ? fields.identificationNumber.trim() : "";
  if (number && number.length <= 100) out.identificationNumber = number;

  if (
    typeof fields.identificationType === "string" &&
    (IdentificationTypes as readonly string[]).includes(fields.identificationType)
  ) {
    out.identificationType = fields.identificationType;
  }

  return out;
};
