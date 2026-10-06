// Cancellation where the authority is a verified signed link token rather than a
// session (patients tapping a link in an SMS/email are often not logged in).
// Mirrors `cancelMyAppointment` in lib/actions/appointment.actions.ts (same
// checks, same slot release + waitlist offer) minus the session check. Callers
// MUST have verified the token and pass the user id from its claims.
// Deliberately NOT in a "use server" file: it must not be callable from the browser.
import * as appointmentRepo from "@/lib/appwrite/appointment.repository";
import { isNotFound } from "@/lib/appwrite/client";
import type { Appointment } from "@/types/appwrite.types";

import { releaseSlotAndOffer } from "./booking";

export type CancelByAuthorityResult =
  | { ok: true; existing: Appointment; updated: Appointment }
  | { ok: false; error: string };

export const cancelAppointmentByAuthority = async (input: {
  appointmentId: string;
  userId: string;
  reason: string;
  now?: Date;
}): Promise<CancelByAuthorityResult> => {
  let existing: Appointment;
  try {
    existing = await appointmentRepo.getAppointmentDocument(input.appointmentId);
  } catch (error) {
    if (isNotFound(error)) return { ok: false, error: "Appointment not found" };
    throw error;
  }
  // Same message as a missing document so existence isn't leaked.
  if (existing.userId !== input.userId) {
    return { ok: false, error: "Appointment not found" };
  }
  if (existing.status === "cancelled") {
    return { ok: false, error: "This appointment is already cancelled" };
  }
  const start = new Date(existing.schedule as unknown as string | number | Date);
  if (start.getTime() < (input.now ?? new Date()).getTime()) {
    return { ok: false, error: "Past appointments cannot be cancelled" };
  }

  const updated = (await appointmentRepo.updateAppointmentDocument(
    input.appointmentId,
    {
      status: "cancelled",
      cancellationReason: input.reason,
      ...("slotId" in existing ? { cancelledBy: "patient" as const } : {}),
    }
  )) as unknown as Appointment;

  if (existing.slotId && existing.doctorId) {
    await releaseSlotAndOffer({
      slotId: existing.slotId,
      doctorId: existing.doctorId,
      start,
      excludeUserId: input.userId,
    });
  }
  return { ok: true, existing, updated };
};
