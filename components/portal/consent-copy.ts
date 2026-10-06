// Plain-language consent and privacy wording shown in the portal.
//
// DRAFT TEXT - NOT LEGAL ADVICE. Every string here (and the policy summary in
// app/privacy/page.tsx) must be reviewed by counsel before real patients see
// it. When the wording changes materially, bump CURRENT_POLICY_VERSION in
// lib/compliance/consent.ts so new consent rows record the new version.

export type ConsentPurposeKey = "treatment" | "disclosure" | "privacy";

export type ConsentCopy = {
  purpose: ConsentPurposeKey;
  /** Form field holding the tick. */
  field: "treatmentConsent" | "disclosureConsent" | "privacyConsent";
  title: string;
  /** What the patient agrees to, in plain words (registration step). */
  statement: string;
  /** What happens if it is withdrawn later (privacy page). */
  withdrawalEffect: string;
};

export const CONSENT_COPY: readonly ConsentCopy[] = [
  {
    purpose: "treatment",
    field: "treatmentConsent",
    title: "Consent to treatment",
    statement:
      "I agree that PKPCare clinicians may assess my health, give advice and treat me. I understand I can ask questions and refuse any treatment.",
    withdrawalEffect:
      "If you withdraw this, we will not be able to book new appointments for you or treat you until you agree again. Please contact the clinic if you want to do that.",
  },
  {
    purpose: "disclosure",
    field: "disclosureConsent",
    title: "Sharing my health information for my care",
    statement:
      "I agree that my health information may be shared with the clinicians, staff and service providers (for example laboratories, or an insurer I have named) who need it to care for me and to bill for that care. It will not be shared for other reasons without asking me.",
    withdrawalEffect:
      "If you withdraw this, we will stop sharing your information with others except where the law requires it. Some services, such as insurance billing or lab referrals, may not be possible.",
  },
  {
    purpose: "privacy",
    field: "privacyConsent",
    title: "Privacy notice",
    statement:
      "I have read the privacy notice and understand what information PKPCare collects, why, how long it is kept, and how I can see, correct, download or ask to delete it.",
    withdrawalEffect:
      "If you withdraw this, we will no longer be able to keep using your account for new activity. You can still download your data or ask us to delete your account.",
  },
];

export const consentCopyFor = (purpose: string): ConsentCopy | undefined =>
  CONSENT_COPY.find((c) => c.purpose === purpose);

export const PRIVACY_PAGE_PATH = "/privacy";
