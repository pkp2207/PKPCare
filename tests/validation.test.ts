import { describe, expect, it } from "vitest";

import {
  CancelAppointmentSchema,
  CreateAppointmentSchema,
  getAppointmentSchema,
  PatientFormValidation,
  ScheduleAppointmentSchema,
  UserFormValidation,
} from "@/lib/validation";

const validUser = {
  name: "Jane Doe",
  email: "jane@example.com",
  phone: "+15551234567",
};

const validPatient = {
  ...validUser,
  birthDate: "1990-05-20",
  gender: "Female",
  address: "12 Main Street",
  occupation: "Engineer",
  emergencyContactName: "John Doe",
  emergencyContactNumber: "+15557654321",
  primaryPhysician: "Dr. Smith",
  insuranceProvider: "Acme Health",
  insurancePolicyNumber: "ABC123456",
  treatmentConsent: true,
  disclosureConsent: true,
  privacyConsent: true,
};

const validAppointment = {
  primaryPhysician: "Dr. Smith",
  schedule: "2026-12-01T10:00:00.000Z",
  reason: "Annual checkup",
};

describe("UserFormValidation", () => {
  it("accepts valid input", () => {
    expect(UserFormValidation.safeParse(validUser).success).toBe(true);
  });

  it("rejects a bad email", () => {
    const result = UserFormValidation.safeParse({
      ...validUser,
      email: "not-an-email",
    });
    expect(result.success).toBe(false);
  });

  it.each(["5551234567", "+123", "+1234567890123456", "+1555abc4567", ""])(
    "rejects bad phone %j",
    (phone) => {
      expect(UserFormValidation.safeParse({ ...validUser, phone }).success).toBe(
        false
      );
    }
  );

  it("enforces name length 2..50", () => {
    expect(UserFormValidation.safeParse({ ...validUser, name: "A" }).success).toBe(
      false
    );
    expect(
      UserFormValidation.safeParse({ ...validUser, name: "A".repeat(51) }).success
    ).toBe(false);
    expect(
      UserFormValidation.safeParse({ ...validUser, name: "A".repeat(50) }).success
    ).toBe(true);
  });
});

describe("PatientFormValidation", () => {
  it("accepts a valid patient and coerces birthDate", () => {
    const result = PatientFormValidation.safeParse(validPatient);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.birthDate).toBeInstanceOf(Date);
    }
  });

  it.each(["treatmentConsent", "disclosureConsent", "privacyConsent"])(
    "rejects when %s is false",
    (field) => {
      const result = PatientFormValidation.safeParse({
        ...validPatient,
        [field]: false,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path[0] === field)).toBe(true);
      }
    }
  );

  it.each(["treatmentConsent", "disclosureConsent", "privacyConsent"])(
    "rejects when %s is omitted (defaults to false)",
    (field) => {
      const { [field]: _omitted, ...rest } = validPatient as Record<
        string,
        unknown
      >;
      expect(PatientFormValidation.safeParse(rest).success).toBe(false);
    }
  );

  it("rejects bad phone and emergency contact number", () => {
    expect(
      PatientFormValidation.safeParse({ ...validPatient, phone: "12345" }).success
    ).toBe(false);
    expect(
      PatientFormValidation.safeParse({
        ...validPatient,
        emergencyContactNumber: "12345",
      }).success
    ).toBe(false);
  });

  it("rejects an invalid gender", () => {
    expect(
      PatientFormValidation.safeParse({ ...validPatient, gender: "Robot" })
        .success
    ).toBe(false);
  });

  it("enforces min/max lengths", () => {
    const check = (field: string, value: string) =>
      PatientFormValidation.safeParse({ ...validPatient, [field]: value })
        .success;

    expect(check("address", "1234")).toBe(false);
    expect(check("address", "12345")).toBe(true);
    expect(check("address", "a".repeat(501))).toBe(false);
    expect(check("address", "a".repeat(500))).toBe(true);

    expect(check("occupation", "a")).toBe(false);
    expect(check("occupation", "a".repeat(501))).toBe(false);

    expect(check("emergencyContactName", "a")).toBe(false);
    expect(check("emergencyContactName", "a".repeat(51))).toBe(false);

    expect(check("insuranceProvider", "a")).toBe(false);
    expect(check("insuranceProvider", "a".repeat(51))).toBe(false);

    expect(check("insurancePolicyNumber", "a")).toBe(false);
    expect(check("insurancePolicyNumber", "a".repeat(51))).toBe(false);

    expect(check("primaryPhysician", "a")).toBe(false);
  });

  it("allows optional fields to be omitted", () => {
    const result = PatientFormValidation.safeParse({
      ...validPatient,
      allergies: undefined,
      currentMedication: undefined,
    });
    expect(result.success).toBe(true);
  });
});

