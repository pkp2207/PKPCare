# Authentication and authorization

Two kinds of identity, both stored as Appwrite users and both proven by an
HMAC-signed, HttpOnly cookie that our server issues after an Appwrite check:

- **Staff** (`admin`, `frontdesk`, `doctor`): Appwrite user with a label equal to the role. Email + password, optional TOTP MFA.
- **Patients**: the Appwrite user whose `$id` is the `userId` used everywhere. Email one-time code (OTP).

Appwrite sessions are used only to verify credentials and are deleted right away; the app's own signed cookie is the session.

## Architecture

| Piece | File |
|---|---|
| Roles, `hasRole`, permission map | `lib/auth/roles.ts` |
| Signed tokens (Edge-safe), payload kinds, back-compat | `lib/auth/session.ts` |
| Feature flags (`ALLOW_LEGACY_ADMIN_PASSKEY`, `PATIENT_AUTH_ENFORCED`) | `lib/auth/config.ts` |
| Staff helpers: `getStaffSession`, `requireRole`, `requireAdmin`, `isAdminAuthenticated` | `lib/auth/admin.ts` |
| Patient helpers: `getPatientSession`, `requirePatient`, `assertPatientOrStaffOwns` | `lib/auth/patient.ts` |
| Route/role policy (Edge-safe) | `lib/auth/access.ts` |
| Page guard for layouts (`requireStaffPage`) | `lib/auth/guards.ts` |
| Open-redirect validator `safeNextPath` | `lib/auth/redirect.ts` |
| In-memory rate limiter | `lib/auth/rate-limit.ts` |
| Server actions | `lib/actions/auth.actions.ts` |
| Edge gate for `/admin/**` and `/patients/**` | `middleware.ts` |
| UI | `app/login/page.tsx`, `app/login/staff/page.tsx`, `components/auth/*` |
| Staff provisioning | `scripts/create-staff.mjs` |

### Contract for other code (server only)

```ts
// lib/auth/admin.ts
type StaffSession = { userId: string; email: string | null; name: string | null; role: Role };
getStaffSession(): Promise<StaffSession | null>;
requireRole(...roles: Role[]): Promise<StaffSession>; // throws AdminAuthError; no args = any staff role
requireAdmin(): Promise<void>;                         // any valid staff session (legacy passkey included)
isAdminAuthenticated(): Promise<boolean>;

// lib/auth/patient.ts
type PatientSession = { userId: string };
getPatientSession(): Promise<PatientSession | null>;
requirePatient(): Promise<PatientSession>;             // throws PatientAuthError
assertPatientOrStaffOwns(userId): Promise<{ actor: "patient" | "staff"; staff?: StaffSession }>;
isPatientAuthEnforced(): boolean;
```

`assertPatientOrStaffOwns` passes for any staff session, or a patient session whose `userId` matches. While `PATIENT_AUTH_ENFORCED !== "true"` it never throws (anonymous callers get `{ actor: "patient" }`), so existing patient pages keep working.

Server components/layouts should use `requireStaffPage(...roles)` (redirects). Server actions should use `requireRole(...roles)` (throws). Sub-routes with a narrower role list must be added to `ADMIN_ROUTE_ROLES` in `lib/auth/access.ts` (middleware) **and** call `requireRole` in the page/action.

### Permission map

| Role | Can |
|---|---|
| `admin` | Everything: staff and doctor management, audit viewing, appointments, patients |
| `frontdesk` | Manage appointments and patients |
| `doctor` | Own schedule and own appointments |

The role is baked into the token at login. Changing or removing a label in Appwrite takes effect at the next login (at most 8 hours; disabling the Appwrite user does not kill an existing staff cookie). Rotate `ADMIN_SESSION_SECRET` to invalidate everyone immediately.

## Cookies

| Cookie | Who | Payload | TTL | SameSite | Notes |
|---|---|---|---|---|---|
| `admin_session` | staff (and legacy passkey) | `{ exp, kind: "staff", sub, role, email, name }`; legacy: `{ exp }` only | 8 h | Strict | HttpOnly, Secure in production, path `/` |
| `patient_session` | patients | `{ exp, kind: "patient", sub }` | 24 h | **Lax** | HttpOnly, Secure in production, path `/` |
| `staff_mfa_pending` | staff mid-MFA | raw Appwrite session secret (not yet MFA-verified; grants nothing by itself) | 5 min | Strict | HttpOnly, Secure in production |

Why patients use Lax: patients arrive from confirmation emails/SMS links. Strict would drop the cookie on that cross-site top-level navigation and bounce them to login. Lax still withholds it from cross-site POSTs (server actions) and no GET route mutates state.

