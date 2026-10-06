// Pure mappers from PKPCare models to FHIR R4 JSON. No I/O, no clock reads
// (callers pass `now`), no FHIR library.
//
// Privacy rule: the default output is MINIMAL. Insurance, identification
// numbers, medical-history / allergy / medication text, emergency contacts,
// appointment reasons / notes and cancellation reasons are emitted only when
// `sensitive: true` (the API grants that only for a token holding the
// `read:sensitive` scope AND an explicit `_include=sensitive`). Even then a
// value that still looks like ciphertext (`enc:...`) is never emitted.
import { APPOINTMENT_SLOT_MINUTES } from "@/constants";
import type { ConsentRecord, ConsentState } from "@/lib/compliance/consent";

import {
  FHIR_SYSTEMS,
  type FhirCodeableConcept,
  type FhirReference,
  type FhirResource,
} from "./types";

export type MapOptions = { sensitive?: boolean };

const MS_PER_MIN = 60_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Non-empty plaintext string, or undefined. Ciphertext is never emitted. */
const text = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("enc:")) return undefined;
  return trimmed;
};

const toDate = (value: unknown): Date | null => {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value as string);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** FHIR `instant` (UTC, millisecond precision) or undefined. */
export const toInstant = (value: unknown): string | undefined =>
  toDate(value)?.toISOString();

const meta = (updatedAt: unknown) => {
  const lastUpdated = toInstant(updatedAt);
  return lastUpdated ? { lastUpdated } : undefined;
};

/** FHIR ids allow [A-Za-z0-9\-.]{1,64}; synthesized ids replace anything else. */
export const toFhirId = (value: string): string =>
  value.replace(/[^A-Za-z0-9.-]/g, "-").slice(0, 64);

const ref = (type: string, id: string, display?: string): FhirReference => ({
  reference: `${type}/${id}`,
  ...(display ? { display } : {}),
});

const compact = <T extends Record<string, unknown>>(obj: T): T => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return out as T;
};

const ext = (name: string, value: string) => ({
  url: `${FHIR_SYSTEMS.extension}/${name}`,
  valueString: value,
});

const HONORIFIC = /^(dr|prof|mr|mrs|ms|miss)\.?$/i;

/** "Dr. John Green" -> prefix ["Dr."], given ["John"], family "Green". */
const humanName = (full: string) => {
  const parts = full.split(/\s+/).filter(Boolean);
  const prefix: string[] = [];
  while (parts.length > 1 && HONORIFIC.test(parts[0])) {
    prefix.push(parts.shift() as string);
  }
  const family = parts.length > 1 ? parts.pop() : undefined;
  return compact({
    use: "official" as const,
    text: full,
    family,
    given: parts.length > 0 && family ? parts : undefined,
    prefix,
  });
};

const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);

// ---------------------------------------------------------------------------
// Patient
// ---------------------------------------------------------------------------

export type PatientSource = {
  $id: string;
  $updatedAt?: string;
  userId?: string;
  name?: string;
  email?: string;
  phone?: string;
  birthDate?: string | Date;
  gender?: string;
  address?: string;
  occupation?: string;
  emergencyContactName?: string;
  emergencyContactNumber?: string;
  insuranceProvider?: string;
  insurancePolicyNumber?: string;
  allergies?: string;
  currentMedication?: string;
  familyMedicalHistory?: string;
  pastMedicalHistory?: string;
  identificationType?: string;
  identificationNumber?: string;
};

const GENDER: Record<string, "male" | "female" | "other"> = {
  male: "male",
  female: "female",
  other: "other",
};

export const mapGender = (value: unknown): "male" | "female" | "other" | "unknown" =>
  (typeof value === "string" && GENDER[value.trim().toLowerCase()]) || "unknown";

