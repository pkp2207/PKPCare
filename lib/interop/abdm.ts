// ABDM (Ayushman Bharat Digital Mission, India) adapter: INTERFACE ONLY.
//
// *** NOT IMPLEMENTED. No network calls, no fake responses. ***
//
// Every method of `notImplementedAbdmAdapter` rejects with
// InteropNotImplementedError. The types below describe the shape a real
// adapter should expose so the rest of the app can be written against it.
//
// Integration plan (see docs/interop.md for the long form):
//  1. Register as a Health Information Provider (HIP) and/or Health
//     Information User (HIU) in the ABDM sandbox; obtain client id/secret.
//     Sandbox + production are separate onboardings with a facility registry
//     (HFR) id and, for production, an ABDM compliance review.
//  2. Session: POST client credentials to the ABDM gateway session endpoint,
//     cache the short-lived access token, never log it.
//  3. ABHA (Ayushman Bharat Health Account) create / verify / link via the
//     ABHA enrolment and login APIs (Aadhaar or mobile OTP). Store only the
//     ABHA number / address a patient consents to link, encrypted.
//  4. Consent artefacts: as HIU, raise a consent request; the patient approves
//     in their PHR app; ABDM calls back with a consent artefact. As HIP,
//     respond to data requests for granted artefacts and push FHIR bundles,
//     encrypted with the requester's key material (ECDH + AES-GCM as per the
//     ABDM health information exchange spec).
//  5. Public HTTPS callback endpoints (not in this repo yet) for gateway
//     notifications, authenticated per ABDM rules.
// Confirm every API path, payload and legal requirement against the current
// ABDM documentation before building; this file deliberately contains none.

import { InteropNotImplementedError } from "./errors";

export type AbhaIdentifier = {
  /** 14-digit ABHA number, e.g. "12-3456-7890-1234" (formatting varies). */
  abhaNumber?: string;
  /** ABHA address (PHR address), e.g. "name@abdm". */
  abhaAddress?: string;
};

export type AbhaLinkRequest = AbhaIdentifier & {
  /** PKPCare user id of the patient linking the account. */
  userId: string;
  /** How ownership is proven; the OTP itself is never stored. */
  method: "aadhaar_otp" | "mobile_otp";
};

export type AbhaLinkResult = {
  linked: boolean;
  abhaAddress?: string;
  /** Opaque transaction id returned by the gateway for the OTP step. */
  transactionId?: string;
};

export type AbdmConsentPurpose =
  | "CAREMGT"
  | "BTG"
  | "PUBHLTH"
  | "HPAYMT"
  | "DSRCH"
  | "PATRQT";

export type AbdmHiType =
  | "Prescription"
  | "DiagnosticReport"
  | "OPConsultation"
  | "DischargeSummary"
  | "ImmunizationRecord"
  | "HealthDocumentRecord"
  | "WellnessRecord";

export type AbdmConsentRequest = {
  abhaAddress: string;
  purpose: AbdmConsentPurpose;
  hiTypes: AbdmHiType[];
  /** Period the requested records cover. */
  dateRange: { from: string; to: string };
  /** When the consent artefact should stop being valid. */
  expiresAt: string;
};

export type AbdmConsentArtefact = {
  artefactId: string;
  status: "GRANTED" | "DENIED" | "EXPIRED" | "REVOKED";
  hiTypes: AbdmHiType[];
  dateRange: { from: string; to: string };
  expiresAt: string;
  /** Signed artefact as delivered by the gateway, kept verbatim for audit. */
  raw: string;
};

export interface AbdmAdapter {
  /** Start or complete an ABHA link (OTP based). */
  linkAbha(request: AbhaLinkRequest): Promise<AbhaLinkResult>;
  /** HIU: ask a patient for access to their records. Returns the request id. */
  requestConsent(request: AbdmConsentRequest): Promise<{ consentRequestId: string }>;
  /** Fetch the artefact(s) created for a consent request once approved. */
  getConsentArtefacts(consentRequestId: string): Promise<AbdmConsentArtefact[]>;
  /** HIU: fetch health information for a granted artefact (FHIR bundles). */
  fetchHealthInformation(artefactId: string): Promise<{ bundles: unknown[] }>;
  /** Patient revoked consent in the PHR app: stop and purge per policy. */
  handleConsentRevoked(artefactId: string): Promise<void>;
}

const stub = (operation: string) => (): Promise<never> =>
  Promise.reject(new InteropNotImplementedError("abdm", operation));

export const notImplementedAbdmAdapter: AbdmAdapter = {
  linkAbha: stub("linkAbha"),
  requestConsent: stub("requestConsent"),
  getConsentArtefacts: stub("getConsentArtefacts"),
  fetchHealthInformation: stub("fetchHealthInformation"),
  handleConsentRevoked: stub("handleConsentRevoked"),
};
