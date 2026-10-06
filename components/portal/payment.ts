// Post-booking routing: success page, or the payment provider's checkout when a
// deposit is required. Pure so the decision is unit tested
// (tests/portal/payment.test.ts). Contract with N1's payment.actions:
//   getDepositCheckout(appointmentId, userId):
//     ActionResult<{ required: boolean; url?: string }>
// A failed / missing / malformed result is treated as "no deposit required" so
// a payments outage can never block a booking that already succeeded.

export type DepositCheckoutResult =
  | { ok: true; data: { required: boolean; url?: string } }
  | { ok: false; error: string };

export type PostBookingDestination =
  | { kind: "success"; href: string }
  | { kind: "checkout"; url: string };

export const successHref = (userId: string, appointmentId: string) =>
  `/patients/${encodeURIComponent(userId)}/new-appointment/success?appointmentId=${encodeURIComponent(appointmentId)}`;

/** Only https URLs (or same-origin relative paths) are followed. */
export const isSafeCheckoutUrl = (url: unknown): url is string => {
  if (typeof url !== "string" || url.length === 0 || url.length > 2048) return false;
  if (url.startsWith("/") && !url.startsWith("//") && !url.includes("\\")) return true;
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
};

export const resolvePostBooking = (
  userId: string,
  appointmentId: string,
  checkout: DepositCheckoutResult | null | undefined
): PostBookingDestination => {
  if (
    checkout &&
    checkout.ok &&
    checkout.data &&
    checkout.data.required === true &&
    isSafeCheckoutUrl(checkout.data.url)
  ) {
    return { kind: "checkout", url: checkout.data.url };
  }
  return { kind: "success", href: successHref(userId, appointmentId) };
};

/** "USD 12.50" style amount from minor units, honouring the currency's decimals. */
export const formatMinorAmount = (amountMinor: number, currency: string): string => {
  const code = (currency || "").toUpperCase();
  try {
    const formatter = new Intl.NumberFormat("en-US", { style: "currency", currency: code });
    const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
    return formatter.format(amountMinor / 10 ** digits);
  } catch {
    return `${(amountMinor / 100).toFixed(2)} ${code}`.trim();
  }
};
