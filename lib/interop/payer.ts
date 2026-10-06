// US payer connectivity adapter: INTERFACE ONLY.
//
// *** NOT IMPLEMENTED. No network calls, no fake responses. ***
//
// Plan (see docs/interop.md):
//  - Eligibility: X12 270 (request) / 271 (response), HIPAA 005010X279A1, or
//    the FHIR equivalent (CoverageEligibilityRequest / Response) where a payer
//    exposes it. Usually reached through a clearinghouse rather than per payer.
//  - Prior authorization: X12 278 (005010X217), or FHIR Da Vinci PAS / CRD /
//    DTR where the payer supports them (CMS interoperability rules are moving
//    payers toward FHIR APIs; check each payer's current status).
//  - Prerequisites: a HIPAA covered-entity / business-associate relationship
//    with the clearinghouse (BAA), NPI and tax id for the practice, payer ids,
//    clearinghouse credentials and per-payer enrolment, a sandbox/test
//    environment, and a security review. None of that exists in this repo.
//  - Data minimisation: send only the fields the transaction needs; keep the
//    raw 270/271 payloads out of logs (they are PHI).

import { InteropNotImplementedError } from "./errors";

export type PayerSubscriber = {
  memberId: string;
  firstName: string;
  lastName: string;
  /** ISO date (YYYY-MM-DD). */
  birthDate: string;
};

export type EligibilityRequest = {
  /** Payer id as defined by the clearinghouse / payer list. */
  payerId: string;
  /** Rendering provider NPI. */
  providerNpi: string;
  subscriber: PayerSubscriber;
  /** X12 service type codes, e.g. "30" (health benefit plan coverage). */
  serviceTypeCodes: string[];
  /** ISO date the coverage is checked for. */
  dateOfService: string;
};

export type EligibilityResult = {
  active: boolean;
  planName?: string;
  copayCents?: number;
  deductibleRemainingCents?: number;
  /** Payer-supplied AAA rejection codes, if the inquiry was rejected. */
  rejectionCodes?: string[];
  /** Transaction/control number to correlate with the clearinghouse. */
  traceId?: string;
};

export type PriorAuthRequest = {
  payerId: string;
  providerNpi: string;
  subscriber: PayerSubscriber;
  /** CPT / HCPCS codes being authorised. */
  procedureCodes: string[];
  /** ICD-10-CM diagnosis codes supporting the request. */
  diagnosisCodes: string[];
  dateOfService: string;
};

export type PriorAuthStatus = {
  authorizationId: string;
  status: "approved" | "denied" | "pended" | "more_information_needed";
  /** Payer reference number when approved. */
  referenceNumber?: string;
};

export interface PayerAdapter {
  checkEligibility(request: EligibilityRequest): Promise<EligibilityResult>;
  submitPriorAuth(request: PriorAuthRequest): Promise<PriorAuthStatus>;
  getPriorAuthStatus(authorizationId: string): Promise<PriorAuthStatus>;
}

const stub = (operation: string) => (): Promise<never> =>
  Promise.reject(new InteropNotImplementedError("payer", operation));

export const notImplementedPayerAdapter: PayerAdapter = {
  checkEligibility: stub("checkEligibility"),
  submitPriorAuth: stub("submitPriorAuth"),
  getPriorAuthStatus: stub("getPriorAuthStatus"),
};
