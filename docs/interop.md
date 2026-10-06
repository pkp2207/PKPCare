# Interoperability: read-only FHIR R4 facade and adapter plans

> **Read this first.** Enabling the FHIR API exposes patient data (PHI) to
> every holder of a token. It is a convenience facade written for this app,
> **not** a certified or conformance-tested FHIR server (no Inferno/Touchstone
> run, no SMART-on-FHIR, no US Core / ABDM profile validation). Treat tokens as
> credentials to a medical record, agree the legal basis (HIPAA BAA / DPDP
> processing agreement) with each consumer, and have counsel confirm it. See
> `docs/compliance.md`.

## What exists

| Piece | Where |
|---|---|
| Route (GET only) | `app/api/fhir/[[...path]]/route.ts` |
| Request handling, routing, audit | `lib/fhir/handler.ts` |
| Auth, scopes, rate limit | `lib/fhir/auth.ts` |
| Pure mappers (Patient, Practitioner, PractitionerRole, Schedule, Slot, Appointment, Consent, CapabilityStatement) | `lib/fhir/mappers.ts`, `lib/fhir/slots.ts` |
| Bundle + paging, search parameter parsing | `lib/fhir/bundle.ts`, `lib/fhir/search-params.ts` |
| OperationOutcome | `lib/fhir/outcome.ts` |
| Data access (Appwrite, raw documents) | `lib/fhir/data.ts` |
| ABDM / US payer adapter **interfaces only** | `lib/interop/` |

No FHIR library and no new dependency is used.

## Enabling

Off by default. With `FHIR_API_ENABLED` unset (or anything but `true`) every
request, including non-GET, gets `404` with an OperationOutcome
"The FHIR API is not enabled."

| Env | Required | Meaning |
|---|---|---|
| `FHIR_API_ENABLED` | yes, exactly `true` | Master switch |
| `FHIR_API_TOKENS` | for token access | Comma- or newline-separated `name:scopes:token` entries (format below) |
| `FHIR_RATE_LIMIT_PER_MINUTE` | no (default 120) | Requests per principal per minute |
| `FHIR_BASE_URL` | no | Public base used in `fullUrl` / paging links, e.g. `https://care.example.org/api/fhir`. Defaults to the request origin + `/api/fhir`, which is wrong behind some proxies |
| `FIELD_ENCRYPTION_KEY` | yes in production | Needed to decrypt sensitive fields (see compliance doc) |

### Token format

```
FHIR_API_TOKENS="epic-sandbox:read:patient+read:appointment:<token>,billing:read:slot|read:practitioner:<token2>"
```

- `name`: `[A-Za-z0-9_.-]{1,32}`. It is the **audit actor id**. Use one name per consumer.
- `scopes`: separated by `+`, `|` or spaces (commas separate entries, hence not commas).
- `token`: at least 32 characters, no `:`, `,` or whitespace. Generate with `openssl rand -base64 36 | tr '+/' '-_' | tr -d '='`.
- Malformed entries are **dropped** (fail closed) with a one-line warning that never contains the token.
- Tokens are hashed (SHA-256) and compared with `timingSafeEqual` against every configured token, so neither length nor position of a match leaks.
- Rotate by adding the new entry, moving the consumer, then removing the old one.

Alternative for testing: a signed-in staff session with role `admin` (cookie
auth, no Authorization header). It gets every scope **except**
`read:sensitive`. A request that sends an `Authorization` header never falls
back to the cookie.

### Scopes

| Scope | Grants |
|---|---|
| `read:patient` | `Patient` |
| `read:appointment` | `Appointment` |
| `read:practitioner` | `Practitioner`, `PractitionerRole` |
| `read:slot` | `Schedule`, `Slot` |
| `read:consent` | `Consent` |
| `read:sensitive` | Allows `_include=sensitive` (below). Never implied by anything else |

Missing scope: `403` OperationOutcome.

## Endpoints

Base: `/api/fhir`. Content type `application/fhir+json`, `Cache-Control: no-store`.
Everything requires authentication, including `metadata`.

