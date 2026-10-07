# PKPCare: guidance for Claude

Patient appointment and records app for clinics. Next.js 14 (App Router, server actions),
TypeScript, Appwrite (`node-appwrite` 12.0.1), zod, Tailwind + shadcn, Vitest. Personal
project (not Visa GHE). Read `README.md` for setup and `docs/*.md` for per-area detail
before changing an area.

## Commands

```bash
npm run dev            # dev server
npm run typecheck      # tsc --noEmit  (must be clean)
npm run lint           # next lint     (must be clean)
npm test               # unit tests, mocked, no network/.env
NEXT_DIST_DIR=.next-build npm run build   # verification build; needs NEXT_PUBLIC_ENDPOINT and NEXT_PUBLIC_BUCKET_ID set to anything
npm run test:live      # REAL Appwrite from .env; non-prod only; creates and deletes records
npm run test:e2e       # Playwright + axe; prod build in .next-e2e on :3100; needs the sandbox lifted (.env, browser, Appwrite)
node --env-file=.env scripts/appwrite-setup.mjs [--dry-run] [--seed-doctors]
node --env-file=.env scripts/check-patient-schema.mjs [--apply]
node --env-file=.env scripts/create-staff.mjs --email .. --name .. --role admin|frontdesk|doctor
```

Before calling work done: typecheck, lint, `npm test`, and for route or auth changes also
`npm run build` and check the route table (admin and auth pages must be `ƒ` dynamic).

## Architecture

- `app/` routes. `lib/actions/*.ts` are the only browser entry points (`"use server"`).
  `lib/appwrite/*.repository.ts` is data access only. Domain logic lives in `lib/scheduling`,
  `lib/compliance`, `lib/notifications`, `lib/payments`, `lib/fhir`, `lib/telehealth`, `lib/ai`.
- Two identities, both Appwrite users: **staff** (label = role: `admin|frontdesk|doctor`,
  cookie `admin_session`) and **patients** (`patient_session`). Our own HMAC cookie is the
  session; Appwrite sessions are discarded after verification (`lib/auth/`).
- Collections: `patients` and `appointments` are env-configured and pre-existing;
  `doctors`, `slots`, `waitlist`, `payments`, `consents`, `audit_logs`, `deletion_requests`
  have FIXED ids and are defined in `scripts/schema/*.json` (created by `appwrite-setup.mjs`).
- Booking atomicity: a slot is a document with a deterministic id (`doctorId_startEpochMs`,
  hashed if needed); a 409 means "just taken". Do not replace it with query-then-insert.

**Never run `next build` or `next start` into `.next` while the user may have `npm run dev`
running**: it overwrites the dev server's artifacts and the UI loses all CSS. Always use
`NEXT_DIST_DIR=.next-build` (and `npx next start` only with that dir), then delete `.next-build`.

## Conventions (follow these)

- Every action returns `ActionResult<T>` (`{ ok: true, data } | { ok: false, error }`), never
  throws to the client, and returns safe generic messages (log detail server-side).
- Re-validate all input with zod inside the action (schemas in `lib/validation.ts`). Never trust
  client-supplied `status`, ids or roles.
- Authorize in the action, not only in middleware or UI: `requireRole(...)` for staff,
  `assertPatientOrStaffOwns(userId)` for patient data. Server actions are public endpoints.
- A `"use server"` file must export only actions. Put helpers in non-action modules.
- Never log or audit PHI. `recordAudit` (never throws) accepts only allow-listed meta keys
  (`AUDIT_META_ALLOWED_KEYS` in `lib/compliance/audit.ts`); add keys there if needed.
- Sensitive patient fields (`SENSITIVE_PATIENT_FIELDS`) are encrypted on write and decrypted
  on read via `lib/compliance/crypto`. Encrypted fields cannot be searched.
- Code that gates a page on cookies must read `cookies()` BEFORE any early return (a missing
  env var otherwise lets the build prerender the page as static). Admin layout is `force-dynamic`.
- Optional modules are OFF by default and must stay failing closed (FHIR, telehealth, AI,
  payments, WhatsApp). AI must never gate the red-flag safety rules.
- Style: 2-space indent, double quotes, semicolons; keep ESLint `import/order` clean.
- Add or update a unit test with each behaviour change; new modules get a `docs/` entry.

## Gotchas

- `.env*` is unreadable in the Claude sandbox, so scripts that need it (setup, live tests,
  create-staff) must run with the sandbox lifted, only after the user agrees it is a
  non-production project. Never print, copy or commit env values.
- `node-appwrite` 12.0.1 cannot resize string attributes: use the REST call in
  `scripts/check-patient-schema.mjs`. Appwrite rejects collections whose row width exceeds
  ~64 KB (varchar counts 4 bytes per char up to 16381 chars, longer strings go off-row). This
  broke `doctors.timeOff` once; check width when adding string attributes.
- Appwrite Cloud free projects pause after inactivity ("Project is paused due to
  inactivity"); restore in the console.
- `NODE_TLS_REJECT_UNAUTHORIZED=0` may be set in the user's shell; it disables TLS verification
  for API-key traffic. Mention it rather than relying on it.
- `next build` fetches Google Fonts and reports to Sentry; both fail silently or loudly in a
  network-restricted sandbox (allow `fonts.googleapis.com`, `fonts.gstatic.com`).
- Rate limiters are in memory per instance. Role changes apply at the next login (role is in
  the 8h staff token).
- `PATIENT_AUTH_ENFORCED` is off by default: patient ownership checks are no-ops until it is
  `"true"`. `ALLOW_LEGACY_ADMIN_PASSKEY` keeps the old shared passkey working until `"false"`.

## Git and commits

- Personal repo: do NOT add `GENAI=` tags or `Co-Authored-By: Claude` lines to commit messages.
  Use short conventional commit messages (`feat:`, `fix:`, `chore:`, `test:`).
- Do not commit or push unless asked. Never commit `.env`; `.env.example` holds placeholders
  only and must list every variable the code reads.
- Work on a feature branch, not `main`.

## Not done yet

Manual keyboard/screen-reader accessibility pass, CSP, PWA/web push, i18n, Dockerfile, passkeys
(WebAuthn), TOTP enrollment UI, password-change page, real-time admin updates (30s polling now),
consent re-grant action, JaaS/JWT Jitsi provider, ABDM/payer integrations (interfaces only),
Next 15/16 upgrade.