export const mapPatient = (
  doc: PatientSource,
  options: MapOptions = {},
): FhirResource => {
  const name = text(doc.name);
  const email = text(doc.email);
  const phone = text(doc.phone);
  const address = text(doc.address);
  const birth = toDate(doc.birthDate);
  const userId = text(doc.userId);

  const identifier: Record<string, unknown>[] = [];
  if (userId) identifier.push({ system: FHIR_SYSTEMS.userId, value: userId });

  const resource: FhirResource = compact({
    resourceType: "Patient",
    id: doc.$id,
    meta: meta(doc.$updatedAt),
    identifier,
    active: true,
    name: name ? [humanName(name)] : undefined,
    telecom: [
      email ? { system: "email", value: email } : undefined,
      phone ? { system: "phone", value: phone } : undefined,
    ].filter(Boolean),
    gender: mapGender(doc.gender),
    birthDate: birth ? birth.toISOString().slice(0, 10) : undefined,
    address: address ? [{ text: address }] : undefined,
  });

  if (!options.sensitive) return resource;

  const idType = text(doc.identificationType);
  const idNumber = text(doc.identificationNumber);
  if (idNumber) {
    identifier.push({
      system: `${FHIR_SYSTEMS.identification}:${slug(idType ?? "unspecified") || "unspecified"}`,
      type: idType ? { text: idType } : undefined,
      value: idNumber,
    });
    resource.identifier = identifier;
  }

  const extensions = [
    ["insurance-provider", text(doc.insuranceProvider)],
    ["insurance-policy-number", text(doc.insurancePolicyNumber)],
    ["occupation", text(doc.occupation)],
    ["allergies", text(doc.allergies)],
    ["current-medication", text(doc.currentMedication)],
    ["family-medical-history", text(doc.familyMedicalHistory)],
    ["past-medical-history", text(doc.pastMedicalHistory)],
  ]
    .filter((pair): pair is [string, string] => Boolean(pair[1]))
    .map(([key, value]) => ext(key, value));
  if (extensions.length > 0) resource.extension = extensions;

  const contactName = text(doc.emergencyContactName);
  const contactPhone = text(doc.emergencyContactNumber);
  if (contactName || contactPhone) {
    resource.contact = [
      compact({
        relationship: [{ text: "Emergency contact" }],
        name: contactName ? { text: contactName } : undefined,
        telecom: contactPhone ? [{ system: "phone", value: contactPhone }] : undefined,
      }),
    ];
  }
  return resource;
};

// ---------------------------------------------------------------------------
// Practitioner / PractitionerRole / Schedule
// ---------------------------------------------------------------------------

export type DoctorSource = {
  $id: string;
  $updatedAt?: string;
  name: string;
  specialty?: string;
  active?: boolean;
  timezone?: string;
  slotMinutes?: number;
};

/** Never emits email, staffUserId or image. */
export const mapPractitioner = (doc: DoctorSource): FhirResource =>
  compact({
    resourceType: "Practitioner",
    id: doc.$id,
    meta: meta(doc.$updatedAt),
    active: doc.active !== false,
    name: text(doc.name) ? [humanName(text(doc.name) as string)] : undefined,
  }) as FhirResource;

/** PractitionerRole id equals the doctor id (one role per doctor). */
export const mapPractitionerRole = (doc: DoctorSource): FhirResource => {
  const specialty = text(doc.specialty);
  return compact({
    resourceType: "PractitionerRole",
    id: doc.$id,
    meta: meta(doc.$updatedAt),
    active: doc.active !== false,
    practitioner: ref("Practitioner", doc.$id, text(doc.name)),
    specialty: specialty ? [{ text: specialty } as FhirCodeableConcept] : undefined,
  }) as FhirResource;
};

/** Schedule id equals the doctor id. */
export const mapSchedule = (
  doc: DoctorSource,
  options: { now: Date; horizonDays: number },
): FhirResource => {
  const start = options.now.toISOString();
  const end = new Date(
    options.now.getTime() + options.horizonDays * 86_400_000,
  ).toISOString();
  return compact({
    resourceType: "Schedule",
    id: doc.$id,
    meta: meta(doc.$updatedAt),
    active: doc.active !== false,
    actor: [ref("Practitioner", doc.$id, text(doc.name))],
    planningHorizon: { start, end },
    comment: doc.timezone ? `Working hours are in ${doc.timezone}.` : undefined,
  }) as FhirResource;
};

// ---------------------------------------------------------------------------
// Slot
// ---------------------------------------------------------------------------

export type FhirSlotStatus = "free" | "busy" | "busy-unavailable";

/** Synthesized id; stable for a (doctor, start) pair. */
export const fhirSlotId = (doctorId: string, start: Date | number): string =>
  toFhirId(`${doctorId}-${new Date(start).getTime()}`);

export const mapSlot = (slot: {
  doctorId: string;
  start: Date;
  end: Date;
  status: FhirSlotStatus;
}): FhirResource => ({
  resourceType: "Slot",
  id: fhirSlotId(slot.doctorId, slot.start),
  schedule: ref("Schedule", slot.doctorId),
  status: slot.status,
  start: slot.start.toISOString(),
  end: slot.end.toISOString(),
});

