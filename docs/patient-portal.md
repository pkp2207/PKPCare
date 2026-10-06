# Patient portal

Patient-facing UI (phase 2, agent U1). Works in two modes selected by the
server-side flag `PATIENT_AUTH_ENFORCED` (see `docs/auth.md`). Pages read it with
`isPatientAuthEnforced()` and pass it to client components as a prop; the pages
are `force-dynamic` so the flag is read per request, not baked in at build.

## Routes

| Route | Purpose |
|---|---|
| `/` | Start: name, email, phone. Enforced mode adds the emailed-code step and a "Sign in" link |
| `/login` | Email one-time code sign-in. Honours a safe `?next=` (validated by `safeNextPath`), default is the dashboard |
| `/patients/[userId]` | Dashboard: upcoming and past appointments, waitlist, privacy link |
| `/patients/[userId]/register` | 5-step registration wizard. Registered patients are redirected to the dashboard |
| `/patients/[userId]/new-appointment` | Booking. `?doctor=<id>` pre-selects a doctor (used by waitlist offers) |
| `/patients/[userId]/new-appointment/success?appointmentId=` | Confirmation |
| `/patients/[userId]/privacy` | Consents (withdraw), download my data, request deletion |
| `/privacy` | Public policy summary (placeholder text, flagged for counsel) |

## Flows

### Flag off (default): anonymous flow, no email provider needed

`PatientForm` -> `createUser` -> `/patients/[id]/register` -> `registerPatient`
-> `/patients/[id]/new-appointment`. The userId in the URL is the only
credential, exactly as before. A duplicate email returns the existing user (old
behaviour, kept so returning patients can continue). There is no sign-out
(a plain "Exit" link is shown).

### Flag on: email-code login

`PatientForm` -> `startPatientRegistration` (`lib/actions/onboarding.actions.ts`)
-> `OtpVerifyStep` -> `verifyPatientOtp` (sets the `patient_session` cookie and
returns the id) -> `getPatient` -> dashboard if registered, else `/register`.

- `startPatientRegistration` creates the Appwrite user if missing (an existing
  user is never modified), discards the id, then calls `requestPatientOtp`. The
  answer is the same for new and existing emails and for internal failures (they
  are logged, not surfaced), so it cannot be used to discover who has an account.
  It adds its own 10-per-15-minutes-per-IP limiter on top of the OTP limits.
- `createUser` (still a public server action) no longer returns an existing
  user's id for a duplicate email when enforced: it answers with a generic
  "please sign in" error (IDOR fix). A time-based backstop also rejects a user
  whose `$createdAt` is older than 60 s in case of a create/check race.
- Returning patients use `/login`. The resend button has a 30 s cooldown.
- Sign-out (`logoutPatient`) is in the portal header and also clears any
  registration draft.
- Middleware (`/patients/**`) redirects anonymous visitors to `/login?next=...`.

## Booking

`BookingForm` (`components/portal/`), also what `AppointmentForm type="create"`
renders (the `AppointmentForm` props are unchanged; `schedule`/`cancel` for the
admin modal keep the old form).

- Doctors from `listDoctors()` (name + specialty). Default is the patient's
  primary physician.
- `SlotPicker`: `getAvailability` over 14-day windows, the first on load, later
  windows on "Show later dates" (up to the 90-day horizon). Day buttons plus a
  time grid, both `role="radiogroup"` with roving tabindex and arrow/Home/End.
  Times are formatted in the **doctor's** timezone with a visible label
  (`Asia/Kolkata (GMT+5:30)`); the patient's local time is added when it differs.
- Visit type toggle (in person / video) -> `visitType`.
- "Slot just taken" (server message) clears the choice, refetches, and shows a
  polite-live message.
- No times: "Join waitlist" (`joinWaitlist`, window 2 weeks / 30 / 60 days).
- Legacy doctors (static fallback list, `legacy: true`): the old free
  date-time picker and `primaryPhysician` + `schedule` call.
- `SymptomRouter` (A1) sits under the reason field.
- Deposit (N1): `getPaymentConfig` shows a notice; after creation
  `getDepositCheckout(appointmentId, userId)` decides between the success page
  and `window.location.assign(url)`. Only `https://` (or same-origin relative)
  urls are followed; any failure means "no deposit" (routing in
  `components/portal/payment.ts`).

## Dashboard

