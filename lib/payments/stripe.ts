// Stripe Checkout Sessions over fetch (no SDK). Hosted checkout only: card data
// never reaches this app.
import { getHeader, hmacSha256Hex, safeEqualHex } from "./crypto";
import {
  type CheckoutInput,
  type CheckoutResult,
  type HeadersLike,
  PaymentProviderError,
  type PaymentEvent,
  type PaymentProvider,
  WebhookVerificationError,
} from "./types";

const API_BASE = "https://api.stripe.com/v1";
export const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 300;

export type StripeOptions = {
  secretKey: string;
  webhookSecret: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  toleranceSeconds?: number;
};

/** Parse `t=...,v1=...,v1=...` (v0 and unknown schemes are ignored). */
export const parseStripeSignature = (header: string) => {
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [key, value] = part.split("=", 2).map((s) => s?.trim());
    if (!key || !value) continue;
    if (key === "t") timestamp = Number.parseInt(value, 10);
    else if (key === "v1") signatures.push(value);
  }
  return { timestamp: Number.isFinite(timestamp as number) ? timestamp : null, signatures };
};

/** Header value Stripe would send; exported so tests can sign known vectors. */
export const signStripePayload = (secret: string, timestamp: number, rawBody: string) =>
  `t=${timestamp},v1=${hmacSha256Hex(secret, `${timestamp}.${rawBody}`)}`;

type StripeObject = {
  id?: string;
  payment_status?: string;
  client_reference_id?: string | null;
  payment_intent?: string | null;
  amount_total?: number | null;
  currency?: string | null;
  metadata?: Record<string, string> | null;
};

export const createStripeProvider = (options: StripeOptions): PaymentProvider => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const tolerance = options.toleranceSeconds ?? STRIPE_SIGNATURE_TOLERANCE_SECONDS;

  return {
    name: "stripe",

    async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
      const form = new URLSearchParams();
      form.set("mode", "payment");
      form.set("success_url", input.successUrl);
      form.set("cancel_url", input.cancelUrl);
      form.set("client_reference_id", input.reference);
      form.set("line_items[0][quantity]", "1");
      form.set("line_items[0][price_data][currency]", input.currency.toLowerCase());
      form.set("line_items[0][price_data][unit_amount]", String(input.amountMinor));
      form.set(
        "line_items[0][price_data][product_data][name]",
        input.description ?? "Appointment deposit"
      );
      form.set("metadata[reference]", input.reference);
      form.set("payment_intent_data[metadata][reference]", input.reference);
      if (input.customer?.email) form.set("customer_email", input.customer.email);
      if (input.expiresAt) {
        form.set("expires_at", String(Math.floor(input.expiresAt.getTime() / 1000)));
      }

      const headers: Record<string, string> = {
        Authorization: `Bearer ${options.secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      };
      if (input.idempotencyKey) headers["Idempotency-Key"] = input.idempotencyKey;

      const response = await fetchImpl(`${API_BASE}/checkout/sessions`, {
        method: "POST",
        headers,
        body: form.toString(),
      });
      // Never include the response body in the error: it can echo the email.
      if (!response.ok) {
        throw new PaymentProviderError(`stripe_http_${response.status}`, response.status);
      }
      const json = (await response.json()) as { id?: string; url?: string | null };
      if (!json.id || !json.url) throw new PaymentProviderError("stripe_bad_response");
      return { url: json.url, providerSessionId: json.id };
    },

    verifyWebhook(rawBody: string, headers: HeadersLike): PaymentEvent {
      const header = getHeader(headers, "stripe-signature");
      if (!header || !options.webhookSecret) throw new WebhookVerificationError();

      const { timestamp, signatures } = parseStripeSignature(header);
      if (timestamp === null || signatures.length === 0) throw new WebhookVerificationError();

      const ageSeconds = Math.abs(Math.floor(now().getTime() / 1000) - timestamp);
      if (ageSeconds > tolerance) throw new WebhookVerificationError();

      const expected = hmacSha256Hex(options.webhookSecret, `${timestamp}.${rawBody}`);
      // Check every candidate (no early exit on the first mismatch).
      let matched = false;
      for (const candidate of signatures) {
        if (safeEqualHex(candidate, expected)) matched = true;
      }
      if (!matched) throw new WebhookVerificationError();

      let event: { id?: string; type?: string; data?: { object?: StripeObject } };
      try {
        event = JSON.parse(rawBody);
      } catch {
        throw new WebhookVerificationError();
      }
      if (!event.id || typeof event.id !== "string") throw new WebhookVerificationError();

      const object = event.data?.object ?? {};
      const base = {
        id: event.id,
        providerSessionId: object.id,
        providerPaymentId: object.payment_intent ?? undefined,
        reference: object.client_reference_id ?? object.metadata?.reference ?? undefined,
        amountMinor: typeof object.amount_total === "number" ? object.amount_total : undefined,
        currency: object.currency ? object.currency.toUpperCase() : undefined,
      };

      switch (event.type) {
        case "checkout.session.completed":
          // "unpaid" = delayed method: wait for async_payment_succeeded.
          return {
            ...base,
            type: object.payment_status === "paid" ? "payment_succeeded" : "ignored",
          };
        case "checkout.session.async_payment_succeeded":
          return { ...base, type: "payment_succeeded" };
        case "checkout.session.async_payment_failed":
          return { ...base, type: "payment_failed" };
        case "checkout.session.expired":
          return { ...base, type: "checkout_expired" };
        default:
          return { id: event.id, type: "ignored" };
      }
    },
  };
};
