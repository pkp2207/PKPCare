// Deposit checkout orchestration (idempotent). Not a "use server" file.
import { isConflict } from "@/lib/appwrite/client";
import { safeLogLine } from "@/lib/compliance/redact";

import { getPaymentProvider, getPaymentsConfig } from "./config";
import {
  createPayment,
  getPayment,
  listPaymentsForAppointment,
  paymentDocId,
  setAppointmentDepositStatus,
  type PaymentDoc,
} from "./store";
import type { PaymentProvider } from "./types";

/** Checkout sessions / links live this long; an open one is reused until 1h before. */
export const CHECKOUT_TTL_MS = 23 * 60 * 60 * 1000;
const REUSE_MARGIN_MS = 60 * 60 * 1000;

export type DepositAppointment = {
  $id: string;
  userId: string;
  depositStatus?: string | null;
  patient?: { email?: string | null; phone?: string | null } | null;
};

export type DepositCheckoutOutcome = { required: boolean; url?: string };

export type DepositDeps = {
  provider?: PaymentProvider | null;
  now?: () => Date;
};

const reusable = (payment: PaymentDoc, now: Date) =>
  payment.status === "pending" &&
  Boolean(payment.checkoutUrl) &&
  Boolean(payment.expiresAt) &&
  Date.parse(payment.expiresAt as string) - now.getTime() > REUSE_MARGIN_MS;

/**
 * Returns the deposit checkout URL for an appointment, creating a provider
 * session only when there is no open one. `{ required: false }` when deposits
 * are off or already settled.
 */
export const getOrCreateDepositCheckout = async (
  appointment: DepositAppointment,
  urls: { successUrl: string; cancelUrl: string },
  deps: DepositDeps = {}
): Promise<DepositCheckoutOutcome> => {
  const config = getPaymentsConfig();
  if (!config.depositRequired) return { required: false };
  if (appointment.depositStatus === "paid" || appointment.depositStatus === "waived") {
    return { required: false };
  }
  const provider = deps.provider === undefined ? getPaymentProvider() : deps.provider;
  if (!provider) return { required: false };
  const now = (deps.now ?? (() => new Date()))();

  const attempts = await listPaymentsForAppointment(appointment.$id);
  if (attempts.some((p) => p.status === "paid")) return { required: false };
  const open = attempts.find((p) => reusable(p, now));
  if (open) return { required: true, url: open.checkoutUrl as string };

  const attempt = attempts.length;
  const id = paymentDocId(appointment.$id, attempt);
  const expiresAt = new Date(now.getTime() + CHECKOUT_TTL_MS);

  const checkout = await provider.createCheckout({
    amountMinor: config.amountMinor,
    currency: config.currency,
    reference: appointment.$id,
    successUrl: urls.successUrl,
    cancelUrl: urls.cancelUrl,
    customer: {
      email: appointment.patient?.email ?? undefined,
      phone: appointment.patient?.phone ?? undefined,
    },
    // Same key for the same attempt: a double click gets the same Stripe session.
    idempotencyKey: `pkpcare-deposit-${appointment.$id}-${attempt}`,
    expiresAt,
    description: "Appointment deposit",
  });

  try {
    await createPayment(id, {
      appointmentId: appointment.$id,
      userId: appointment.userId,
      provider: provider.name,
      providerSessionId: checkout.providerSessionId,
      amountMinor: config.amountMinor,
      currency: config.currency,
      status: "pending",
      checkoutUrl: checkout.url,
      eventIds: [],
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    if (!isConflict(error)) throw error;
    // A concurrent request won the race for this attempt: use its session.
    const existing = await getPayment(id);
    return { required: true, url: existing.checkoutUrl ?? checkout.url };
  }

  try {
    await setAppointmentDepositStatus(appointment.$id, "pending");
  } catch (error) {
    console.error(`[payments] depositStatus update failed: ${safeLogLine((error as Error)?.name)}`);
  }
  return { required: true, url: checkout.url };
};
