import { describe, expect, it } from "vitest";

import {
  appointmentStatusFromFhir,
  buildCapabilityStatement,
  mapAppointment,
  mapAppointmentStatus,
  mapConsent,
  mapConsents,
} from "@/lib/fhir/mappers";

const CIPHER = "enc:v1:abc123:iv:tag:ct";

const appt = {
  $id: "a1",
  $createdAt: "2026-09-30T08:00:00.000+00:00",
  $updatedAt: "2026-10-01T09:00:00.000+00:00",
  schedule: "2026-10-08T10:00:00.000+00:00",
  status: "scheduled",
  primaryPhysician: "Dr. John Green",
  doctorId: "john-green",
  visitType: "video",
  reason: "chest pain",
  note: "bring reports",
  cancellationReason: null,
  patient: { $id: "p1", name: "Asha Rao", allergies: CIPHER },
};

describe("mapAppointment", () => {
  it("golden minimal output: no reason, note or embedded patient data", () => {
    const out = mapAppointment(appt, { durationMinutes: 20 });
    expect(out).toEqual({
      resourceType: "Appointment",
      id: "a1",
      meta: { lastUpdated: "2026-10-01T09:00:00.000Z" },
      status: "booked",
      serviceType: [
        {
          coding: [
            { system: "urn:pkpcare:visit-type", code: "video", display: "Video visit" },
          ],
          text: "Video visit",
        },
      ],
      start: "2026-10-08T10:00:00.000Z",
      end: "2026-10-08T10:20:00.000Z",
      minutesDuration: 20,
      created: "2026-09-30T08:00:00.000Z",
      participant: [
        { actor: { reference: "Patient/p1" }, status: "accepted" },
        {
          actor: { reference: "Practitioner/john-green", display: "Dr. John Green" },
          status: "accepted",
        },
      ],
    });
    const json = JSON.stringify(out);
    for (const leaked of ["chest pain", "bring reports", "Asha", "enc:"]) {
      expect(json).not.toContain(leaked);
    }
  });

  it("adds reason and comment only in sensitive mode", () => {
    const out = mapAppointment(appt, { sensitive: true });
    expect(out.reasonCode).toEqual([{ text: "chest pain" }]);
    expect(out.comment).toBe("bring reports");
  });

  it("cancellation reason is sensitive-only and only when cancelled", () => {
    const cancelled = { ...appt, status: "cancelled", cancellationReason: "too ill" };
    expect(mapAppointment(cancelled).cancelationReason).toBeUndefined();
    expect(mapAppointment(cancelled, { sensitive: true }).cancelationReason).toEqual({
      text: "too ill",
    });
    expect(
      mapAppointment({ ...appt, cancellationReason: "stale" }, { sensitive: true })
        .cancelationReason,
    ).toBeUndefined();
  });

  it("maps statuses both ways", () => {
    expect(mapAppointmentStatus("pending")).toBe("proposed");
    expect(mapAppointmentStatus("scheduled")).toBe("booked");
    expect(mapAppointmentStatus("cancelled")).toBe("cancelled");
    expect(appointmentStatusFromFhir("proposed")).toBe("pending");
    expect(appointmentStatusFromFhir("booked")).toBe("scheduled");
    expect(appointmentStatusFromFhir("cancelled")).toBe("cancelled");
    expect(appointmentStatusFromFhir("fulfilled")).toBeNull();
  });

  it("pending: practitioner needs action; patient relation may be a bare id", () => {
    const out = mapAppointment({ ...appt, status: "pending", patient: "p9" });
    expect(out.status).toBe("proposed");
    expect(out.participant).toEqual([
      { actor: { reference: "Patient/p9" }, status: "accepted" },
      {
        actor: { reference: "Practitioner/john-green", display: "Dr. John Green" },
        status: "needs-action",
      },
    ]);
  });

  it("legacy appointment without doctorId: display-only participant, 30 minutes", () => {
    const out = mapAppointment({ ...appt, doctorId: null, visitType: null, patient: null });
    expect(out.participant).toEqual([
      { actor: { display: "Dr. John Green" }, status: "accepted" },
    ]);
    expect(out.end).toBe("2026-10-08T10:30:00.000Z");
    expect(out.serviceType).toBeUndefined();
  });
});

describe("Consent", () => {
  it("granted purpose is active / permit", () => {
    const out = mapConsent("p1", {
      purpose: "treatment",
      granted: true,
      policyVersion: "2026-10-01",
      updatedAt: "2026-10-01T10:00:00.000Z",
    });
    expect(out).toMatchObject({
      resourceType: "Consent",
      id: "p1-treatment",
      meta: { lastUpdated: "2026-10-01T10:00:00.000Z" },
      status: "active",
      patient: { reference: "Patient/p1" },
      dateTime: "2026-10-01T10:00:00.000Z",
      policy: [{ uri: "urn:pkpcare:policy:2026-10-01" }],
      provision: {
        type: "permit",
        purpose: [{ system: "urn:pkpcare:consent-purpose", code: "treatment" }],
      },
    });
    expect(out.scope).toEqual({
      coding: [
        {
          system: "http://terminology.hl7.org/CodeSystem/consentscope",
          code: "treatment",
          display: "Treatment",
        },
      ],
    });
  });

  it("withdrawn purpose is rejected / deny", () => {
    const out = mapConsent("p1", {
      purpose: "disclosure",
      granted: false,
      policyVersion: "v1",
      updatedAt: "2026-10-02T00:00:00.000Z",
    });
    expect(out.status).toBe("rejected");
    expect((out.provision as { type: string }).type).toBe("deny");
  });

  it("skips purposes that were never recorded", () => {
    const at = "2026-10-01T00:00:00.000Z";
    const states = [
      { purpose: "treatment" as const, granted: true, policyVersion: "v1", updatedAt: at },
      { purpose: "disclosure" as const, granted: false, policyVersion: null, updatedAt: null },
      { purpose: "privacy" as const, granted: true, policyVersion: "v1", updatedAt: at },
    ];
    const out = mapConsents("p1", states, [{ purpose: "treatment" }, { purpose: "privacy" }]);
    expect(out.map((r) => r.id)).toEqual(["p1-treatment", "p1-privacy"]);
  });
});

describe("CapabilityStatement", () => {
  const cs = buildCapabilityStatement({
    baseUrl: "https://x.test/api/fhir",
    now: new Date("2026-10-06T00:00:00.000Z"),
  });

  it("declares a read-only R4 server", () => {
    expect(cs.resourceType).toBe("CapabilityStatement");
    expect(cs.fhirVersion).toBe("4.0.1");
    expect(cs.kind).toBe("instance");
    const rest = cs.rest as { resource: { type: string; interaction: { code: string }[] }[] }[];
    const resources = rest[0].resource;
    expect(resources.map((r) => r.type)).toEqual([
      "Patient",
      "Practitioner",
      "PractitionerRole",
      "Schedule",
      "Slot",
      "Appointment",
      "Consent",
    ]);
    const codes = Object.fromEntries(
      resources.map((r) => [r.type, r.interaction.map((i) => i.code)]),
    );
    expect(codes.Patient).toEqual(["read", "search-type"]);
    expect(codes.Slot).toEqual(["search-type"]);
    expect(codes.Consent).toEqual(["search-type"]);
    expect(JSON.stringify(cs)).not.toMatch(/"(create|update|delete)"/);
  });
});