| Request | Notes |
|---|---|
| `GET metadata` | CapabilityStatement (R4 4.0.1, read + search-type only) |
| `GET Patient/{id}` | Document id |
| `GET Patient?identifier=[urn:pkpcare:user-id\|]{userId}` or `?email={exact}` | At least one is required (no listing of all patients). Email is exact match and needs an index on `email`; otherwise `400 not-supported`. Email in a URL ends up in proxy logs: prefer `identifier` |
| `GET Practitioner`, `Practitioner/{id}` | Doctors. Never includes email or staff user id. Inactive doctors have `active: false` |
| `GET PractitionerRole`, `PractitionerRole/{id}`, `?practitioner=` | Id equals the doctor id; carries `specialty.text` |
| `GET Schedule`, `Schedule/{id}`, `?actor=Practitioner/{id}` | Id equals the doctor id |
| `GET Slot?schedule=Schedule/{id}&start=ge..&start=lt..&status=` | `schedule` required. `start` range at most **31 days** (`400 too-costly` beyond); default now to +7 days. `status`: `free`, `busy`, `busy-unavailable` (comma list) |
| `GET Appointment/{id}` | |
| `GET Appointment?patient=&practitioner=&date=&status=` | At least one of `patient`, `practitioner`, `date`. `date` takes `eq ge gt le lt` (max two values). `status` takes `proposed,booked,cancelled` |
| `GET Consent?patient=Patient/{id}` | `patient` required. One Consent per purpose (`treatment`, `disclosure`, `privacy`), from the latest row of the append-only history; purposes never recorded are omitted |

Anything else returns an OperationOutcome: `404` unknown endpoint, `405`
non-GET (`Allow: GET`), `400` unsupported/invalid parameter (parameter
**names** only are echoed), `429` with `Retry-After`, `500` generic
("The server could not process the request.", never a stack or internal text).

### Paging

`_count` (default 20, **max 50**, clamped) and `_offset` (0 to 10000). The
searchset Bundle has `total` and `link` entries `self`, `previous`, `next`.
`total` for `Slot` is the number of slots in the requested range.

### Mapping notes

- Appointment status: `pending` -> `proposed`, `scheduled` -> `booked`, `cancelled` -> `cancelled`. `start`/`end` from `schedule` + the doctor's `slotMinutes` (30 if unknown). `visitType` -> `serviceType` (`urn:pkpcare:visit-type`: `in_person` / `video`). Participants reference `Patient/{id}` and `Practitioner/{doctorId}`; legacy appointments without a doctor document get a display-only participant.
- Slot ids are synthesized (`{doctorId}-{epochMs}`); Slot status: `busy` = held by a booked slot document or a legacy appointment, `busy-unavailable` = blocked, time off, already past or inside the 60-minute booking lead time, `free` otherwise. The legacy-appointment lookup is capped at 100 rows per request.
- Dates are UTC: date-only search values are UTC day/month/year periods; `Patient.birthDate` is the UTC date of the stored value.
- Identifiers use our own namespaces (`urn:pkpcare:*`); nothing is a registered FHIR/NamingSystem URI. Consent uses the standard `consentscope` system and LOINC `59284-0`; everything else is local.
- Statuses of participants, codings and the `policy` URI are best-effort; validate against your consumer's profile before relying on them.

### Sensitive data

Default output is **minimal**: Patient has name, email, phone, gender,
birthDate, free-text address and the user-id identifier. Appointment has no
reason, note, cancellation reason, and nothing from the embedded patient.

`_include=sensitive` (our own switch, not standard FHIR) additionally emits:

- Patient: identification type/number (as `identifier`), insurance provider and policy number, occupation, allergies, current medication, family and past medical history (as `extension`s under `urn:pkpcare:fhir/StructureDefinition/`), emergency contact (`contact`).
- Appointment: `reasonCode.text`, `comment` (note), `cancelationReason.text`.

It requires the `read:sensitive` scope; asking without it is `403`, never a
silent downgrade. Encrypted fields are decrypted (`decryptFields`) **only** on
this path. A value that still looks like ciphertext is never emitted.

## Audit

Every authenticated request is recorded with `recordAudit` **before** the
response is returned: `action: "fhir.read"`, `resource: "fhir.<Type>"`
(`fhir.metadata`, `fhir.unknown` for bad paths), `resourceId` for reads,
`actorId` = token name (`staff-<id>` for a session), `actorRole`
`fhir-client` or `admin`, `outcome` `success`/`denied` (403)/`error`, and meta
`{status, count, total, purpose: minimal|sensitive, actor: token|session}`. No
names, emails, search values or ids beyond the resource id. A presented but
wrong token is recorded as `fhir.auth` / `denied` (no token value). Not
audited: disabled (404), anonymous requests with no credential, `405`, and
`429` responses (none of them return data; auditing them would let a caller
flood the log).

