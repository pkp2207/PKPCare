"use server";

import * as appointmentRepo from "@/lib/appwrite/appointment.repository";
import { isNotFound } from "@/lib/appwrite/client";
import { AdminAuthError } from "@/lib/auth/admin";
import { assertPatientOrStaffOwns, PatientAuthError } from "@/lib/auth/patient";
import { appBaseUrl } from "@/lib/notifications/config";
import { getPaymentsConfig } from "@/lib/payments/config";
import { getOrCreateDepositCheckout } from "@/lib/payments/deposit";
import { auditSafe } from "@/lib/scheduling/audit";
import { IdSchema } from "@/lib/validation";

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** Public, secret-free view of the deposit settings. */
export const getPaymentConfig = async (): Promise<
  ActionResult<{ depositRequired: boolean; currency: string; amountMinor: number }>
> => {
  const { depositRequired, currency, amountMinor } = getPaymentsConfig();
  return { ok: true, data: { depositRequired, currency, amountMinor } };
};

/**
 * Checkout URL for the appointment's deposit. Idempotent: reuses an open
 * checkout. `{ required: false }` when deposits are off or already settled.
 */
export const getDepositCheckout = async (
  appointmentId: string,
  userId: string
): Promise<ActionResult<{ required: boolean; url?: string }>> => {
  try {
    const parsedAppointment = IdSchema.safeParse(appointmentId);
    const parsedUser = IdSchema.safeParse(userId);
    if (!parsedAppointment.success || !parsedUser.success) return fail("Invalid id");

    await assertPatientOrStaffOwns(parsedUser.data);

    if (!getPaymentsConfig().depositRequired) {
      return { ok: true, data: { required: false } };
    }

    const appointment = await appointmentRepo.getAppointmentDocument(parsedAppointment.data);
    // Same message as a missing document so existence isn't leaked.
    if (appointment.userId !== parsedUser.data) return fail("Appointment not found");
    if (appointment.status === "cancelled") {
      return { ok: true, data: { required: false } };
    }

    const base = appBaseUrl();
    if (!base) {
      console.error("[payments] APP_BASE_URL is not set; cannot build checkout return URLs");
      return fail("Payments are not available right now.");
    }
    const page = `${base}/patients/${encodeURIComponent(parsedUser.data)}/new-appointment/success`;
    const query = `appointmentId=${encodeURIComponent(parsedAppointment.data)}`;

    const outcome = await getOrCreateDepositCheckout(
      {
        $id: appointment.$id,
        userId: appointment.userId,
        depositStatus: (appointment as { depositStatus?: string | null }).depositStatus,
        patient: appointment.patient,
      },
      {
        successUrl: `${page}?${query}&deposit=success`,
        cancelUrl: `${page}?${query}&deposit=cancelled`,
      }
    );

    auditSafe({
      actorId: parsedUser.data,
      actorRole: "patient",
      action: "payment.checkout",
      resource: "appointment",
      resourceId: appointment.$id,
      meta: { status: outcome.required ? "required" : "none" },
    });
    return { ok: true, data: outcome };
  } catch (error) {
    if (error instanceof AdminAuthError || error instanceof PatientAuthError) {
      return fail(error.message === "Forbidden" ? "Forbidden" : "Unauthorized");
    }
    if (isNotFound(error)) return fail("Appointment not found");
    console.error("[payments] getDepositCheckout failed:", (error as Error)?.name);
    return fail("Something went wrong. Please try again.");
  }
};
