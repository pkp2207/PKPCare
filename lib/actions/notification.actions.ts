"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { isNotFound } from "@/lib/appwrite/client";
import { notifyAppointment } from "@/lib/notifications/events";
import { verifyLinkToken } from "@/lib/notifications/links";
import {
  getNotificationAppointment,
  patchAppointmentFlags,
} from "@/lib/notifications/store";
import { onAppointmentCancelled } from "@/lib/payments/refund";
import { auditSafe } from "@/lib/scheduling/audit";
import { cancelAppointmentByAuthority } from "@/lib/scheduling/cancel";

// Signed-link actions. The token IS the authority (no session): every path
// verifies signature, expiry and purpose, re-checks that the appointment
// belongs to the token's user, and is audited. Errors are deliberately generic.

const INVALID_LINK = "This link is invalid or has expired.";
const GENERIC = "Something went wrong. Please try again.";

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

const CancelViaLinkSchema = z.object({
  token: z.string().min(1).max(512),
  reason: z
    .string()
    .trim()
    .min(2, "Reason must be at least 2 characters")
    .max(500, "Reason must be at most 500 characters"),
});

const denied = (action: string) =>
  auditSafe({
    actorId: null,
    actorRole: "anonymous",
    action,
    resource: "appointment",
    outcome: "denied",
  });

export const confirmAttendance = async (
  token: string
): Promise<ActionResult<{ confirmedAt: string; alreadyConfirmed: boolean }>> => {
  const action = "appointment.confirm_link";
  try {
    const verified = verifyLinkToken(token, "confirm");
    if (!verified.ok) {
      denied(action);
      return fail(INVALID_LINK);
    }
    const { claims } = verified;

    const appointment = await getNotificationAppointment(claims.appointmentId);
    // Same message as a missing document so existence isn't leaked.
    if (appointment.userId !== claims.userId) {
      denied(action);
      return fail(INVALID_LINK);
    }
    if (appointment.status === "cancelled") {
      return fail("This appointment has been cancelled.");
    }
    if (new Date(appointment.schedule as unknown as string).getTime() <= Date.now()) {
      return fail("This appointment has already started.");
    }

    // Single use: a second tap reports the original confirmation time.
    if (appointment.confirmedByPatientAt) {
      return {
        ok: true,
        data: { confirmedAt: appointment.confirmedByPatientAt, alreadyConfirmed: true },
      };
    }
    if (!("confirmedByPatientAt" in appointment)) {
      // Attribute missing: run scripts/appwrite-setup.mjs. Never pretend.
      console.error("[notify] appointments.confirmedByPatientAt attribute is missing");
      return fail(GENERIC);
    }

    const confirmedAt = new Date().toISOString();
    await patchAppointmentFlags(claims.appointmentId, { confirmedByPatientAt: confirmedAt });

    auditSafe({
      actorId: claims.userId,
      actorRole: "patient_link",
      action,
      resource: "appointment",
      resourceId: claims.appointmentId,
    });
    revalidatePath("/admin");
    return { ok: true, data: { confirmedAt, alreadyConfirmed: false } };
  } catch (error) {
    if (isNotFound(error)) {
      denied(action);
      return fail(INVALID_LINK);
    }
    console.error("[notify] confirmAttendance failed:", (error as Error)?.name);
    auditSafe({
      actorId: null,
      actorRole: "patient_link",
      action,
      resource: "appointment",
      outcome: "error",
    });
    return fail(GENERIC);
  }
};

export const cancelViaLink = async (params: {
  token: string;
  reason: string;
}): Promise<ActionResult<{ cancelled: true }>> => {
  const action = "appointment.cancel_link";
  try {
    const parsed = CancelViaLinkSchema.safeParse(params);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input");
    }
    const verified = verifyLinkToken(parsed.data.token, "cancel");
    if (!verified.ok) {
      denied(action);
      return fail(INVALID_LINK);
    }
    const { claims } = verified;

    const result = await cancelAppointmentByAuthority({
      appointmentId: claims.appointmentId,
      userId: claims.userId,
      reason: parsed.data.reason,
    });
    if (!result.ok) {
      if (result.error === "Appointment not found") denied(action);
      return fail(result.error === "Appointment not found" ? INVALID_LINK : result.error);
    }

    await notifyAppointment("cancelled", result.existing);
    await onAppointmentCancelled(result.existing);

    auditSafe({
      actorId: claims.userId,
      actorRole: "patient_link",
      action,
      resource: "appointment",
      resourceId: claims.appointmentId,
    });
    revalidatePath("/admin");
    return { ok: true, data: { cancelled: true } };
  } catch (error) {
    console.error("[notify] cancelViaLink failed:", (error as Error)?.name);
    auditSafe({
      actorId: null,
      actorRole: "patient_link",
      action,
      resource: "appointment",
      outcome: "error",
    });
    return fail(GENERIC);
  }
};