Upcoming (soonest first) and past/cancelled, status badge per appointment
(`StatusBadge`). Per upcoming appointment: **Reschedule** (slot picker in a
dialog, current time stays booked until confirmed), **Cancel** (reason +
explicit confirmation), **Join video visit** for video appointments
(`getVisitLink`, called on click; "opens at" and not-ok results are explained).
Waitlist entries with Leave and, for offered entries, "Book it".

## Registration wizard

Personal -> Medical -> Insurance & ID -> Consent -> Review. Per-step validation
uses the same zod schema as the server (`validateStep`, plus "date of birth must
be in the past" because the picker opens on today). Errors appear per field and
in a focusable summary. Progress list uses `aria-current="step"`; the step
heading receives focus on each change. `identificationDocument` is still sent as
`FormData` (`blobFile`, `fileName`). `IdPrefill` (A1) suggestions pass through
`applyIdPrefill`, which drops invalid values.

### Draft autosave (sessionStorage) - why

`components/portal/draft.ts`. A draft survives refresh / accidental navigation,
but web storage is readable by any script on the origin, so:

- **sessionStorage only** (per tab, gone when the tab closes); never localStorage.
- **Allow-list only** (name, email, phone, gender, address, occupation, emergency
  contact, primary physician, insurance provider, ID type). Never stored: ID
  document, ID number, policy number, date of birth, allergies / medications /
  medical history, consent ticks. Re-sanitised on read, keyed to the userId,
  expires after 2 h, cleared on success and on sign-out.

### Consents

Three separate, unticked, plain-language consents (`consent-copy.ts`) with a link
to `/privacy`. The server still requires all three (`registerPatient`).
**All consent and policy wording is draft text for counsel to review**; bump
`CURRENT_POLICY_VERSION` (`lib/compliance/consent.ts`) when it changes.

## Privacy page

`getMyConsents`; **Withdraw** per consent (confirm dialog explaining the
consequence); **Download my data** (`exportMyData`, JSON built in the browser,
nothing stored); **Request account deletion** (`requestAccountDeletion`, reason +
confirm; nothing is deleted until an admin resolves it). There is no "grant
again" action in the backend, so the page tells patients to contact the clinic.

## Accessibility notes

Skip link and `<main id="main">`; every field has a label; autocomplete tokens on
identity fields; dialogs are Radix (focus trap, Escape, focus return); after
cancel/reschedule focus moves to a status message; errors use `role="alert"` /
`aria-live`; slot grids are radio groups; targets are at least 44 px; animations
respect `prefers-reduced-motion`; visible focus is drawn on wrappers because
`globals.css` disables the native ring on inputs (`focus-visible:ring-0
!important`). Contrast: the brand primary button (white on `#24AE7C`, about 2.8:1)
and danger button (white on `#F24E43`, about 3.5:1) fail AA for normal text, so
portal buttons use the dark palette colour for text (`components/portal/styles.ts`);
admin screens still use `.shad-primary-btn`. Not verified in a browser or with a
screen reader.

## Rollout: turning on `PATIENT_AUTH_ENFORCED=true`

1. Appwrite console: enable **Email OTP**, configure an **SMTP provider**
   (`docs/auth.md`). Without SMTP no code is ever delivered and patients are
   locked out (the UI deliberately cannot tell).
2. Staging first with the flag on. Test: new patient end to end (`/` -> code ->
   register -> book); existing patient via `/login`; `?next=` deep link from a
   reminder; wrong / expired code; resend; sign-out; opening another patient's
   URL (middleware redirects to your own); staff can still open any patient.
3. Watch server logs for `requestPatientOtp failed` / `startPatientRegistration`.
4. Check existing patients have an email on their Appwrite user that they can
   read; patients whose email was never real cannot log in and need staff help.
5. Set `PATIENT_AUTH_ENFORCED=true` in production and redeploy. Rollback = unset.

## Known limits

- Not run in a browser; no live Appwrite or email provider (unit tests cover
  the pure logic and the onboarding/`createUser` actions with mocks).
- OTP and onboarding rate limits are in memory per instance (`docs/auth.md`).
- Flag off: anyone who knows a userId can act as that patient (unchanged), and
  `createUser` returns an existing user for a known email.
- No "grant consent again" or deletion-status view for patients.
- Waitlist offers only appear on the dashboard; sending them depends on the
  notification work.
- Times for legacy (static-list) doctors are in the patient's browser zone.
- Review step shows medical text on screen (masks ID and policy numbers only).
- Component-level behaviour (focus, dialogs, keyboard) is untested by automation.
