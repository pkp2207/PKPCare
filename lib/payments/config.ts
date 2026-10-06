// Payment settings from env, read at call time. Payments are OFF by default:
// PAYMENTS_PROVIDER unset/none, or DEPOSIT_AMOUNT_MINOR unset/0, means no
// deposit is ever requested.
import { createMockProvider } from "./mock";
import { createRazorpayProvider } from "./razorpay";
import { createStripeProvider } from "./stripe";
import type { PaymentProvider, PaymentProviderName } from "./types";

type Env = Record<string, string | undefined>;

const MAX_AMOUNT_MINOR = 100_000_000;

export const paymentProviderName = (env: Env = process.env): PaymentProviderName => {
  const raw = (env.PAYMENTS_PROVIDER ?? "none").trim().toLowerCase();
  if (raw === "stripe" || raw === "razorpay") return raw;
  if (raw === "mock") {
    if (env.NODE_ENV === "production") {
      console.error("[payments] mock provider is refused in production; payments disabled");
      return "none";
    }
    return "mock";
  }
  return "none";
};

export const depositAmountMinor = (env: Env = process.env): number => {
  const n = Number(env.DEPOSIT_AMOUNT_MINOR);
  return Number.isInteger(n) && n > 0 && n <= MAX_AMOUNT_MINOR ? n : 0;
};

export const depositCurrency = (env: Env = process.env): string => {
  const raw = (env.DEPOSIT_CURRENCY ?? "").trim();
  return /^[A-Za-z]{3}$/.test(raw) ? raw.toUpperCase() : "USD";
};

/** Builds the configured provider, or null when disabled / missing secrets. */
export const getPaymentProvider = (
  env: Env = process.env,
  fetchImpl?: typeof fetch
): PaymentProvider | null => {
  switch (paymentProviderName(env)) {
    case "stripe":
      return env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET
        ? createStripeProvider({
            secretKey: env.STRIPE_SECRET_KEY,
            webhookSecret: env.STRIPE_WEBHOOK_SECRET,
            fetchImpl,
          })
        : null;
    case "razorpay":
      return env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET && env.RAZORPAY_WEBHOOK_SECRET
        ? createRazorpayProvider({
            keyId: env.RAZORPAY_KEY_ID,
            keySecret: env.RAZORPAY_KEY_SECRET,
            webhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
            fetchImpl,
          })
        : null;
    case "mock":
      return createMockProvider({ secret: env.PAYMENTS_MOCK_SECRET || "mock-secret" });
    default:
      return null;
  }
};

export type PaymentsConfig = {
  depositRequired: boolean;
  currency: string;
  amountMinor: number;
};

/**
 * A deposit is required only when a usable provider AND a positive amount are
 * configured, so a half-configured system never demands money it cannot take.
 */
export const getPaymentsConfig = (env: Env = process.env): PaymentsConfig => {
  const amountMinor = depositAmountMinor(env);
  const usable = getPaymentProvider(env) !== null;
  return {
    depositRequired: usable && amountMinor > 0,
    currency: depositCurrency(env),
    amountMinor: usable ? amountMinor : 0,
  };
};
