// Dev/test provider. Creates no real charge. Webhooks are signed with
// HMAC-SHA256(PAYMENTS_MOCK_SECRET) in the `x-mock-signature` header so the
// webhook route can be exercised end to end locally. Refused in production.
import { createHash } from "node:crypto";

import { getHeader, hmacSha256Hex, safeEqualHex } from "./crypto";
import {
  type CheckoutInput,
  type CheckoutResult,
  type HeadersLike,
  type PaymentEvent,
  type PaymentEventType,
  type PaymentProvider,
  WebhookVerificationError,
} from "./types";

const EVENT_TYPES: PaymentEventType[] = [
  "payment_succeeded",
  "payment_failed",
  "checkout_expired",
  "ignored",
];

export const createMockProvider = (options: { secret: string }): PaymentProvider => ({
  name: "mock",

  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    const providerSessionId = `mock_${createHash("sha256")
      .update(`${input.reference}:${input.idempotencyKey ?? Date.now()}`)
      .digest("hex")
      .slice(0, 24)}`;
    // Relative so the portal (which only follows https or same-origin paths)
    // can follow it in local http development.
    let url = input.successUrl;
    try {
      const parsed = new URL(input.successUrl);
      parsed.searchParams.set("mock_payment", providerSessionId);
      url = `${parsed.pathname}${parsed.search}`;
    } catch {
      // successUrl already relative
    }
    return { url, providerSessionId };
  },

  verifyWebhook(rawBody: string, headers: HeadersLike): PaymentEvent {
    const signature = getHeader(headers, "x-mock-signature");
    if (!signature || !options.secret) throw new WebhookVerificationError();
    if (!safeEqualHex(signature, hmacSha256Hex(options.secret, rawBody))) {
      throw new WebhookVerificationError();
    }
    let parsed: Partial<PaymentEvent>;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new WebhookVerificationError();
    }
    if (!parsed.id || typeof parsed.id !== "string") throw new WebhookVerificationError();
    const type = EVENT_TYPES.includes(parsed.type as PaymentEventType)
      ? (parsed.type as PaymentEventType)
      : "ignored";
    return {
      id: parsed.id,
      type,
      providerSessionId: parsed.providerSessionId,
      providerPaymentId: parsed.providerPaymentId,
      reference: parsed.reference,
      amountMinor: parsed.amountMinor,
      currency: parsed.currency,
    };
  },
});
