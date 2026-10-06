import { describe, expect, it } from "vitest";

import { PatientFormDefaultValues } from "@/constants";
import {
  applyIdPrefill,
  firstInvalidStepIndex,
  maskValue,
  validateStep,
  WIZARD_STEPS,
} from "@/components/portal/wizard";

const NOW = new Date("2026-10-06T12:00:00Z");

const valid = {
  ...PatientFormDefaultValues,
  name: "Jane Doe",
  email: "jane@example.com",
  phone: "+15551234567",
  birthDate: new Date("1990-05-20"),
  gender: "Female",
  address: "12 Main Street",
  occupation: "Engineer",
  emergencyContactName: "John Doe",
  emergencyContactNumber: "+15557654321",
  primaryPhysician: "John Green",
  insuranceProvider: "Acme Health",
  insurancePolicyNumber: "ABC123456",
  treatmentConsent: true,
  disclosureConsent: true,
  privacyConsent: true,
};

describe("validateStep", () => {
  it("has the four steps plus review in order", () => {
    expect(WIZARD_STEPS.map((s) => s.id)).toEqual([
      "personal",
      "medical",
      "insurance",
      "consent",
      "review",
    ]);
  });

  it("accepts a fully valid form at every step", () => {
    for (const step of WIZARD_STEPS) {
      expect(validateStep(step.id, valid, NOW)).toEqual({ ok: true, errors: {} });
    }
  });

  it("only reports errors for the fields of the requested step", () => {
    const broken = { ...valid, name: "J", insuranceProvider: "", privacyConsent: false };
    expect(Object.keys(validateStep("personal", broken, NOW).errors)).toEqual(["name"]);
    expect(validateStep("medical", broken, NOW).ok).toBe(true);
    expect(Object.keys(validateStep("insurance", broken, NOW).errors)).toEqual(["insuranceProvider"]);
    expect(Object.keys(validateStep("consent", broken, NOW).errors)).toEqual(["privacyConsent"]);
  });

  it("requires every consent to be ticked, with the server's message", () => {
    const result = validateStep("consent", { ...valid, treatmentConsent: false }, NOW);
    expect(result.ok).toBe(false);
    expect(result.errors.treatmentConsent).toMatch(/consent to treatment/i);
  });

  it("rejects today's date (the untouched default) and future dates as date of birth", () => {
    expect(validateStep("personal", { ...valid, birthDate: NOW }, NOW).errors.birthDate).toBeTruthy();
    expect(
      validateStep("personal", { ...valid, birthDate: new Date("2030-01-01") }, NOW).errors.birthDate
    ).toBeTruthy();
    expect(validateStep("personal", { ...valid, birthDate: "not a date" }, NOW).errors.birthDate).toBeTruthy();
  });

  it("validates phone numbers as E.164", () => {
    expect(validateStep("personal", { ...valid, phone: "555-1234" }, NOW).errors.phone).toBeTruthy();
  });

  it("review validates everything and finds the first bad step", () => {
    const broken = { ...valid, address: "x", privacyConsent: false };
    expect(Object.keys(validateStep("review", broken, NOW).errors).sort()).toEqual([
      "address",
      "privacyConsent",
    ]);
    expect(firstInvalidStepIndex(broken, NOW)).toBe(0);
    expect(firstInvalidStepIndex({ ...valid, privacyConsent: false }, NOW)).toBe(3);
    expect(firstInvalidStepIndex(valid, NOW)).toBe(-1);
  });
});

describe("maskValue", () => {
  it("hides all but the last 4 characters", () => {
    expect(maskValue("ABC123456789")).toBe("•••• 6789");
    expect(maskValue("1234")).toBe("••••");
    expect(maskValue("  ")).toBe("");
    expect(maskValue(undefined)).toBe("");
  });
});

describe("applyIdPrefill", () => {
  it("keeps valid suggestions and drops the rest", () => {
    const out = applyIdPrefill(
      {
        name: "  Jane Doe ",
        birthDate: "1990-05-20",
        identificationNumber: "X123",
        identificationType: "Passport",
      },
      NOW
    );
    expect(out.name).toBe("Jane Doe");
    expect(out.birthDate?.toISOString().slice(0, 10)).toBe("1990-05-20");
    expect(out.identificationNumber).toBe("X123");
    expect(out.identificationType).toBe("Passport");
  });

  it("ignores unknown ID types, future / garbled dates and over-long values", () => {
    const out = applyIdPrefill(
      {
        name: "J",
        birthDate: "2099-01-01",
        identificationNumber: "9".repeat(101),
        identificationType: "Library card",
      },
      NOW
    );
    expect(out).toEqual({});
    expect(applyIdPrefill({ birthDate: "garbage" }, NOW)).toEqual({});
  });
});
