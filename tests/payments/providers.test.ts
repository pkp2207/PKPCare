import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { getPaymentProvider, getPaymentsConfig } from "@/lib/payments/config";
import { createMockProvider } from "@/lib/payments/mock";
import { createRazorpayProvider } from "@/lib/payments/razorpay";
import { createStripeProvider, parseStripeSignature, signStripePayload } from "@/lib/payments/stripe";
import { WebhookVerificationError } from "@/lib/payments/types";

const NOW = new Date("2026-10-07T08:00:00.000Z");
const ts = Math.floor(NOW.getTime() / 1000);
const WHSEC = "whsec_test_secret";

const stripe = (fetchImpl?: typeof fetch) =>
  createStripeProvider({ secretKey: "sk_test_x", webhookSecret: WHSEC, now: () => NOW, fetchImpl });

const stripeBody = (over: Record<string, unknown> = {}, type = "checkout.session.completed") =>
  JSON.stringify({
    id: "evt_1",
    type,
    data: {
      object: {
        id: "cs_1",
        payment_status: "paid",
        client_reference_id: "appt1",
        payment_intent: "pi_1",
        amount_total: 2500,
        currency: "usd",
        ...over,
      },
    },
  });

describe("stripe webhook verification", () => {
  it("accepts a correctly signed body (independently computed HMAC)", () => {
    const body = stripeBody();
    const v1 = createHmac("sha256", WHSEC).update(`${ts}.${body}`).digest("hex");
    const event = stripe().verifyWebhook(body, { "stripe-signature": `t=${ts},v1=${v1}` });
    expect(event).toMatchObject({
      id: "evt_1",
      type: "payment_succeeded",
      providerSessionId: "cs_1",
      providerPaymentId: "pi_1",
      reference: "appt1",
      amountMinor: 2500,
      currency: "USD",
    });
  });

  it("accepts any matching v1 among several and ignores v0", () => {
    const body = stripeBody();
    const good = signStripePayload(WHSEC, ts, body).split("v1=")[1];
    const header = `t=${ts},v0=aaaa,v1=${"0".repeat(64)},v1=${good}`;
    expect(stripe().verifyWebhook(body, { "Stripe-Signature": header }).id).toBe("evt_1");
    expect(parseStripeSignature(header).signatures).toHaveLength(2);
  });

  it("rejects tampered body, wrong secret, bad/missing header and old timestamps", () => {
    const body = stripeBody();
    const header = signStripePayload(WHSEC, ts, body);
    const p = stripe();
    expect(() => p.verifyWebhook(body.replace("2500", "1"), { "stripe-signature": header })).toThrow(WebhookVerificationError);
    expect(() => p.verifyWebhook(body, { "stripe-signature": signStripePayload("other", ts, body) })).toThrow(WebhookVerificationError);
    expect(() => p.verifyWebhook(body, {})).toThrow(WebhookVerificationError);
    expect(() => p.verifyWebhook(body, { "stripe-signature": "garbage" })).toThrow(WebhookVerificationError);
    expect(() => p.verifyWebhook(body, { "stripe-signature": signStripePayload(WHSEC, ts - 301, body) })).toThrow(WebhookVerificationError);
    expect(p.verifyWebhook(body, { "stripe-signature": signStripePayload(WHSEC, ts - 299, body) }).id).toBe("evt_1");
  });

  it("maps event types and ignores unpaid/unknown", () => {
    const p = stripe();
    const h = (b: string) => ({ "stripe-signature": signStripePayload(WHSEC, ts, b) });
    const unpaid = stripeBody({ payment_status: "unpaid" });
    expect(p.verifyWebhook(unpaid, h(unpaid)).type).toBe("ignored");
    const expired = stripeBody({}, "checkout.session.expired");
    expect(p.verifyWebhook(expired, h(expired)).type).toBe("checkout_expired");
    const failed = stripeBody({}, "checkout.session.async_payment_failed");
    expect(p.verifyWebhook(failed, h(failed)).type).toBe("payment_failed");
    const other = stripeBody({}, "customer.created");
    expect(p.verifyWebhook(other, h(other)).type).toBe("ignored");
  });
});

describe("stripe checkout", () => {
  it("posts a form-encoded session with an idempotency key", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: "cs_9", url: "https://checkout.stripe.com/c/pay/cs_9" }), { status: 200 }));
    const result = await stripe(fetchImpl as never).createCheckout({
      amountMinor: 2500,
      currency: "USD",
      reference: "appt1",
      successUrl: "https://app/success",
      cancelUrl: "https://app/cancel",
      customer: { email: "p@example.com" },
      idempotencyKey: "dep-1",
    });
    expect(result).toEqual({ url: "https://checkout.stripe.com/c/pay/cs_9", providerSessionId: "cs_9" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.stripe.com/v1/checkout/sessions");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk_test_x");
    expect(headers["Idempotency-Key"]).toBe("dep-1");
    const form = new URLSearchParams(init.body as string);
    expect(form.get("mode")).toBe("payment");
    expect(form.get("line_items[0][price_data][unit_amount]")).toBe("2500");
    expect(form.get("line_items[0][price_data][currency]")).toBe("usd");
    expect(form.get("client_reference_id")).toBe("appt1");
  });

  it("throws a body-free error on HTTP failure", async () => {
    const fetchImpl = vi.fn(async () => new Response("email p@example.com invalid", { status: 402 }));
    await expect(
      stripe(fetchImpl as never).createCheckout({ amountMinor: 1, currency: "USD", reference: "a", successUrl: "s", cancelUrl: "c" })
    ).rejects.toThrow(/^stripe_http_402$/);
  });
});

