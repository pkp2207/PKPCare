// Client-bound view model of an appointment. Only what the admin UI needs, so
// no medical or ID fields are serialised to the browser.
import type { Appointment, CancelledBy } from "@/types/appwrite.types";

export type AppointmentRow = {
  id: string;
  userId: string;
  patientId: string | null;
  patientName: string;
  patientEmail: string;
  patientPhone: string;
  physician: string;
  doctorId: string | null;
  schedule: string;
  status: Status;
  reason: string;
  note: string;
  visitType: VisitType;
  cancellationReason: string | null;
  cancelledBy: CancelledBy | null;
  createdAt: string;
  updatedAt: string;
  reminderSentAt: string | null;
};

const iso = (value: unknown): string => {
  const t = Date.parse(String(value ?? ""));
  return Number.isNaN(t) ? "" : new Date(t).toISOString();
};

export const toAppointmentRow = (doc: Appointment): AppointmentRow => {
  const patient = (doc.patient ?? null) as {
    $id?: string;
    name?: string;
    email?: string;
    phone?: string;
  } | null;
  return {
    id: doc.$id,
    userId: doc.userId,
    patientId: patient?.$id || null,
    patientName: patient?.name || "Unknown patient",
    patientEmail: patient?.email ?? "",
    patientPhone: patient?.phone ?? "",
    physician: doc.primaryPhysician,
    doctorId: doc.doctorId ?? null,
    schedule: iso(doc.schedule),
    status: doc.status,
    reason: doc.reason ?? "",
    note: doc.note ?? "",
    visitType: doc.visitType ?? "in_person",
    cancellationReason: doc.cancellationReason ?? null,
    cancelledBy: doc.cancelledBy ?? null,
    createdAt: iso(doc.$createdAt),
    updatedAt: iso(doc.$updatedAt),
    reminderSentAt: doc.reminderSentAt ? iso(doc.reminderSentAt) : null,
  };
};

/**
 * The subset of an Appointment that AppointmentForm reads
 * ($id, primaryPhysician, schedule, reason, note, cancellationReason),
 * typed as Appointment for its props.
 */
export const rowToFormAppointment = (row: AppointmentRow): Appointment =>
  ({
    $id: row.id,
    userId: row.userId,
    primaryPhysician: row.physician,
    schedule: new Date(row.schedule),
    status: row.status,
    reason: row.reason,
    note: row.note,
    cancellationReason: row.cancellationReason,
  }) as unknown as Appointment;
