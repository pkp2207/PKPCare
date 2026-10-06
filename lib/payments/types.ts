// Provider-neutral payment types. No runtime imports.
//
// PCI scope: card data NEVER touches this app. Checkout happens on the
// provider's hosted page (Stripe Checkout / Razorpay Payment Links); we only
// store opaque provider ids, amounts and statuses.

export type PaymentProviderName = "none" | "stripe" | "razorpay" | "mock";

export type CheckoutInput = {
  /** Smallest currency unit (cents, paise). */
  amountMinor: number;
  /** ISO 4217, any case. */
  currency: string;
  /** Our correlation id: the appointment id. Echoed back by the provider. */
  reference: string;
  successUrl: string;
  cancelUrl: string;
  customer?: { email?: string | null; phone?: string | null };
  /** Providers that support it (Stripe) dedupe repeated creates with this. */
  idempotencyKey?: string;
  /** Session / link expiry. */
  expiresAt?: Date;
  description?: string;
};

export type CheckoutResult = {
  url: string;
  providerSessionId: string;
};

export type PaymentEventType =
  | "payment_succeeded"
  | "payment_failed"
  | "checkout_expired"
  | "ignored";

export type PaymentEvent = {
  /** Provider event id: the idempotency key for webhook delivery. */
  id: string;
  type: PaymentEventType;
  providerSessionId?: string;
  providerPaymentId?: string;
  reference?: string;
  amountMinor?: number;
  currency?: string;
};

export type HeadersLike =
  | { get(name: string): string | null }
  | Record<string, string | string[] | undefined>;

export interface PaymentProvider {
  readonly name: Exclude<PaymentProviderName, "none">;
  createCheckout(input: CheckoutInput): Promise<CheckoutResult>;
  /**
   * Verifies the signature over the RAW request body and returns the normalised
   * event. Throws WebhookVerificationError when it cannot be verified.
   */
  verifyWebhook(rawBody: string, headers: HeadersLike): PaymentEvent;
}

export class WebhookVerificationError extends Error {
  constructor(message = "Webhook verification failed") {
    super(message);
    this.name = "WebhookVerificationError";
  }
}

export class PaymentProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "PaymentProviderError";
  }
}
