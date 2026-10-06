// Applies a verified payment event. Idempotent on the provider event id.
import { safeLogLine } from "@/lib/compliance/redact";
import { notifyAppointment } from "@/lib/notifications/events";
import { formatMinorAmount } from "@/lib/notifications/money";
import { getNotificationAppointment } from "@/lib/notifications/store";
import { auditSafe } from "@/lib/scheduling/audit";

import {
  findPaymentBySession,
  setAppointmentDepositStatus,
  updatePayment,
} from "./store";
import type { PaymentEvent } from "./types";

const MAX_EVENT_IDS = 20;

export type WebhookOutcome =
  | { handled: false; reason: "ignored" | "unknown_payment" }
  | { handled: true; duplicate: boolean; reason?: "amount_mismatch" };

export const processPaymentEvent = async (
  event: PaymentEvent,
  options: { now?: Date } = {}
): Promise<WebhookOutcome> => {
  if (event.type === "ignored" || !event.providerSessionId) {
    return { handled: false, reason: "ignored" };
  }

  const payment = await findPaymentBySession(event.providerSessionId);
  if (!payment) {
    console.error(`[payments] event for unknown session ${safeLogLine(event.providerSessionId, 40)}`);
    return { handled: false, reason: "unknown_payment" };
  }

  const seen = payment.eventIds ?? [];
  if (seen.includes(event.id)) return { handled: true, duplicate: true };
  const eventIds = [...seen, event.id].slice(-MAX_EVENT_IDS);
  const now = options.now ?? new Date();

  const audit = (action: string, outcome: "success" | "error", status: string) =>
    auditSafe({
      actorId: null,
      actorRole: "system",
      action,
      resource: "payment",
      resourceId: payment.$id,
      outcome,
      meta: { status },
    });

  if (event.type === "payment_succeeded") {
    const mismatch =
      (event.amountMinor !== undefined && event.amountMinor !== payment.amountMinor) ||
      (event.currency !== undefined &&
        event.currency.toUpperCase() !== payment.currency.toUpperCase());
    if (mismatch) {
      // Never mark paid for a different amount: record the event, flag for staff.
      await updatePayment(payment.$id, { eventIds });
      audit("payment.webhook", "error", "amount_mismatch");
      return { handled: true, duplicate: false, reason: "amount_mismatch" };
    }
    if (payment.status === "paid") {
      await updatePayment(payment.$id, { eventIds });
      return { handled: true, duplicate: false };
    }

    // Appointment first (idempotent), then the payment doc that records the
    // event id: a failure in between is retried by the provider and redone.
    await setAppointmentDepositStatus(payment.appointmentId, "paid");
    await updatePayment(payment.$id, {
      status: "paid",
      paidAt: now.toISOString(),
      providerPaymentId: event.providerPaymentId ?? payment.providerPaymentId ?? null,
      eventIds,
    });
    audit("payment.paid", "success", "paid");

    try {
      const appointment = await getNotificationAppointment(payment.appointmentId);
      await notifyAppointment("deposit_received", appointment, {
        idempotencyKey: `deposit:${payment.$id}`,
        amountText: formatMinorAmount(payment.amountMinor, payment.currency),
      });
    } catch (error) {
      console.error(`[payments] deposit notification failed: ${safeLogLine((error as Error)?.name)}`);
    }
    return { handled: true, duplicate: false };
  }

  if (event.type === "payment_failed" || event.type === "checkout_expired") {
    const next = event.type === "payment_failed" ? "failed" : "expired";
    if (payment.status === "pending") {
      await updatePayment(payment.$id, { status: next, eventIds });
      try {
        const appointment = await getNotificationAppointment(payment.appointmentId);
        if ((appointment as { depositStatus?: string }).depositStatus === "pending") {
          await setAppointmentDepositStatus(payment.appointmentId, next);
        }
      } catch (error) {
        console.error(`[payments] depositStatus sync failed: ${safeLogLine((error as Error)?.name)}`);
      }
      audit("payment.webhook", "success", next);
    } else {
      await updatePayment(payment.$id, { eventIds });
    }
    return { handled: true, duplicate: false };
  }

  return { handled: false, reason: "ignored" };
};
