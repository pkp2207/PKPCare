# Deposits and payments (optional, off by default)

Nothing changes unless **both** `PAYMENTS_PROVIDER` (stripe | razorpay | mock)
with its secrets **and** `DEPOSIT_AMOUNT_MINOR > 0` are set. A half-configured
system reports `depositRequired: false` rather than demand money it cannot take.

## PCI scope

Not a PCI scope expansion: card data **never touches the app**. Checkout is
Stripe Checkout / Razorpay Payment Links (hosted pages); the app stores only
opaque provider ids, amounts and statuses, and receives signed webhooks. There
are no card fields, no provider JS on our pages, and no SDKs (plain `fetch` +
Node `crypto`). Your own PCI self-assessment (likely SAQ A) is still your call.

## Actions (`lib/actions/payment.actions.ts`)

```ts
getPaymentConfig(): Promise<ActionResult<{ depositRequired: boolean; currency: string; amountMinor: number }>>
getDepositCheckout(appointmentId: string, userId: string): Promise<ActionResult<{ required: boolean; url?: string }>>
```

`getDepositCheckout` checks ownership (`assertPatientOrStaffOwns` + appointment
belongs to `userId`), returns `{ required: false }` when deposits are off, the
appointment is cancelled or the deposit is already paid/waived, and otherwise
**reuses an open checkout** (until 1h before its 23h expiry) or creates one. It
needs `APP_BASE_URL` for the return URLs (success/cancel land on
`/patients/{userId}/new-appointment/success?appointmentId=...&deposit=success|cancelled`).
The mock provider returns a same-origin relative URL so the portal (https or
relative only) can follow it.

Concurrency: each attempt has a deterministic payments document id and Stripe
gets an `Idempotency-Key`, so a double click yields one Stripe session. Razorpay
has no idempotency key: a true race can create two payment links.

## Webhook (`POST /api/webhooks/payments`)

Verifies the signature on the **raw body** (`await req.text()`); any failure
(including a disabled provider) is a bare `400 {"error":"Bad request"}`.
Verified events are applied idempotently on the provider event id (last 20 ids
kept in `payments.eventIds`): payment marked `paid`, appointment `depositStatus`
mirrored, "deposit received" sent once, audit `payment.paid`. The amount and
currency must equal what was requested, otherwise the payment is **not** marked
paid and an `amount_mismatch` audit error is written. Unknown sessions get 200
(nothing to retry). A processing failure returns 500 so the provider retries;
retries are safe.

| Provider | Endpoint config | Signature | Events used |
|---|---|---|---|
| Stripe | Dashboard > Webhooks > `https://HOST/api/webhooks/payments` | `Stripe-Signature` `t=,v1=` HMAC-SHA256 of `t.body`, 300s tolerance | `checkout.session.completed` (paid), `.async_payment_succeeded`, `.async_payment_failed`, `.expired` |
| Razorpay | Settings > Webhooks, same URL | `X-Razorpay-Signature` HMAC-SHA256 of body; id from `X-Razorpay-Event-Id` | `payment_link.paid`, `.expired`, `.cancelled` |
| mock | n/a | `x-mock-signature` HMAC of body with `PAYMENTS_MOCK_SECRET` (default `mock-secret`) | body `{id,type,providerSessionId,amountMinor,currency}` |

The mock provider is refused when `NODE_ENV=production`.

## Environment variables

| Var | Default | Purpose |
|---|---|---|
| `PAYMENTS_PROVIDER` | `none` | `none`, `stripe`, `razorpay`, `mock` |
| `DEPOSIT_AMOUNT_MINOR` | `0` | Smallest unit (2500 = 25.00); 0 = no deposit |
| `DEPOSIT_CURRENCY` | `USD` | ISO 4217 |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | none | Stripe |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | none | Razorpay |
| `PAYMENTS_MOCK_SECRET` | `mock-secret` | Mock webhook HMAC key (dev only) |
| `DEPOSIT_REFUND_HOURS` | `24` | Refund-policy window (hook only) |
| `APP_BASE_URL` | see notifications doc | Checkout return URLs |

## Data

`scripts/schema/payments.json` (collection id `payments`, no client
permissions): `appointmentId, userId, provider, providerSessionId,
providerPaymentId, amountMinor, currency, status (pending|paid|failed|expired|refunded),
checkoutUrl, eventIds[], createdAt, expiresAt, paidAt`; indexes on
`appointmentId+createdAt` and `providerSessionId`. `appointments.depositStatus`
(pending|paid|failed|expired|refunded|waived) is added by `appointments.json`;
the payments collection is the source of truth (a missing attribute is logged,
not fatal). `checkoutUrl` is a bearer link to pay; it is only returned to the
owner.

## Setup

1. Run `node --env-file=.env scripts/appwrite-setup.mjs`.
2. Create provider keys and the webhook endpoint (above); set env vars.
3. Set `APP_BASE_URL`, `PAYMENTS_PROVIDER`, `DEPOSIT_AMOUNT_MINOR`.
4. Try `PAYMENTS_PROVIDER=mock` locally first: book, follow the returned URL,
   then POST a signed mock event to the webhook.

## Refunds

`refundDeposit(appointmentId)` (`lib/payments/refund.ts`) is a stub returning
`not_implemented`; **no automatic refund ever happens**. Policy hook:
`isDepositRefundEligible({ appointmentStart, cancelledAt, hoursBefore })`
(default: cancel at least `DEPOSIT_REFUND_HOURS`=24h before). Every cancellation
path calls `onAppointmentCancelled`, which, for a paid deposit, writes a
`payment.refund_review` audit entry (`eligible` / `ineligible`) so staff can
refund in the provider dashboard.

## Not verified

No live Stripe, Razorpay or Appwrite call was made; request shapes follow the
providers' public docs and are covered by mocked-fetch tests and locally
generated HMAC vectors only. Not covered: partial payments, refunds, disputes,
multi-currency, tax/receipts, delayed-method edge cases beyond the mapped
events, Razorpay duplicate links under a true race, reconciliation reports.
Confirm provider contracts, fees and data-processing terms with counsel.
