// Loads what the visit page / link action need to know about an appointment
// and decides eligibility. Server only; no PHI leaves this module.
import { APPOINTMENT_SLOT_MINUTES, DEFAULT_TIMEZONE } from "@/constants";
import * as appointmentRepo from "@/lib/appwrite/appointment.repository";
import { isNotFound } from "@/lib/appwrite/client";
import * as doctorRepo from "@/lib/appwrite/doctor.repository";

export type VisitContext = {
  appointmentId: string;
  userId: string;
  doctorId: string | null;
  doctorName: string;
  timezone: string;
  status: string;
  visitType: string;
  start: Date;
  end: Date;
};

export type Eligibility =
  | { ok: true }
  | {
      ok: false;
      reason: "cancelled" | "not_scheduled" | "not_video" | "no_time";
      message: string;
    };

export const checkVisitEligibility = (
  ctx: Pick<VisitContext, "status" | "visitType"> & { start?: Date | null },
): Eligibility => {
  if (ctx.status === "cancelled") {
    return { ok: false, reason: "cancelled", message: "This appointment was cancelled." };
  }
  if (ctx.status !== "scheduled") {
    return {
      ok: false,
      reason: "not_scheduled",
      message: "This appointment is not confirmed yet.",
    };
  }
  if (ctx.visitType !== "video") {
    return {
      ok: false,
      reason: "not_video",
      message: "This appointment is not a video visit.",
    };
  }
  if (!ctx.start || Number.isNaN(ctx.start.getTime())) {
    return { ok: false, reason: "no_time", message: "This appointment has no valid time." };
  }
  return { ok: true };
};

/** Null when the appointment does not exist. Other errors propagate. */
export const loadVisitContext = async (
  appointmentId: string,
): Promise<VisitContext | null> => {
  let appt;
  try {
    appt = await appointmentRepo.getAppointmentDocument(appointmentId);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }

  let doctorName = appt.primaryPhysician;
  let slotMinutes = APPOINTMENT_SLOT_MINUTES;
  let timezone = DEFAULT_TIMEZONE;
  if (appt.doctorId) {
    try {
      const doctor = await doctorRepo.getDoctor(appt.doctorId);
      doctorName = doctor.name;
      if (Number.isInteger(doctor.slotMinutes) && doctor.slotMinutes > 0) {
        slotMinutes = doctor.slotMinutes;
      }
      if (doctor.timezone) timezone = doctor.timezone;
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }

  const start = new Date(appt.schedule);
  return {
    appointmentId: appt.$id,
    userId: appt.userId,
    doctorId: appt.doctorId ?? null,
    doctorName,
    timezone,
    status: appt.status,
    visitType: appt.visitType ?? "in_person",
    start,
    end: new Date(start.getTime() + slotMinutes * 60_000),
  };
};
