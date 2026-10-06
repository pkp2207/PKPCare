import { describe, expect, it } from "vitest";

import {
  AvailabilitySchema,
  CancelAppointmentSchema,
  CancelMyAppointmentSchema,
  CreateAppointmentSchema,
  CreateAppointmentServerSchema,
  getAppointmentSchema,
  JoinWaitlistSchema,
  PatientFormValidation,
  PhysicianSchema,
  RescheduleAppointmentSchema,
  ScheduleAppointmentSchema,
  UpsertDoctorSchema,
  UserFormValidation,
  WeeklyHoursSchema,
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

describe("CreateAppointmentServerSchema", () => {
  const common = { userId: "u1", patient: "p1", reason: "Checkup" };

  it("accepts the legacy shape (name + schedule) and coerces dates", () => {
    const r = CreateAppointmentServerSchema.safeParse({
      ...common,
      primaryPhysician: "John Green",
      schedule: "2026-12-01T10:00:00.000Z",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.schedule).toBeInstanceOf(Date);
      expect(r.data.visitType).toBe("in_person");
    }
  });

  it("accepts the new shape (doctorId + slotStart) and visit type", () => {
    const r = CreateAppointmentServerSchema.safeParse({
      ...common,
      doctorId: "doc1",
      slotStart: "2026-12-01T10:00:00.000Z",
      visitType: "video",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.visitType).toBe("video");
  });

  it("requires one complete pair", () => {
    expect(CreateAppointmentServerSchema.safeParse(common).success).toBe(false);
    expect(CreateAppointmentServerSchema.safeParse({ ...common, doctorId: "doc1" }).success).toBe(false);
    expect(CreateAppointmentServerSchema.safeParse({ ...common, schedule: "2026-12-01T10:00:00Z" }).success).toBe(false);
  });

  it("rejects bad ids, visit types, dates and reasons", () => {
    const ok = { ...common, doctorId: "doc1", slotStart: "2026-12-01T10:00:00Z" };
    expect(CreateAppointmentServerSchema.safeParse({ ...ok, doctorId: "../etc" }).success).toBe(false);
    expect(CreateAppointmentServerSchema.safeParse({ ...ok, visitType: "teleport" }).success).toBe(false);
    expect(CreateAppointmentServerSchema.safeParse({ ...ok, slotStart: "soon" }).success).toBe(false);
    expect(CreateAppointmentServerSchema.safeParse({ ...ok, reason: "x" }).success).toBe(false);
  });
});

describe("PhysicianSchema", () => {
  it("checks format only (existence is resolved against the doctors collection)", () => {
    expect(PhysicianSchema.safeParse("Some New Doctor").success).toBe(true);
    expect(PhysicianSchema.safeParse("D").success).toBe(false);
    expect(PhysicianSchema.safeParse("x".repeat(101)).success).toBe(false);
  });
});

describe("scheduling schemas", () => {
  it("AvailabilitySchema caps the window at 14 days and requires from < to", () => {
    const base = { doctorId: "doc1", from: "2026-10-08T00:00:00Z" };
    expect(AvailabilitySchema.safeParse({ ...base, to: "2026-10-22T00:00:00Z" }).success).toBe(true);
    expect(AvailabilitySchema.safeParse({ ...base, to: "2026-10-22T00:00:01Z" }).success).toBe(false);
    expect(AvailabilitySchema.safeParse({ ...base, to: "2026-10-08T00:00:00Z" }).success).toBe(false);
    expect(AvailabilitySchema.safeParse({ ...base, to: "nope" }).success).toBe(false);
  });

  it("WeeklyHoursSchema validates HH:MM, order and overlap", () => {
    expect(WeeklyHoursSchema.safeParse({ mon: [["09:00", "13:00"], ["14:00", "17:00"]], sun: [] }).success).toBe(true);
    expect(WeeklyHoursSchema.safeParse({ mon: [["09:00", "24:00"]] }).success).toBe(true);
    expect(WeeklyHoursSchema.safeParse({ mon: [["17:00", "09:00"]] }).success).toBe(false);
    expect(WeeklyHoursSchema.safeParse({ mon: [["09:00", "13:00"], ["12:00", "14:00"]] }).success).toBe(false);
    expect(WeeklyHoursSchema.safeParse({ mon: [["9:00", "13:00"]] }).success).toBe(false);
    expect(WeeklyHoursSchema.safeParse({ someday: [["09:00", "10:00"]] }).success).toBe(false);
  });

  it("UpsertDoctorSchema validates timezone and slot length", () => {
    const base = { name: "Dr Who", specialty: "GP", image: "/a.png" };
    expect(UpsertDoctorSchema.safeParse({ ...base, timezone: "Europe/London", slotMinutes: 15 }).success).toBe(true);
    expect(UpsertDoctorSchema.safeParse({ ...base, timezone: "Gallifrey/Citadel" }).success).toBe(false);
    expect(UpsertDoctorSchema.safeParse({ ...base, slotMinutes: 3 }).success).toBe(false);
    expect(UpsertDoctorSchema.safeParse({ ...base, slotMinutes: 12.5 }).success).toBe(false);
  });

  it("cancel/reschedule schemas", () => {
    expect(CancelMyAppointmentSchema.safeParse({ appointmentId: "a1", userId: "u1", reason: "no" }).success).toBe(true);
    expect(CancelMyAppointmentSchema.safeParse({ appointmentId: "a1", userId: "u1", reason: "n" }).success).toBe(false);
    expect(RescheduleAppointmentSchema.safeParse({ appointmentId: "a1", userId: "u1", newStart: "2026-12-01T10:00:00Z" }).success).toBe(true);
    expect(RescheduleAppointmentSchema.safeParse({ appointmentId: "a1", userId: "u1", newStart: "whenever" }).success).toBe(false);
  });

  it("JoinWaitlistSchema needs earliest < latest within the horizon", () => {
    const soon = Date.now() + 86_400_000;
    const base = { userId: "u1", patientId: "p1", doctorId: "d1" };
    expect(JoinWaitlistSchema.safeParse({ ...base, earliest: new Date(soon), latest: new Date(soon + 86_400_000) }).success).toBe(true);
    expect(JoinWaitlistSchema.safeParse({ ...base, earliest: new Date(soon + 86_400_000), latest: new Date(soon) }).success).toBe(false);
    expect(JoinWaitlistSchema.safeParse({ ...base, earliest: new Date(soon), latest: new Date(soon + 200 * 86_400_000) }).success).toBe(false);
  });
});