// ---------------------------------------------------------------------------
// Appointment
// ---------------------------------------------------------------------------

export type AppointmentStatus = "pending" | "scheduled" | "cancelled";
export type FhirAppointmentStatus = "proposed" | "booked" | "cancelled";

const STATUS_TO_FHIR: Record<AppointmentStatus, FhirAppointmentStatus> = {
  pending: "proposed",
  scheduled: "booked",
  cancelled: "cancelled",
};

export const mapAppointmentStatus = (status: unknown): FhirAppointmentStatus =>
  STATUS_TO_FHIR[status as AppointmentStatus] ?? "proposed";

/** Inverse mapping for the `status` search parameter; null when unknown. */
export const appointmentStatusFromFhir = (value: string): AppointmentStatus | null => {
  switch (value) {
    case "proposed":
      return "pending";
    case "booked":
      return "scheduled";
    case "cancelled":
      return "cancelled";
    default:
      return null;
  }
};

export type AppointmentSource = {
  $id: string;
  $createdAt?: string;
  $updatedAt?: string;
  schedule: string | Date;
  status: string;
  primaryPhysician?: string;
  doctorId?: string | null;
  visitType?: string | null;
  reason?: string;
  note?: string;
  cancellationReason?: string | null;
  // Relationship: an expanded document or a bare id. Only the id is ever read.
  patient?: string | { $id?: string } | null;
};

const VISIT_TYPES: Record<string, { code: string; display: string }> = {
  in_person: { code: "in_person", display: "In-person visit" },
  video: { code: "video", display: "Video visit" },
};

export const mapAppointment = (
  doc: AppointmentSource,
  options: MapOptions & { durationMinutes?: number; doctorName?: string } = {},
): FhirResource => {
  const start = toDate(doc.schedule);
  const minutes =
    Number.isInteger(options.durationMinutes) && (options.durationMinutes as number) > 0
      ? (options.durationMinutes as number)
      : APPOINTMENT_SLOT_MINUTES;
  const end = start ? new Date(start.getTime() + minutes * MS_PER_MIN) : null;

  const patientId =
    typeof doc.patient === "string" ? doc.patient : doc.patient?.$id;
  const status = mapAppointmentStatus(doc.status);
  const doctorDisplay = text(options.doctorName) ?? text(doc.primaryPhysician);

  const participant: Record<string, unknown>[] = [];
  if (patientId) {
    participant.push({ actor: ref("Patient", patientId), status: "accepted" });
  }
  if (doc.doctorId) {
    participant.push({
      actor: ref("Practitioner", doc.doctorId, doctorDisplay),
      status: doc.status === "pending" ? "needs-action" : "accepted",
    });
  } else if (doctorDisplay) {
    // Legacy appointment without a doctor document: display name only.
    participant.push({
      actor: { display: doctorDisplay },
      status: doc.status === "pending" ? "needs-action" : "accepted",
    });
  }
  if (participant.length === 0) participant.push({ status: "needs-action" });

  const visit = typeof doc.visitType === "string" ? VISIT_TYPES[doc.visitType] : undefined;
  const reason = options.sensitive ? text(doc.reason) : undefined;
  const comment = options.sensitive ? text(doc.note) : undefined;
  const cancelation =
    options.sensitive && status === "cancelled" ? text(doc.cancellationReason) : undefined;

  return compact({
    resourceType: "Appointment",
    id: doc.$id,
    meta: meta(doc.$updatedAt ?? doc.$createdAt),
    status,
    cancelationReason: cancelation ? { text: cancelation } : undefined,
    serviceType: visit
      ? [{ coding: [{ system: FHIR_SYSTEMS.visitType, ...visit }], text: visit.display }]
      : undefined,
    reasonCode: reason ? [{ text: reason }] : undefined,
    start: start?.toISOString(),
    end: end?.toISOString(),
    minutesDuration: start ? minutes : undefined,
    created: toInstant(doc.$createdAt),
    comment,
    participant,
  }) as FhirResource;
};

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

const CONSENT_SCOPE: Record<string, { code: string; display: string }> = {
  treatment: { code: "treatment", display: "Treatment" },
  privacy: { code: "patient-privacy", display: "Privacy" },
  disclosure: { code: "patient-privacy", display: "Privacy" },
};