## Rate limiting

In memory, per principal name, fixed one-minute window. It is **per server
instance**: counters reset on restart and are not shared across replicas or
serverless invocations. Use a shared store (Redis) for multi-instance
deployments. Failed-login attempts are not rate limited here (tokens are 32+
random characters); add IP throttling at the edge if you expect probing.

## Smoke test

```bash
export FHIR_API_ENABLED=true
export FHIR_API_TOKENS="smoke:read:patient+read:appointment+read:practitioner+read:slot+read:consent:$(openssl rand -base64 36 | tr '+/' '-_' | tr -d '=')"
# restart the app, then:
TOKEN=<the token part after the last colon>
B=http://localhost:3000/api/fhir

curl -s -H "Authorization: Bearer $TOKEN" $B/metadata | head -c 300
curl -s -H "Authorization: Bearer $TOKEN" "$B/Practitioner?_count=5"
curl -s -H "Authorization: Bearer $TOKEN" "$B/Slot?schedule=Schedule/<doctorId>&start=ge2026-10-08&start=lt2026-10-15&status=free"
curl -s -H "Authorization: Bearer $TOKEN" "$B/Patient?identifier=urn:pkpcare:user-id%7C<userId>"
curl -s -H "Authorization: Bearer $TOKEN" "$B/Appointment?patient=Patient/<patientId>&status=booked"
curl -s -H "Authorization: Bearer $TOKEN" "$B/Consent?patient=Patient/<patientId>"
# expected failures
curl -si $B/metadata | head -1                                              # 401
curl -si -X POST -H "Authorization: Bearer $TOKEN" $B/Patient | head -1      # 405
curl -si -H "Authorization: Bearer $TOKEN" "$B/Patient/<id>?_include=sensitive" | head -1   # 403 without read:sensitive
```

Then check the `audit_logs` collection for `fhir.read` rows. Unit tests
(`tests/fhir/`) run with mocked data and no network; nothing here has been run
against a live Appwrite project.

## Adapter plans (not implemented)

`lib/interop/abdm.ts` and `lib/interop/payer.ts` define TypeScript interfaces
and `notImplemented*Adapter` objects whose every method rejects with
`InteropNotImplementedError`. They make **no network calls** and return no fake
data. They need vendor credentials and onboarding that this repo does not have.

### ABDM (India)

Prerequisites: ABDM sandbox registration (client id/secret), a facility in the
Health Facility Registry for HIP use, then the production compliance process;
public HTTPS callback endpoints for gateway notifications; a consent-manager
flow and PHR-app testing; key handling for the health-information exchange
encryption (ECDH + AES-GCM per the ABDM spec). Plan: gateway session client ->
ABHA create/verify/link (OTP) -> consent request/artefact handling (HIU) and
data-request handling (HIP) -> map our FHIR output to ABDM profiles (the
current facade is **not** ABDM-profile conformant) -> revocation handling.
Store only the ABHA identifiers a patient consents to link, encrypted, and add
a `consent` purpose for it. Confirm all API paths and legal requirements
against current ABDM documentation.

### US payers (eligibility and prior authorization)

Prerequisites: HIPAA covered-entity status and a BAA with a clearinghouse,
practice NPI/tax id, payer enrolment, clearinghouse credentials and sandbox,
security review. Plan: X12 270/271 eligibility (005010X279A1) or FHIR
`CoverageEligibilityRequest` where offered; X12 278 prior authorization
(005010X217) or Da Vinci PAS/CRD/DTR where supported; keep raw payloads out of
logs; audit every inquiry. Insurance fields on the patient record are
encrypted today, so an eligibility call must decrypt only inside the adapter.

## Not covered

Write operations, `_history`, versioning/ETags, `_revinclude`, `Prefer`
handling, SMART on FHIR / OAuth2, Bulk Data, subscriptions, terminology
services, profile validation, OPTIONS/CORS (no CORS headers are sent; call it
server to server), and any per-patient access control: a token with
`read:patient` can read every patient.