describe("appointment schemas", () => {
  it("CreateAppointmentSchema accepts valid input and coerces schedule", () => {
    const result = CreateAppointmentSchema.safeParse(validAppointment);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.schedule).toBeInstanceOf(Date);
    }
  });

  it("CreateAppointmentSchema requires a reason of 2..500 chars", () => {
    const { reason: _reason, ...noReason } = validAppointment;
    expect(CreateAppointmentSchema.safeParse(noReason).success).toBe(false);
    expect(
      CreateAppointmentSchema.safeParse({ ...validAppointment, reason: "a" })
        .success
    ).toBe(false);
    expect(
      CreateAppointmentSchema.safeParse({
        ...validAppointment,
        reason: "a".repeat(501),
      }).success
    ).toBe(false);
  });

  it("CreateAppointmentSchema rejects an invalid schedule and short physician", () => {
    expect(
      CreateAppointmentSchema.safeParse({
        ...validAppointment,
        schedule: "not a date",
      }).success
    ).toBe(false);
    expect(
      CreateAppointmentSchema.safeParse({
        ...validAppointment,
        primaryPhysician: "D",
      }).success
    ).toBe(false);
  });

  it("ScheduleAppointmentSchema does not require reason", () => {
    const { reason: _reason, ...noReason } = validAppointment;
    expect(ScheduleAppointmentSchema.safeParse(noReason).success).toBe(true);
  });

  it("ScheduleAppointmentSchema requires physician and schedule", () => {
    expect(
      ScheduleAppointmentSchema.safeParse({ primaryPhysician: "Dr. Smith" })
        .success
    ).toBe(false);
    expect(
      ScheduleAppointmentSchema.safeParse({ schedule: validAppointment.schedule })
        .success
    ).toBe(false);
  });

  it("CancelAppointmentSchema requires cancellationReason (2..500 chars)", () => {
    expect(CancelAppointmentSchema.safeParse(validAppointment).success).toBe(
      false
    );
    expect(
      CancelAppointmentSchema.safeParse({
        ...validAppointment,
        cancellationReason: "x",
      }).success
    ).toBe(false);
    expect(
      CancelAppointmentSchema.safeParse({
        ...validAppointment,
        cancellationReason: "x".repeat(501),
      }).success
    ).toBe(false);
    expect(
      CancelAppointmentSchema.safeParse({
        ...validAppointment,
        cancellationReason: "Patient request",
      }).success
    ).toBe(true);
  });
});

describe("getAppointmentSchema", () => {
  it("dispatches by type", () => {
    expect(getAppointmentSchema("create")).toBe(CreateAppointmentSchema);
    expect(getAppointmentSchema("cancel")).toBe(CancelAppointmentSchema);
    expect(getAppointmentSchema("schedule")).toBe(ScheduleAppointmentSchema);
  });

  it("falls back to the schedule schema for unknown types", () => {
    expect(getAppointmentSchema("whatever")).toBe(ScheduleAppointmentSchema);
    expect(getAppointmentSchema("")).toBe(ScheduleAppointmentSchema);
  });

  it("cancel schema from dispatch requires cancellationReason", () => {
    const schema = getAppointmentSchema("cancel");
    expect(schema.safeParse(validAppointment).success).toBe(false);
    expect(
      schema.safeParse({ ...validAppointment, cancellationReason: "No show" })
        .success
    ).toBe(true);
  });
});
