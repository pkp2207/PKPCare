// High-level entry point used by server actions, the reminders cron, the
// waitlist hook and the payment webhook. Resolves recipient / timezone / link,
// picks channels and sends. NEVER throws and is time-bounded, so wiring it into
// an action cannot fail or hang that action.
import * as patientRepo from "@/lib/appwrite/patient.repository";
import { safeLogLine } from "@/lib/compliance/redact";
import { resolveDoctorById } from "@/lib/scheduling/doctors";

import { notifyTimeoutMs, sendBookingReceived } from "./config";
import { createAppointmentLink } from "./links";
import { sendNotification } from "./notifier";
import type { NotifyResult, Recipient, TemplateId } from "./types";

export type AppointmentEvent = Extract<
  TemplateId,
  | "booking_received"
  | "confirmed"
  | "cancelled"
  | "rescheduled"
  | "reminder_24h"
  | "reminder_1h"
  | "deposit_received"
>;

export type AppointmentLike = {
  $id: string;
  userId: string;
  schedule: Date | string;
  primaryPhysician?: string | null;
  doctorId?: string | null;
  /** Expanded patient relationship, when the document was fetched with it. */
  patient?: unknown;
};

export type EventOptions = {
  /** Overrides appointment.schedule (e.g. the new time after a reschedule). */
  start?: Date | string;
  doctorName?: string | null;
  doctorId?: string | null;
  timezone?: string | null;
  patient?: unknown;
  idempotencyKey?: string;
  amountText?: string | null;
};

type PatientHint = {
  phone?: unknown;
  email?: unknown;
  notifyChannels?: unknown;
};

const asString = (value: unknown) =>
  typeof value === "string" && value.length > 0 ? value : null;

const isObject = (value: unknown): value is PatientHint =>
  Boolean(value) && typeof value === "object";

export const withTimeout = async <T>(
  promise: Promise<T>,
  ms: number,
  fallback: T
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const resolvePatient = async (
  userId: string,
  hint: unknown
): Promise<PatientHint | null> => {
  if (isObject(hint)) return hint;
  try {
    const doc = await patientRepo.getPatientByUserId(userId, { decrypt: false });
    return isObject(doc) ? (doc as PatientHint) : null;
  } catch {
    return null;
  }
};

const resolveTimezone = async (
  doctorId: string | null | undefined
): Promise<string | null> => {
  if (!doctorId) return null;
  try {
    const doctor = await resolveDoctorById(doctorId);
    return doctor?.schedule.timezone ?? null;
  } catch {
    return null;
  }
};

const run = async (
  event: AppointmentEvent,
  appointment: AppointmentLike,
  options: EventOptions
): Promise<NotifyResult | null> => {
  if (event === "booking_received" && !sendBookingReceived()) return null;

  const start = options.start ?? appointment.schedule;
  const patient = await resolvePatient(
    appointment.userId,
    options.patient ?? appointment.patient
  );
  const to: Recipient = {
    userId: appointment.userId,
    phone: asString(patient?.phone),
    email: asString(patient?.email),
  };
  const timezone =
    options.timezone !== undefined
      ? options.timezone
      : await resolveTimezone(options.doctorId ?? appointment.doctorId);

  const link =
    event === "cancelled"
      ? null
      : createAppointmentLink({
          appointmentId: appointment.$id,
          userId: appointment.userId,
          start,
        });

  return sendNotification({
    to,
    template: event,
    data: {
      doctorName: options.doctorName ?? appointment.primaryPhysician,
      start,
      timezone,
      link,
      amountText: options.amountText,
    },
    preferredChannels: patient?.notifyChannels,
    idempotencyKey: options.idempotencyKey,
  });
};

/**
 * Fire a notification for an appointment event. Resolves to null when nothing
 * was sent or anything failed; the failure is logged (redacted) and swallowed.
 */
export const notifyAppointment = async (
  event: AppointmentEvent,
  appointment: AppointmentLike,
  options: EventOptions = {}
): Promise<NotifyResult | null> => {
  try {
    return await withTimeout(
      run(event, appointment, options),
      notifyTimeoutMs(),
      null
    );
  } catch (error) {
    console.error(
      `[notify] ${event} failed: ${safeLogLine((error as Error)?.name ?? "error", 60)}`
    );
    return null;
  }
};
