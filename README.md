# PKPCare


<div align="center">
  <img src = "https://github.com/pkp2207/PKPCare/assets/58586336/4b8f9132-909f-4973-a3f3-522fd2b5ac7c">
  <h3 align="center">A HealthCare Management System</h3>
</div>

## 📋 <a name="table">Table of Contents</a>

1. 🤖 [Introduction](#introduction)
2. ⚙️ [Tech Stack](#tech-stack)
3. 🔋 [Features](#features)
4. 🗂️ [Project Layout](#layout)
5. 🤸 [Quick Start](#quick-start)
6. 🚀 [Go-Live Checklist](#go-live)
7. 📜 [Scripts](#scripts)
8. 🧪 [Testing](#testing)
9. 🔒 [Security Notes](#security)
10. 📚 [Documentation](#docs)

## <a name="introduction">🤖 Introduction</a>

A patient management application for clinics. Patients register, book, reschedule and cancel
appointments against real doctor availability; staff manage schedules, patients and
privacy requests from a role-aware admin console. Sensitive patient data is encrypted at
rest, access is audited, and consent, data export and erasure are built in.

Optional modules (all off until configured): SMS/email/WhatsApp reminders, booking
deposits, video visits, a read-only FHIR R4 API, and opt-in AI assistance.

> **Status:** the patient journey is covered by a live Appwrite integration test and by
> Playwright browser tests with automated accessibility checks. Several modules (email/OTP login, messaging, payments,
> FHIR, telehealth, AI) have only been tested with mocks. See
> [Go-Live Checklist](#go-live).

## <a name="tech-stack">⚙️ Tech Stack</a>

- Next.js 14 (App Router, server actions), React 18, TypeScript
- Appwrite (database, users, storage, messaging) via `node-appwrite`
- TailwindCSS, shadcn/ui (Radix), react-hook-form, zod
- Vitest for tests; Sentry for monitoring
- No payment, chat or AI SDKs: providers are called over `fetch`

## <a name="features">🔋 Features</a>

**Patients**
- Email one-time-code login (when `PATIENT_AUTH_ENFORCED=true`), five-step registration with ID upload
- Book from live availability per doctor, timezone-aware; join a waitlist when full
- Dashboard: reschedule, cancel, video visit link; privacy page with consent withdrawal,
  data export and account deletion request
- Confirm or cancel from a signed link in a reminder message

**Staff** (roles: `admin`, `frontdesk`, `doctor`)
- Per-staff accounts with optional TOTP MFA; doctors see only their own appointments
- Appointment search, filters, bulk confirm/cancel, CSV export
- Manage doctors (weekly hours, time off), staff, privacy/deletion requests, audit log
- Analytics: cancellation rate, lead time, utilization, peak hours

**Platform**
- Atomic booking: a slot is a document with a deterministic id, so two people cannot take
  the same time
- Field-level encryption (AES-256-GCM) for sensitive patient fields, with key rotation
- Append-only consent history, non-PHI audit log, retention cron, data export/erasure
- Optional: reminders (24h, 1h), deposits (Stripe/Razorpay hosted checkout), telehealth
  (Jitsi), FHIR R4 read API, AI symptom routing / ID prefill / pre-visit summary

## <a name="layout">🗂️ Project Layout</a>

| Path | What lives there |
| --- | --- |
| `app/` | Routes: patient portal (`patients/`, `login/`), admin console (`admin/`), signed-link pages (`a/`, `visit/`), API routes (`api/cron`, `api/fhir`, `api/webhooks`) |
| `components/` | UI: `portal/`, `admin/`, `auth/`, `forms/`, `ai/`, `notify/`, `telehealth/`, `ui/` (shadcn) |
| `lib/actions/` | Server actions (`"use server"`), the only entry points from the browser |
| `lib/appwrite/` | Data access (repositories) and the lazy Appwrite client |
| `lib/auth/` | Sessions, roles, guards |
| `lib/scheduling/` | Availability math, atomic booking, cancel/reschedule, waitlist |
| `lib/compliance/` | Encryption, consent, audit, retention, redaction |
| `lib/notifications/`, `lib/payments/` | Messaging channels, signed links, reminders; deposit providers |
| `lib/fhir/`, `lib/telehealth/`, `lib/interop/`, `lib/ai/` | Optional modules |
| `scripts/` | `appwrite-setup.mjs`, `create-staff.mjs`, `check-patient-schema.mjs`, `schema/*.json` |
| `tests/` | Unit tests; `tests/live/` holds the Appwrite integration suite |
| `docs/` | One document per area (see [Documentation](#docs)) |

## <a name="quick-start">🤸 Quick Start</a>

**Prerequisites:** [Git](https://git-scm.com/), [Node.js](https://nodejs.org/en) 20+, npm, and an
[Appwrite](https://appwrite.io/) project (Cloud or self-hosted) with a database, a
`patients` collection, an `appointments` collection and a storage bucket.

```bash
git clone https://github.com/pkp2207/PKPCare.git
cd PKPCare
npm install
cp .env.example .env     # then fill it in
```

`.env.example` lists every variable with comments. The ones you need first:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_ENDPOINT`, `PROJECT_ID`, `API_KEY`, `DATABASE_ID`, `PATIENT_COLLECTION_ID`, `APPOINTMENT_COLLECTION_ID`, `NEXT_PUBLIC_BUCKET_ID` | Appwrite connection (the API key stays server-side) |
| `ADMIN_SESSION_SECRET` | Signs session cookies. `openssl rand -base64 48` |
| `FIELD_ENCRYPTION_KEY` | Encrypts sensitive patient fields. `openssl rand -base64 32`. Back it up |
| `CRON_SECRET` | Bearer secret for the reminder and retention cron routes |
| `APP_BASE_URL` | Public URL used in message links |

**Create the Appwrite collections, attributes and indexes** (idempotent; try `--dry-run` first):

```bash
node --env-file=.env scripts/appwrite-setup.mjs --dry-run
node --env-file=.env scripts/appwrite-setup.mjs --seed-doctors
```

**Raise the encrypted-field sizes in `patients`** (read-only report; add `--apply` to change):

```bash
node --env-file=.env scripts/check-patient-schema.mjs
```

**Create your first staff account** (prints a one-time password):

```bash
node --env-file=.env scripts/create-staff.mjs --email you@example.com --name "Your Name" --role admin
```

Then set `ALLOW_LEGACY_ADMIN_PASSKEY=false`, run `npm run dev`, open
[http://localhost:3000](http://localhost:3000) for patients and
[http://localhost:3000/login/staff](http://localhost:3000/login/staff) for staff.

## <a name="go-live">🚀 Go-Live Checklist</a>

1. Run the setup script and the patient schema check against the production project.
2. Set `ADMIN_SESSION_SECRET`, `FIELD_ENCRYPTION_KEY`, `CRON_SECRET`, `APP_BASE_URL`.
3. Create staff accounts; set `ALLOW_LEGACY_ADMIN_PASSKEY=false`; remove any old
   `NEXT_PUBLIC_ADMIN_PASSKEY`.
4. Configure an Appwrite email provider, test patient OTP login in staging, then set
   `PATIENT_AUTH_ENFORCED=true`.
5. Schedule `GET`/`POST /api/cron/reminders` (about every 10 minutes) and
   `/api/cron/retention` (daily) with `Authorization: Bearer $CRON_SECRET`.
6. Have counsel set the retention periods (`lib/compliance/retention.ts`) and review the
   privacy page text.
7. Before enabling optional modules read their docs: self-host Jitsi (not public
   `meet.jit.si`) for telehealth, sign a BAA/DPA before AI with real patient data, and treat
   FHIR tokens as highly privileged.
8. Run `npm run test:live` against staging, then click through the critical flows in a browser.

## <a name="scripts">📜 Scripts</a>

| Command | Description |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` / `npm start` | Production build / serve it |
| `npm run lint` | ESLint (`next lint`) |
| `npm run typecheck` | TypeScript check (`tsc --noEmit`) |
| `npm test` | Unit tests once (Vitest). No network, no `.env` |
| `npm run test:watch` | Unit tests in watch mode |
| `npm run test:live` | Live Appwrite integration suite. Needs `.env`; **non-production projects only** |
| `npm run test:e2e` | Playwright browser tests (public pages, admin console, full patient journey, axe accessibility). Builds the app into `.next-e2e` on port 3100; needs `.env`; **non-production projects only** |

## <a name="testing">🧪 Testing</a>

- **Unit tests** (`tests/`, ~850 tests) mock Appwrite and run anywhere: `npm test`.
- **Live tests** (`tests/live/`) register a test patient, book, double-book, reschedule, cancel,
  export and erase against the Appwrite project in `.env`, then clean up. They stub
  notifications so nothing is sent: `npm run test:live`.
- **CI** (`.github/workflows/ci.yml`) runs lint, typecheck, tests and build on pushes and
  pull requests to `main`, using dummy env values.
- **Browser E2E** (`tests/e2e/`, Playwright + axe) run a production build on port 3100 (output in
  `.next-e2e`, so a running `npm run dev` is unaffected) with notifications disabled. They check
  that pages are actually styled, walk a test patient through registration, booking, reschedule
  and cancel, exercise the admin console with role restrictions, and fail on serious or critical
  WCAG 2.x A/AA violations. The test patient and its records are deleted afterwards. First run:
  `npx playwright install chromium`.
- Automated accessibility scans catch only part of the problems; keyboard-only and screen-reader
  checks are still manual. E2E and live tests are not run in CI (they need Appwrite credentials).

## <a name="security">🔒 Security Notes</a>

- Sessions are HMAC-signed, `HttpOnly` cookies issued by the server after an Appwrite
  credential check. Staff and patient cookies are separate and not interchangeable.
- Every server action re-validates input with zod and checks the role
  (`requireRole`) or ownership (`assertPatientOrStaffOwns`). Patient ownership checks are
  only enforced when `PATIENT_AUTH_ENFORCED=true`; until then `userId` in the URL is the only
  identity, so do not run with real data in that mode.
- Sensitive patient fields are encrypted at rest; audit entries and logs never contain PHI.
- Never commit `.env`. If a key or secret has been exposed, rotate it (Appwrite `API_KEY`,
  `ADMIN_SESSION_SECRET` signs everyone out, `FIELD_ENCRYPTION_KEY` needs the documented
  rotation steps, provider keys).
- Rate limits are in memory and per server instance; use a shared store for multi-instance deploys.
- No Content-Security-Policy yet; baseline security headers are set in `next.config.mjs`.
- This is not legal advice or a compliance certification. HIPAA/DPDP obligations (BAAs/DPAs,
  breach process, retention, consent wording) need review by counsel.

## <a name="docs">📚 Documentation</a>

| Doc | Topic |
| --- | --- |
| [docs/auth.md](docs/auth.md) | Identities, roles, cookies, login flows, rollout flags |
| [docs/scheduling.md](docs/scheduling.md) | Data model, atomic booking, setup script, attribute sizes |
| [docs/compliance.md](docs/compliance.md) | Encryption, consent, audit, retention, data rights |
| [docs/patient-portal.md](docs/patient-portal.md) | Patient routes and flows |
| [docs/admin.md](docs/admin.md) | Admin routes, role matrix, actions |
| [docs/notifications.md](docs/notifications.md), [docs/payments.md](docs/payments.md) | Messaging, reminders, deposits |
| [docs/interop.md](docs/interop.md), [docs/telehealth.md](docs/telehealth.md) | FHIR API, video visits |
| [docs/ai.md](docs/ai.md) | AI features, safety design, evaluation plan |
