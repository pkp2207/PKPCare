# Notifications, reminders and signed links

Phase 2 (N1). Everything is additive: with no new env vars set, the app sends
the same SMS messages through the same Appwrite call as before (confirmed,
cancelled, rescheduled), plus nothing new.

## Layout

| Piece | File |
|---|---|
| Channel types, provider interface | `lib/notifications/types.ts` |
| Templates (en, locale-keyed, English fallback) | `lib/notifications/templates.ts` |
| Channel selection + fallback delivery | `lib/notifications/notifier.ts` |
| Adapters | `sms.ts`, `email.ts` (Appwrite Messaging), `whatsapp.ts` (Meta Cloud API, fetch) |
| High-level `notifyAppointment(event, appointment, opts)` (never throws, time-bounded) | `lib/notifications/events.ts` |
| Signed links | `lib/notifications/links.ts`, page `app/a/[token]/page.tsx`, `components/notify/*` |
| Link actions (`confirmAttendance`, `cancelViaLink`) | `lib/actions/notification.actions.ts` |
| Token-authority cancel helper | `lib/scheduling/cancel.ts` |
| Reminder sweep | `lib/notifications/reminders.ts`, cron `app/api/cron/reminders/route.ts` |
| Waitlist offers | `onWaitlistOffer` in `lib/scheduling/hooks.ts`, `expireStaleWaitlistOffers` in `lib/scheduling/offers.ts` |

## Channels

`type Channel = "sms" | "email" | "whatsapp"`. Provider interface:
`send({ channel, to: { userId, phone?, email? }, template, data, idempotencyKey? }) -> { ok, providerId?, error? }`.

- **SMS / email** go through Appwrite Messaging (`createSms` / `createEmail`)
  addressed to the Appwrite **user id**, so no phone/email is read by the app.
- **WhatsApp** uses the Meta Cloud API with **template messages**; it is
  enabled only when `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` are both set
  and needs the patient's phone (read from the patient document).
- **Selection**: the patient document's optional `notifyChannels` attribute
  (string array or comma list, e.g. `email,sms`) wins; else `NOTIFY_CHANNELS`
  (ordered, default `sms`). WhatsApp is dropped when not configured. Mode
  `NOTIFY_CHANNELS_MODE=fallback` (default) stops at the first channel that
  succeeds; `all` sends on every channel. `notifyChannels` is not in any schema
  file (patients has none here): add a string attribute (size 100) if wanted.
- **Idempotency**: when a caller passes `idempotencyKey` (reminders, waitlist
  offers, deposit received) SMS/email use a deterministic Appwrite message id, so
  a repeat is rejected with 409 and treated as success. Action-triggered
  messages (confirm/cancel/reschedule) carry no key and use random ids like the
  old helper. WhatsApp has no such dedupe (relies on the reminder flags).

### Templates

`booking_received, confirmed, cancelled, rescheduled, reminder_24h, reminder_1h,
waitlist_offer, deposit_received`. Text contains doctor name, time, amount and
link only: no reason, note, diagnosis or patient name (the data type cannot
carry them). Times render in the doctor's timezone when known. Add a language by
adding a key to `TEMPLATES`.

**Behaviour changes vs the old SMS helper**: staff cancellations no longer append
the free-text cancellation reason (it can contain clinical detail); times are
shown in the doctor's timezone (with abbreviation) when a doctors document
exists; a `Manage:` link is appended when links are configured.
"Booking received" is new and **off** unless `NOTIFY_BOOKING_RECEIVED=true`.
Cancellation messages carry no link (nothing left to act on).

### WhatsApp template names

Create and get approved (category Utility, language `en`, or set
`WHATSAPP_TEMPLATE_LANG`) in Meta Business Manager. Name =
`${WHATSAPP_TEMPLATE_PREFIX:-pkpcare_}` + id. Body parameters in order:

| template | {{1}} | {{2}} | {{3}} | {{4}} |
|---|---|---|---|---|
| `pkpcare_booking_received`, `_confirmed`, `_rescheduled`, `_reminder_24h` | doctor | date/time | link (or `-`) | |
| `pkpcare_reminder_1h` | doctor | time | link | |
| `pkpcare_waitlist_offer` | doctor | date/time | link | minutes |
| `pkpcare_cancelled` | date/time | | | |
| `pkpcare_deposit_received` | amount | date/time | link | |

## Signed links (`/a/<token>`)

Token = `base64url(payload).base64url(HMAC-SHA256)` over
`"notification-link:v1." + payload`, key `NOTIFICATION_LINK_SECRET` (falls back
to `ADMIN_SESSION_SECRET`; the context prefix stops it validating as a session
and vice versa). Payload: appointment id (waitlist entry id for offers), user
id, purposes, expiry. Verification is constant-time; wrong purpose, tampering,
expiry and missing secret all fail.

- Appointment links grant `confirm`, `cancel`, `reschedule` and expire at the
  **appointment start** (max 30 days). Waitlist links grant `waitlist` and expire
  with the claim window (`WAITLIST_OFFER_MINUTES`, default 30, or the slot time).