export const consentResourceId = (patientId: string, purpose: string) =>
  toFhirId(`${patientId}-${purpose}`);

/**
 * One Consent per purpose, from the latest row (`deriveConsentState`). A
 * purpose that was never recorded is skipped by the caller.
 */
export const mapConsent = (
  patientId: string,
  state: Pick<ConsentState, "purpose" | "granted" | "policyVersion" | "updatedAt">,
): FhirResource => {
  const scope = CONSENT_SCOPE[state.purpose] ?? CONSENT_SCOPE.privacy;
  return compact({
    resourceType: "Consent",
    id: consentResourceId(patientId, state.purpose),
    meta: meta(state.updatedAt),
    status: state.granted ? "active" : "rejected",
    scope: {
      coding: [
        {
          system: "http://terminology.hl7.org/CodeSystem/consentscope",
          code: scope.code,
          display: scope.display,
        },
      ],
    },
    category: [
      {
        coding: [
          { system: "http://loinc.org", code: "59284-0", display: "Consent Document" },
        ],
      },
    ],
    patient: ref("Patient", patientId),
    dateTime: toInstant(state.updatedAt),
    policy: state.policyVersion
      ? [{ uri: `${FHIR_SYSTEMS.consentPolicy}:${state.policyVersion}` }]
      : undefined,
    provision: {
      type: state.granted ? "permit" : "deny",
      purpose: [{ system: FHIR_SYSTEMS.consentPurpose, code: state.purpose }],
    },
  }) as FhirResource;
};

/** Latest state per purpose, skipping purposes that were never recorded. */
export const mapConsents = (
  patientId: string,
  states: ConsentState[],
  history: Pick<ConsentRecord, "purpose">[],
): FhirResource[] => {
  const recorded = new Set(history.map((row) => row.purpose));
  return states
    .filter((state) => recorded.has(state.purpose))
    .map((state) => mapConsent(patientId, state));
};

// ---------------------------------------------------------------------------
// CapabilityStatement
// ---------------------------------------------------------------------------

type SearchParamDef = { name: string; type: string; documentation?: string };

const REST_RESOURCES: {
  type: string;
  searchParam: SearchParamDef[];
  /** false: search only (no read-by-id endpoint). */
  read?: boolean;
}[] = [
  {
    type: "Patient",
    searchParam: [
      { name: "identifier", type: "token", documentation: "user-id only" },
      { name: "email", type: "token", documentation: "exact match" },
    ],
  },
  { type: "Practitioner", searchParam: [] },
  {
    type: "PractitionerRole",
    searchParam: [{ name: "practitioner", type: "reference" }],
  },
  { type: "Schedule", searchParam: [{ name: "actor", type: "reference" }] },
  {
    type: "Slot",
    read: false,
    searchParam: [
      { name: "schedule", type: "reference" },
      { name: "start", type: "date", documentation: "range capped at 31 days" },
      { name: "status", type: "token" },
    ],
  },
  {
    type: "Appointment",
    searchParam: [
      { name: "patient", type: "reference" },
      { name: "practitioner", type: "reference" },
      { name: "date", type: "date" },
      { name: "status", type: "token" },
    ],
  },
  {
    type: "Consent",
    read: false,
    searchParam: [{ name: "patient", type: "reference" }],
  },
];

export const buildCapabilityStatement = (options: {
  baseUrl: string;
  now: Date;
}): FhirResource => ({
  resourceType: "CapabilityStatement",
  status: "active",
  date: options.now.toISOString(),
  publisher: "PKPCare",
  kind: "instance",
  software: { name: "PKPCare FHIR facade" },
  implementation: {
    description:
      "Read-only FHIR R4 facade over PKPCare. Not a certified or conformance-tested implementation.",
    url: options.baseUrl,
  },
  fhirVersion: "4.0.1",
  format: ["application/fhir+json", "json"],
  rest: [
    {
      mode: "server",
      documentation:
        "Read-only. Bearer token required. Sensitive fields need the read:sensitive scope and _include=sensitive.",
      security: {
        description: "Static bearer tokens with per-resource read scopes; every access is audited.",
      },
      resource: REST_RESOURCES.map((entry) => ({
        type: entry.type,
        profile: `http://hl7.org/fhir/StructureDefinition/${entry.type}`,
        interaction:
          entry.read === false
            ? [{ code: "search-type" }]
            : [{ code: "read" }, { code: "search-type" }],
        searchParam: entry.searchParam,
      })),
    },
  ],
});
