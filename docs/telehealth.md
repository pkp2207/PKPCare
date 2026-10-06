# Telehealth (video visits)

Video visits for appointments whose `visitType` is `video`. No vendor account
and no schema change are needed: the meeting room is derived from the
appointment, and patients and clinic staff reach it through a signed,
time-limited app link.

> **Do not use public `meet.jit.si` with real patient data.** Public Jitsi
> rooms have no access control: anyone who learns or guesses a room name can
> join, and there is no waiting room or moderator control that this app can
> enforce. The room names here are unguessable (120 bits), which only reduces
> the risk of someone finding a room; it is not authentication. For anything
> beyond a demo use **self-hosted Jitsi** (with authentication / JWT) or **8x8
> JaaS** (Jitsi as a Service) with JWT, and have the hosting, logging and
> retention arrangements reviewed by counsel (HIPAA BAA / DPDP agreement). See
> `docs/compliance.md`.

## Providers

| `TELEHEALTH_PROVIDER` | Behaviour |
|---|---|
| `none` (default; any unknown value) | Disabled. `isTelehealthEnabled()` is `false`, `getVisitLink` refuses, `/visit/*` shows "not available" |
| `jitsi` | Room URL `${TELEHEALTH_BASE_URL}/pkp-<24 chars>#config...` |

The provider interface is `getRoom({ appointmentId, start }) -> { url }`
(`lib/telehealth/providers.ts`). A JaaS provider (JWT per participant) would be
a new implementation of that interface; it is **not** implemented.

### Room name

```
room = "pkp-" + first 24 chars of base32(HMAC-SHA256(secret, "pkp-telehealth-room:v1\n" + appointmentId + "\n" + startISO))
```

Deterministic (no stored field), different for every appointment and every
start time (a reschedule moves to a new room), different per secret. Rotating
the secret changes every room and invalidates every outstanding visit link.
`isTelehealthEnabled()` lives in `lib/telehealth/index.ts` and is **server
only** (it reads env and imports `node:crypto`): compute it in a server
component or action and pass a boolean to client components.

## Environment

| Env | Default | Meaning |
|---|---|---|
| `TELEHEALTH_PROVIDER` | `none` | `jitsi` enables |
| `TELEHEALTH_BASE_URL` | `https://meet.jit.si` | Jitsi origin (+ optional path). https required (http only for localhost). Point at your self-hosted Jitsi or JaaS |
| `TELEHEALTH_ROOM_SECRET` | falls back to `ADMIN_SESSION_SECRET` | HMAC secret for room names **and** visit tokens (distinct context prefixes). Long random string. With neither set nothing is issued or accepted |

A production start logs one warning if the provider is `jitsi` and the host is
`meet.jit.si`.

## Flow

1. UI calls `getVisitLink(appointmentId)` (`lib/actions/telehealth.actions.ts`, server action):

   ```ts
   getVisitLink(appointmentId: string): Promise<ActionResult<{ url: string; opensAt: string }>>
   ```

   - Allowed: the owning patient (`assertPatientOrStaffOwns(appointment.userId)`), staff with role `admin` or `frontdesk`, and the `doctor` the appointment is assigned to (their `doctors` document's `staffUserId` must match `appointment.doctorId`). Other doctors are denied.
   - Refused with a clear message when: the provider is `none` ("Video visits are not enabled."), the appointment is not `video`, is `cancelled`, is not `scheduled` (pending), or the visit window has already closed ("This visit has ended."). Eligibility is only revealed after authorization.
   - Returns `url: "/visit/{token}"`, an **app** URL, never the room URL, and `opensAt` (ISO, start minus 10 minutes). Audit `telehealth.link` (success / denied / error, no PHI).
   - Staff links are issued with the clinic-side `doctor` role; patient links with `patient`.
2. `/visit/{token}` (`app/visit/[token]/page.tsx`, public page, no login) verifies the token, reloads the appointment and re-checks state and time on every render. It shows only the doctor name and time, a device-check list, the "not for emergencies" and consent notice, and the **Join** link (opens the provider in a new tab with `noopener noreferrer`).
3. The room URL is computed only while the window is open. States: not valid / expired, cancelled / not confirmed / not video, early (countdown page that refreshes itself when the window opens), open, ended.

### Token

`base64url(JSON{a: appointmentId, r: patient|doctor, p: "visit", exp}) . base64url(HMAC-SHA256)`,
HMAC context `pkp-telehealth-token:v1:visit`, constant-time comparison. `exp` =
appointment end + 60 minutes. The signed `p` and the HMAC context make a token
minted for any other purpose fail here.

### Time window

Opens **10 minutes before** the start, closes **30 minutes after** the
appointment end (end = start + the doctor's `slotMinutes`, 30 if unknown).
The token outlives the close by 30 more minutes so a late visitor sees "ended"
instead of "invalid".

## Page security

- `metadata`: `robots: noindex, nofollow, nocache` and `<meta name="referrer" content="no-referrer">`; the join link also has `rel="noopener noreferrer"` and `referrerpolicy="no-referrer"`. The response header `Referrer-Policy` stays the site-wide `strict-origin-when-cross-origin` (set in `next.config.mjs`, which this module does not own): browsers then send only the origin, never the token path. To make the header itself `no-referrer` for this route, add in `next.config.mjs` `headers()` a rule for `/visit/:path*` with `Referrer-Policy: no-referrer` placed after the catch-all.
- The join page is **not embedded in an iframe**: the site-wide `Permissions-Policy: camera=(), microphone=()` would stop the embedded call from using the camera. Joining opens the provider's own page, which asks for device permission there. Do not relax the site-wide policy for this.
- The token is in the URL path and so appears in your server/proxy access logs for the duration of its validity. Treat logs accordingly.
- Links are bearer credentials: anyone with the link can see the visit page and, in the open window, the room address.

## Limits and known gaps

- **No recording, no waiting room, no lobby/moderator control** are provided by this app. On public Jitsi there is none at all; on self-hosted Jitsi or JaaS configure lobby/authentication there. PKPCare does not record; the provider might, depending on its configuration.
- `PATIENT_AUTH_ENFORCED` is off by default. While it is off, `assertPatientOrStaffOwns` lets anonymous callers through, so **anyone who knows an appointment id could request its link**. Set `PATIENT_AUTH_ENFORCED=true` (see `docs/auth.md`) before enabling telehealth with real data.
- The Jitsi URL hash sets the prejoin page and disables deep links; these are client-side hints, not security controls.
- Reminders, waiting-room notifications and surfacing the link in the patient/admin UI belong to other workstreams: they call `getVisitLink` and gate on `isTelehealthEnabled()`.
- Device check is instructions only; it cannot probe the camera from this origin.
- Page views are not audited (only link issuance is); add a `telehealth.join` audit if you need per-view evidence.
- Not verified against a live Jitsi, JaaS or Appwrite instance; covered by unit tests only (`tests/telehealth/`).
