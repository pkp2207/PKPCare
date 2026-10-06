import { describe, expect, it } from "vitest";

import {
  fhirSlotId,
  mapGender,
  mapPatient,
  mapPractitioner,
  mapPractitionerRole,
  mapSchedule,
  mapSlot,
  toFhirId,
} from "@/lib/fhir/mappers";

const CIPHER = "enc:v1:abc123:iv:tag:ct";

const patientDoc = {
  $id: "p1",
  $updatedAt: "2026-10-01T10:00:00.000+00:00",
  userId: "u1",
  name: "Asha Rao",
  email: "asha@example.com",
  phone: "+911234567890",
  birthDate: "1990-05-17T00:00:00.000Z",
  gender: "Female",
  address: "12 MG Road, Pune",
  occupation: "Engineer",
  emergencyContactName: "Ravi Rao",
  emergencyContactNumber: "+919999999999",
  insuranceProvider: "Acme Health",
  insurancePolicyNumber: "POL-123",
  allergies: "penicillin",
  currentMedication: "metformin",
  familyMedicalHistory: "diabetes",
  pastMedicalHistory: "appendectomy",
  identificationType: "Passport",
  identificationNumber: "X1234567",
};

describe("mapPatient", () => {
  it("golden minimal output", () => {
    expect(mapPatient(patientDoc)).toEqual({
      resourceType: "Patient",
      id: "p1",
      meta: { lastUpdated: "2026-10-01T10:00:00.000Z" },
      identifier: [{ system: "urn:pkpcare:user-id", value: "u1" }],
      active: true,
      name: [{ use: "official", text: "Asha Rao", family: "Rao", given: ["Asha"] }],
      telecom: [
        { system: "email", value: "asha@example.com" },
        { system: "phone", value: "+911234567890" },
      ],
      gender: "female",
      birthDate: "1990-05-17",
      address: [{ text: "12 MG Road, Pune" }],
    });
  });

  it("never emits sensitive values by default", () => {
    const json = JSON.stringify(mapPatient(patientDoc));
    for (const secret of [
      "POL-123",
      "Acme Health",
      "penicillin",
      "metformin",
      "diabetes",
      "appendectomy",
      "X1234567",
      "Ravi",
      "Engineer",
    ]) {
      expect(json).not.toContain(secret);
    }
  });

  it("emits sensitive fields only when sensitive is true", () => {
    const out = mapPatient(patientDoc, { sensitive: true });
    expect(out.identifier).toEqual([
      { system: "urn:pkpcare:user-id", value: "u1" },
      {
        system: "urn:pkpcare:identification:passport",
        type: { text: "Passport" },
        value: "X1234567",
      },
    ]);
    expect(out.contact).toEqual([
      {
        relationship: [{ text: "Emergency contact" }],
        name: { text: "Ravi Rao" },
        telecom: [{ system: "phone", value: "+919999999999" }],
      },
    ]);
    const pairs = (out.extension as { url: string; valueString: string }[]).map(
      (e) => [e.url.split("/").pop(), e.valueString],
    );
    expect(pairs).toEqual([
      ["insurance-provider", "Acme Health"],
      ["insurance-policy-number", "POL-123"],
      ["occupation", "Engineer"],
      ["allergies", "penicillin"],
      ["current-medication", "metformin"],
      ["family-medical-history", "diabetes"],
      ["past-medical-history", "appendectomy"],
    ]);
  });

  it("never emits ciphertext, even in sensitive mode", () => {
    const out = mapPatient(
      {
        ...patientDoc,
        insurancePolicyNumber: CIPHER,
        allergies: CIPHER,
        identificationNumber: CIPHER,
      },
      { sensitive: true },
    );
    expect(JSON.stringify(out)).not.toContain("enc:");
  });

  it("tolerates missing optional fields and odd gender", () => {
    expect(mapPatient({ $id: "p2", gender: "Non binary" })).toEqual({
      resourceType: "Patient",
      id: "p2",
      active: true,
      gender: "unknown",
    });
    expect(mapGender("Male")).toBe("male");
    expect(mapGender(undefined)).toBe("unknown");
  });
});

describe("Practitioner / PractitionerRole / Schedule", () => {
  const doctor = {
    $id: "john-green",
    $updatedAt: "2026-09-01T00:00:00.000+00:00",
    name: "Dr. John Green",
    specialty: "Cardiology",
    active: true,
    timezone: "Asia/Kolkata",
    slotMinutes: 30,
    email: "secret@clinic.test",
    staffUserId: "staff-1",
  };

  it("golden Practitioner, without email or staff id", () => {
    const out = mapPractitioner(doctor);
    expect(out).toEqual({
      resourceType: "Practitioner",
      id: "john-green",
      meta: { lastUpdated: "2026-09-01T00:00:00.000Z" },
      active: true,
      name: [
        {
          use: "official",
          text: "Dr. John Green",
          family: "Green",
          given: ["John"],
          prefix: ["Dr."],
        },
      ],
    });
    expect(JSON.stringify(out)).not.toContain("secret@clinic.test");
    expect(JSON.stringify(out)).not.toContain("staff-1");
  });

  it("marks inactive doctors", () => {
    expect(mapPractitioner({ ...doctor, active: false }).active).toBe(false);
  });

  it("PractitionerRole carries the specialty", () => {
    expect(mapPractitionerRole(doctor)).toEqual({
      resourceType: "PractitionerRole",
      id: "john-green",
      meta: { lastUpdated: "2026-09-01T00:00:00.000Z" },
      active: true,
      practitioner: { reference: "Practitioner/john-green", display: "Dr. John Green" },
      specialty: [{ text: "Cardiology" }],
    });
  });

  it("Schedule references the practitioner with a planning horizon", () => {
    expect(
      mapSchedule(doctor, { now: new Date("2026-10-06T00:00:00.000Z"), horizonDays: 90 }),
    ).toEqual({
      resourceType: "Schedule",
      id: "john-green",
      meta: { lastUpdated: "2026-09-01T00:00:00.000Z" },
      active: true,
      actor: [{ reference: "Practitioner/john-green", display: "Dr. John Green" }],
      planningHorizon: {
        start: "2026-10-06T00:00:00.000Z",
        end: "2027-01-04T00:00:00.000Z",
      },
      comment: "Working hours are in Asia/Kolkata.",
    });
  });
});

describe("mapSlot", () => {
  it("golden free slot", () => {
    const start = new Date("2026-10-08T10:00:00.000Z");
    expect(
      mapSlot({
        doctorId: "john-green",
        start,
        end: new Date("2026-10-08T10:30:00.000Z"),
        status: "free",
      }),
    ).toEqual({
      resourceType: "Slot",
      id: `john-green-${start.getTime()}`,
      schedule: { reference: "Schedule/john-green" },
      status: "free",
      start: "2026-10-08T10:00:00.000Z",
      end: "2026-10-08T10:30:00.000Z",
    });
  });

  it("ids only use FHIR-legal characters", () => {
    expect(toFhirId("a_b c")).toBe("a-b-c");
    expect(fhirSlotId("doc_1", 5)).toBe("doc-1-5");
  });
});
