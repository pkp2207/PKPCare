// Refund policy hook + stub. NOTHING here moves money: refunds are not
// implemented and must be issued manually in the provider dashboard.
import { auditSafe } from "@/lib/scheduling/audit";

export const DEFAULT_REFUND_WINDOW_HOURS = 24;

/** `DEPOSIT_REFUND_HOURS`: cancel at least this long before the start to qualify. */
export const refundWindowHours = (
  env: Record<string, string | undefined> = process.env
): number => {
  const n = Number(env.DEPOSIT_REFUND_HOURS);
  return Number.isFinite(n) && n >= 0 && n <= 24 * 30 ? n : DEFAULT_REFUND_WINDOW_HOURS;
};

/** Policy hook: refund-eligible when cancelled >= X hours before the start. */
export const isDepositRefundEligible = (input: {
  appointmentStart: Date | string;
  cancelledAt?: Date;
  hoursBefore?: number;
}): boolean => {
  const start = new Date(input.appointmentStart).getTime();
  const at = (input.cancelledAt ?? new Date()).getTime();
  if (!Number.isFinite(start)) return false;
  return start - at >= (input.hoursBefore ?? refundWindowHours()) * 3_600_000;
};

/** Stub: documented extension point. Always "not implemented". */
// eslint-disable-next-line no-unused-vars
export const refundDeposit = async (
  appointmentId: string
): Promise<{ ok: false; error: string }> => {
  return {
    ok: false,
    error: "not_implemented: refunds are not automated; refund in the payment provider dashboard",
  };
};

/**
 * Called after a cancellation. If a deposit was paid, writes an audit entry
 * stating whether the cancellation falls inside the refund window so staff can
 * act. Never refunds, never throws.
 */
export const onAppointmentCancelled = async (appointment: {
  $id: string;
  schedule: Date | string;
  depositStatus?: string | null;
}): Promise<void> => {
  try {
    if (appointment.depositStatus !== "paid") return;
    const eligible = isDepositRefundEligible({ appointmentStart: appointment.schedule });
    auditSafe({
      actorId: null,
      actorRole: "system",
      action: "payment.refund_review",
      resource: "appointment",
      resourceId: appointment.$id,
      meta: { status: eligible ? "eligible" : "ineligible" },
    });
  } catch {
    // Best effort only.
  }
};