describe("razorpay", () => {
  const rzp = (fetchImpl?: typeof fetch) =>
    createRazorpayProvider({ keyId: "rzp_k", keySecret: "rzp_s", webhookSecret: "rzp_wh", fetchImpl, now: () => NOW });
  const body = JSON.stringify({
    event: "payment_link.paid",
    payload: {
      payment_link: { entity: { id: "plink_1", reference_id: "appt1", amount: 50000, currency: "INR" } },
      payment: { entity: { id: "pay_1" } },
    },
  });
  const sig = (b: string, secret = "rzp_wh") => createHmac("sha256", secret).update(b).digest("hex");

  it("verifies X-Razorpay-Signature and maps payment_link.paid", () => {
    const event = rzp().verifyWebhook(body, { "x-razorpay-signature": sig(body), "x-razorpay-event-id": "evt_r1" });
    expect(event).toMatchObject({
      id: "evt_r1",
      type: "payment_succeeded",
      providerSessionId: "plink_1",
      providerPaymentId: "pay_1",
      reference: "appt1",
      amountMinor: 50000,
      currency: "INR",
    });
  });

  it("falls back to a body hash id and rejects bad signatures", () => {
    const a = rzp().verifyWebhook(body, { "x-razorpay-signature": sig(body) });
    const b = rzp().verifyWebhook(body, { "x-razorpay-signature": sig(body) });
    expect(a.id).toBe(b.id);
    expect(() => rzp().verifyWebhook(body, { "x-razorpay-signature": sig(body, "nope") })).toThrow(WebhookVerificationError);
    expect(() => rzp().verifyWebhook(body + " ", { "x-razorpay-signature": sig(body) })).toThrow(WebhookVerificationError);
    expect(() => rzp().verifyWebhook(body, {})).toThrow(WebhookVerificationError);
  });

  it("creates a payment link with basic auth and minimum expiry", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: "plink_2", short_url: "https://rzp.io/i/x" }), { status: 200 }));
    const result = await rzp(fetchImpl as never).createCheckout({
      amountMinor: 50000,
      currency: "inr",
      reference: "appt1",
      successUrl: "https://app/success",
      cancelUrl: "https://app/cancel",
      expiresAt: new Date(NOW.getTime() + 60_000),
    });
    expect(result).toEqual({ url: "https://rzp.io/i/x", providerSessionId: "plink_2" });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("rzp_k:rzp_s").toString("base64")}`);
    const sent = JSON.parse(init.body as string);
    expect(sent).toMatchObject({ amount: 50000, currency: "INR", reference_id: "appt1", notify: { sms: false, email: false } });
    expect(sent.expire_by).toBeGreaterThanOrEqual(ts + 15 * 60);
  });
});

describe("mock provider and config", () => {
  it("verifies its own HMAC", () => {
    const p = createMockProvider({ secret: "m" });
    const body = JSON.stringify({ id: "e1", type: "payment_succeeded", providerSessionId: "mock_1" });
    const sig = createHmac("sha256", "m").update(body).digest("hex");
    expect(p.verifyWebhook(body, { "x-mock-signature": sig }).type).toBe("payment_succeeded");
    expect(() => p.verifyWebhook(body, { "x-mock-signature": "00" })).toThrow(WebhookVerificationError);
  });

  it("payments are OFF by default", () => {
    expect(getPaymentsConfig({})).toEqual({ depositRequired: false, currency: "USD", amountMinor: 0 });
    expect(getPaymentProvider({})).toBeNull();
  });

  it("needs provider + secrets + a positive amount", () => {
    expect(getPaymentsConfig({ PAYMENTS_PROVIDER: "mock" }).depositRequired).toBe(false);
    expect(getPaymentsConfig({ DEPOSIT_AMOUNT_MINOR: "2500" }).depositRequired).toBe(false);
    expect(getPaymentsConfig({ PAYMENTS_PROVIDER: "stripe", DEPOSIT_AMOUNT_MINOR: "2500" }).depositRequired).toBe(false);
    expect(
      getPaymentsConfig({ PAYMENTS_PROVIDER: "stripe", STRIPE_SECRET_KEY: "k", STRIPE_WEBHOOK_SECRET: "w", DEPOSIT_AMOUNT_MINOR: "2500", DEPOSIT_CURRENCY: "eur" })
    ).toEqual({ depositRequired: true, currency: "EUR", amountMinor: 2500 });
    expect(getPaymentsConfig({ PAYMENTS_PROVIDER: "mock", DEPOSIT_AMOUNT_MINOR: "-5" }).depositRequired).toBe(false);
  });

  it("refuses the mock provider in production", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(getPaymentProvider({ PAYMENTS_PROVIDER: "mock", NODE_ENV: "production" })).toBeNull();
  });
});
