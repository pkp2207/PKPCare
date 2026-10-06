// Minimal FHIR R4 (4.0.1) shapes. Deliberately loose: this is a read-only
// facade, not a FHIR library.

export type FhirCoding = { system?: string; code?: string; display?: string };

export type FhirCodeableConcept = { coding?: FhirCoding[]; text?: string };

export type FhirReference = { reference?: string; display?: string };

export type FhirMeta = { lastUpdated?: string };

export type FhirResource = {
  resourceType: string;
  id?: string;
  meta?: FhirMeta;
  [key: string]: unknown;
};

export type FhirBundleLink = { relation: string; url: string };

export type FhirBundleEntry = {
  fullUrl: string;
  resource: FhirResource;
  search: { mode: "match" };
};

export type FhirBundle = {
  resourceType: "Bundle";
  type: "searchset";
  total: number;
  link: FhirBundleLink[];
  entry: FhirBundleEntry[];
};

export type FhirIssueCode =
  | "invalid"
  | "structure"
  | "required"
  | "forbidden"
  | "login"
  | "not-found"
  | "not-supported"
  | "too-costly"
  | "throttled"
  | "exception";

export type OperationOutcome = {
  resourceType: "OperationOutcome";
  issue: {
    severity: "fatal" | "error" | "warning" | "information";
    code: FhirIssueCode;
    details: { text: string };
  }[];
};

export const FHIR_CONTENT_TYPE = "application/fhir+json; charset=utf-8";

export const FHIR_RESOURCE_TYPES = [
  "Patient",
  "Practitioner",
  "PractitionerRole",
  "Schedule",
  "Slot",
  "Appointment",
  "Consent",
] as const;

export type FhirResourceType = (typeof FHIR_RESOURCE_TYPES)[number];

/** Namespaces we mint; nothing here is an official or registered system. */
export const FHIR_SYSTEMS = {
  userId: "urn:pkpcare:user-id",
  visitType: "urn:pkpcare:visit-type",
  consentPurpose: "urn:pkpcare:consent-purpose",
  consentPolicy: "urn:pkpcare:policy",
  identification: "urn:pkpcare:identification",
  extension: "urn:pkpcare:fhir/StructureDefinition",
} as const;