- Page shows doctor, time, status and visit type only. Confirm records
  `confirmedByPatientAt` (second tap is a no-op); Cancel asks for a reason and
  uses `cancelAppointmentByAuthority` (same checks as `cancelMyAppointment`
  without a session; the token is the authority), releases the slot, offers it
  to the waitlist, notifies, and audits. Reschedule links to
  `/patients/{userId}?reschedule={id}` (the portal; sign-in applies when
  `PATIENT_AUTH_ENFORCED`). The path lives in `portalReschedulePath` so the
  portal owner can repoint it.
- Audit actions: `appointment.confirm_link`, `appointment.cancel_link`
  (`actorRole: patient_link`; invalid tokens are `denied`).
- Links are bearer credentials: anyone who has the SMS can use them until expiry.
  `referrer: no-referrer`, `noindex`, and no caching on the page.

## Reminders cron

`GET|POST /api/cron/reminders` with `Authorization: Bearer $CRON_SECRET` (401 if
unset or wrong, constant-time compare). `?dryRun=1` reports what is due and
sends/writes nothing. Each run:

1. For `scheduled` appointments within +/- `REMINDER_CRON_INTERVAL_MINUTES`
   (default 10) of 24h and 1h ahead, sends `reminder_24h` / `reminder_1h` and
   sets `reminder24hSentAt` / `reminder1hSentAt` **only after a successful
   send**. Bounded by `REMINDER_BATCH_SIZE` (default 100, max 200) per window;
   per-item failures are isolated and counted. Appointments created inside a
   window's lead time are simply not reminded for that window.
2. `expireStaleWaitlistOffers`: `offered` entries older than the claim window
   (or past the slot) become `expired`; if the time is still free the next
   waiting entry is offered it.

Response: `{ ok, reminders: { windows: { reminder_24h: {found,due,sent,failed}, reminder_1h }, skippedNoSchema }, waitlistOffers: { found, expired, reoffered, errors } }`.
Appointments whose collection lacks the flag attributes are skipped (run the
setup script). Overlapping runs can double-send in a narrow race; email/SMS are
protected by deterministic message ids.

Schedule every 10 minutes (match `REMINDER_CRON_INTERVAL_MINUTES`), e.g.:

- Vercel Cron (`vercel.json`): `{"crons":[{"path":"/api/cron/reminders","schedule":"*/10 * * * *"}]}` and set `CRON_SECRET` (Vercel sends it as the bearer token).
- GitHub Actions: a `schedule: "*/10 * * * *"` job running `curl -fsS -H "Authorization: Bearer $CRON_SECRET" "$APP_BASE_URL/api/cron/reminders"`.
- Appwrite Function with a cron schedule doing the same request.

## Environment variables

| Var | Default | Purpose |
|---|---|---|
| `NOTIFY_CHANNELS` | `sms` | Ordered channel list |
| `NOTIFY_CHANNELS_MODE` | `fallback` | `fallback` or `all` |
| `NOTIFY_BOOKING_RECEIVED` | off | `true` sends "booking received" on create |
| `NOTIFY_TIMEOUT_MS` | 8000 | Per-notification time budget |
| `NOTIFICATION_LINK_SECRET` | `ADMIN_SESSION_SECRET` | Link HMAC secret (set a dedicated one) |
| `APP_BASE_URL` | `NEXT_PUBLIC_APP_URL`, then `https://$VERCEL_URL` | Links are omitted when unset |
| `CRON_SECRET` | none | Bearer secret for the cron routes |
| `REMINDER_CRON_INTERVAL_MINUTES` | 10 | Window tolerance |
| `REMINDER_BATCH_SIZE` | 100 | Per window per run |
| `WAITLIST_OFFER_MINUTES` | 30 | Offer claim window |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | none | Enable WhatsApp |
| `WHATSAPP_API_VERSION`, `WHATSAPP_TEMPLATE_PREFIX`, `WHATSAPP_TEMPLATE_LANG` | `v20.0`, `pkpcare_`, `en` | WhatsApp tuning |

## Appwrite prerequisites

- Messaging enabled with an **SMS provider** (Twilio, MSG91, Vonage, ...) and/or
  an **email provider** (SMTP, Mailgun, SendGrid), each enabled in the console.
- The API key needs `messages.write` (and `users.read`).
- Each user needs an SMS target (phone) / email target. Users created with
  phone/email get them automatically.
- Run `node --env-file=.env scripts/appwrite-setup.mjs` to add
  `reminder24hSentAt`, `reminder1hSentAt`, `confirmedByPatientAt`,
  `depositStatus` to appointments and the `idx_status_offered` index on
  `waitlist` (`scripts/schema/waitlist_offers.json`).

## Privacy and logging

Message bodies, phone numbers and emails are never logged; failures log channel,
template and a short error code via `safeLogLine`. Provider error bodies are not
propagated. Still, message text (doctor name + time) transits SMS/email/WhatsApp
providers: confirm BAAs/DPAs and consent wording with counsel. Audit entries for
sends are limited to cron run summaries and link actions.

## Not verified

No live Appwrite Messaging, Meta WhatsApp or SMS delivery was exercised; adapters
are typed against `node-appwrite` v12 and the Cloud API docs and tested with
mocks. Delivery failures reported asynchronously by Appwrite
(`deliveryErrors`) are not polled. WhatsApp templates require Meta approval.
Timezone names rely on the runtime's ICU data. Overlapping cron runs and
WhatsApp sends are not strictly exactly-once.
