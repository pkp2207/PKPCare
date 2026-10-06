// Razorpay Payment Links over fetch (no SDK). Hosted payment page only.
import { createHash } from "node:crypto";

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

const API_BASE = "https://api.razorpay.com/v1";
/** Razorpay requires expire_by to be at least 15 minutes ahead. */
const MIN_EXPIRY_SECONDS = 16 * 60;

export type RazorpayOptions = {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
};

type RzpEntity = {
  id?: string;
  reference_id?: string | null;
  amount?: number;
  amount_paid?: number;
  currency?: string;
};

export const createRazorpayProvider = (options: RazorpayOptions): PaymentProvider => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());

  return {
    name: "razorpay",

    async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
      const nowSeconds = Math.floor(now().getTime() / 1000);
      const requested = input.expiresAt
        ? Math.floor(input.expiresAt.getTime() / 1000)
        : nowSeconds + 23 * 3600;
      const body: Record<string, unknown> = {
        amount: input.amountMinor,
        currency: input.currency.toUpperCase(),
        accept_partial: false,
        reference_id: input.reference.slice(0, 40),
        description: input.description ?? "Appointment deposit",
        // Our app sends the messages; Razorpay must not (less PII shared).
        notify: { sms: false, email: false },
        reminder_enable: false,
        callback_url: input.successUrl,
        callback_method: "get",
        expire_by: Math.max(requested, nowSeconds + MIN_EXPIRY_SECONDS),
        notes: { reference: input.reference },
      };
      const email = input.customer?.email;
      const contact = input.customer?.phone;
      if (email || contact) {
        body.customer = {
          ...(email ? { email } : {}),
          ...(contact && /^\+?\d{8,15}$/.test(contact.replace(/[\s-]/g, ""))
            ? { contact: contact.replace(/[\s-]/g, "") }
            : {}),
        };
      }

      const auth = Buffer.from(`${options.keyId}:${options.keySecret}`).toString("base64");
      const response = await fetchImpl(`${API_BASE}/payment_links`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        throw new PaymentProviderError(`razorpay_http_${response.status}`, response.status);
      }
      const json = (await response.json()) as { id?: string; short_url?: string };
      if (!json.id || !json.short_url) throw new PaymentProviderError("razorpay_bad_response");
      return { url: json.short_url, providerSessionId: json.id };
    },

    verifyWebhook(rawBody: string, headers: HeadersLike): PaymentEvent {
      const signature = getHeader(headers, "x-razorpay-signature");
      if (!signature || !options.webhookSecret) throw new WebhookVerificationError();
      if (!safeEqualHex(signature, hmacSha256Hex(options.webhookSecret, rawBody))) {
        throw new WebhookVerificationError();
      }

      let event: {
        event?: string;
        payload?: {
          payment_link?: { entity?: RzpEntity };
          payment?: { entity?: RzpEntity };
        };
      };
      try {
        event = JSON.parse(rawBody);
      } catch {
        throw new WebhookVerificationError();
      }

      // Razorpay sends a unique id per event in this header; hashing the body is
      // a stable fallback (identical redeliveries hash identically).
      const id =
        getHeader(headers, "x-razorpay-event-id") ??
        `body_${createHash("sha256").update(rawBody).digest("hex").slice(0, 40)}`;

      const link = event.payload?.payment_link?.entity ?? {};
      const payment = event.payload?.payment?.entity ?? {};
      const base = {
        id,
        providerSessionId: link.id,
        providerPaymentId: payment.id,
        reference: link.reference_id ?? undefined,
        amountMinor: typeof link.amount === "number" ? link.amount : undefined,
        currency: link.currency ? link.currency.toUpperCase() : undefined,
      };

      switch (event.event) {
        case "payment_link.paid":
          return { ...base, type: "payment_succeeded" };
        case "payment_link.expired":
        case "payment_link.cancelled":
          return { ...base, type: "checkout_expired" };
        default:
          return { id, type: "ignored" };
      }
    },
  };
};