Token rules: a `patient` token is never a staff session and a `staff` token is never a patient session, even in the wrong cookie. Tokens without `kind` are legacy passkey tokens: accepted only as a staff `admin` session, and only while `ALLOW_LEGACY_ADMIN_PASSKEY` is not `false`. Staff tokens without a valid role are rejected.

## Flows

- **Patient**: `requestPatientOtp(email)` (always `{ ok: true }` for a well-formed email; unknown emails are ignored and no account is ever created) then `verifyPatientOtp(email, code)` sets `patient_session` and returns `{ ok: true, data: { userId } }`. `logoutPatient()`.
- **Staff**: `verifyStaffLogin(email, password)` returns `{ ok: true, data: { mfaRequired } }`. If `mfaRequired`, `verifyStaffMfa(code)` completes it. Users without a role label, or disabled, are rejected with the same generic error as a wrong password. `logoutStaff()` / `logoutAdmin()`.
- **Legacy**: `verifyAdminPasskey(passkey)` unchanged except it is gated by `ALLOW_LEGACY_ADMIN_PASSKEY`.
- Rate limits (per server instance, in memory): OTP request 10 per IP and 3 per email per 15 min; OTP verify 10 per IP and 5 failures per email; staff login 10 per IP and 5 failures per email; MFA 10 per IP and 5 failures per pending session (the Appwrite session is dropped when exceeded). Limits apply whether or not the account exists. Move to a shared store (Redis) for multi-instance deployments.
- Login error messages are generic; a failed lookup and a failed credential look identical. Known residual: response time may still differ slightly for unknown emails.

## Environment variables

| Var | Default | Purpose |
|---|---|---|
| `ADMIN_SESSION_SECRET` | none (required) | HMAC secret for all session cookies (staff and patient). Long random string. Missing means every session check fails closed |
| `ADMIN_PASSKEY` | none | Legacy shared passkey (6 characters in the modal) |
| `ALLOW_LEGACY_ADMIN_PASSKEY` | `true` | `false` disables the shared passkey login **and** invalidates existing legacy cookies |
| `PATIENT_AUTH_ENFORCED` | off | Exactly `true` turns on patient identity checks in middleware and `assertPatientOrStaffOwns` |
| `NEXT_PUBLIC_ENDPOINT`, `PROJECT_ID`, `API_KEY` | required | Appwrite (existing). The API key needs `users.read` / `users.write` |

## Creating the first staff user

```bash
node --env-file=.env scripts/create-staff.mjs --email you@example.com --name "Your Name" --role admin --dry-run
node --env-file=.env scripts/create-staff.mjs --email you@example.com --name "Your Name" --role admin
```

A strong random password is printed once (or pass `--password`, at least 12 characters). `--promote` sets the role label on an existing Appwrite user instead of failing. Then sign in at `/login/staff`.

## Rollout plan

1. Deploy with defaults (`ALLOW_LEGACY_ADMIN_PASSKEY=true`, `PATIENT_AUTH_ENFORCED` unset). Nothing changes for existing users.
2. Configure Appwrite (below), create at least one `admin` staff user, and verify `/login/staff` works end to end.
3. Create the remaining staff users. Set `ALLOW_LEGACY_ADMIN_PASSKEY=false`. Remove `ADMIN_PASSKEY`.
4. When the phase-2 UI (patient pages linking to `/login`) ships, set `PATIENT_AUTH_ENFORCED=true`.

While the legacy passkey is on, the staff login page shows a link to the `/?admin=true` passkey modal, and the modal links to staff login.

## Appwrite console prerequisites

- Project with **Email/Password** and **Email OTP (email token)** auth methods enabled.
- An **SMTP provider** configured (Settings > SMTP); otherwise OTP codes never arrive. `requestPatientOtp` deliberately still answers OK, so check server logs for `requestPatientOtp failed`.
- **MFA** enabled on the project if TOTP is wanted (Auth > Security). Consider lowering the project session length (abandoned MFA attempts leave an unused Appwrite session until it expires).
- Email OTP codes are 6 digits; the UI and server validate exactly 6 digits.
- Staff must have the role label (`admin`, `frontdesk` or `doctor`) in Users > Labels (the script does this).
- Patients must already exist as Appwrite users with that email (created by the registration form).

## Not done

- **Passkeys / WebAuthn**: deferred; Appwrite has no native support.
- **TOTP enrollment UI**: `verifyStaffMfa` works for staff whose Appwrite account already has `mfa` enabled and an authenticator enrolled, but there is no in-app enrollment or recovery-code flow yet (enroll via an Appwrite client session or add a page later). Users without MFA sign in with password only.
- Live Appwrite verification: the Appwrite calls (OTP, email-password session, MFA challenge, label lookups) are typed against `node-appwrite` v12 and unit-tested only at the session/role/middleware level; they have not been run against a real project.
- Shared (multi-instance) rate limiting, immediate role revocation, audit logging of login events (other workstreams).
