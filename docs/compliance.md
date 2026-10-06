# Compliance primitives

> **Not legal advice.** These are engineering building blocks (purpose-specific
> consent, an audit trail, field encryption, retention tooling, and
> access/export/erasure requests) designed so the app can support both Indian
> (DPDP Act 2023 / Rules 2025) and US (HIPAA) contexts. Nothing in this code or
> document claims that the app is compliant with any law. **Confirm every
> policy, retention period, notice text and process with qualified counsel
> before handling real patient data.**

## What is implemented

| Area             | Where                                                            | Summary                                                                                                                                                                                                                               |
| ---------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Consent          | `lib/compliance/consent.ts`, `consents` collection               | One row per purpose (`treatment`, `disclosure`, `privacy`), **append-only**. A grant or withdrawal is a new row; the current state of a purpose is its latest row. Each row stores policy version, time, IP (best effort) and source. |
| Audit trail      | `lib/compliance/audit.ts`, `audit_logs` collection               | `recordAudit()` stores who / what / which resource / outcome / time / request id / IP. **Never throws.** `meta` is allow-listed and bounded; no names, emails, phones, free text or tokens.                                           |
| Field encryption | `lib/compliance/crypto.ts`                                       | AES-256-GCM (Node `crypto`) for `SENSITIVE_PATIENT_FIELDS`. Key rotation supported.                                                                                                                                                   |
| Redaction        | `lib/compliance/redact.ts`                                       | `redactForLogs()` masks emails, phone-like numbers, long digit strings, JWT/bearer tokens, and sensitive keys in objects. Reusable for any logging.                                                                                   |
| Data rights      | `lib/actions/compliance.actions.ts`                              | Patient: `getMyConsents`, `withdrawConsent`, `exportMyData`, `requestAccountDeletion`. Admin: `listDeletionRequests`, `resolveDeletionRequest`, `listAuditLogs`.                                                                      |
| Retention        | `lib/compliance/retention.ts`, `app/api/cron/retention/route.ts` | `RETENTION` placeholder config, `purgeExpiredRecords({ dryRun })`, cron-callable route.                                                                                                                                               |

Collection ids are fixed constants (`lib/compliance/constants.ts`):
`audit_logs`, `consents`, `deletion_requests`. Schemas live in
`scripts/schema/*.json`. The collections have **no collection/document
permissions**; they are reachable only through the server API key.

## Data flow

```
Registration ──recordConsentGrants()──► consents (3 rows: one per purpose)
Patient/staff ─► server action ─► assertPatientOrStaffOwns / requireRole("admin")
                                   │ denied ─► audit (outcome=denied) ─► generic error
                                   ▼
                              repository call ─► recordAudit() (success | error)

requestAccountDeletion ─► deletion_requests (status=pending)   [nothing deleted]
admin resolveDeletionRequest(approved)
    ├─ delete uploaded ID file(s)
    ├─ anonymize appointments (keep schedule/status/physician; scrub reason, note, userId, patient link)
    ├─ delete patient document
    ├─ delete Appwrite user
    └─ mark request approved (+ summary counts)   [audit rows + consent history retained]

cron ─► GET /api/cron/retention (Bearer CRON_SECRET) ─► purgeExpiredRecords()
```

All server actions return `ActionResult<T>`, never throw to the client, and
return generic error strings; detail goes to the audit log (error name/code
only) and server console.

### Erasure semantics

- `requestAccountDeletion` only creates a `pending` row (one open request per
  user). Legal retention review happens before anything is deleted.
- Approval is **idempotent and retryable**: every erase step treats "already
  gone" as success; if a step fails the request stays `pending` and can be
  re-approved. An already-resolved request is never processed twice, and
  cannot be flipped to the opposite decision.
- **Retained on purpose** (confirm with counsel): anonymized appointment
  records (statistics), the audit log, consent history (evidence of what was
  consented to), and the resolved deletion request itself (proof the request
  was handled; purged after `closedDeletionRequestDays`).
- The appointment -> patient relationship should use an `onDelete` behaviour
  of `setNull` so deleting the patient document cannot cascade-delete the
  appointments. The erasure code also tries to null the link itself.
- Data outside the app (backups, email/SMS provider logs, analytics, error
  reporting) is **not** touched by this flow.

## Environment variables

| Variable                        | Required                  | Purpose                                                                                                      |
| ------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `FIELD_ENCRYPTION_KEY`          | Yes in production         | Base64 of 32 random bytes. Generate: `openssl rand -base64 32`.                                              |
| `FIELD_ENCRYPTION_KEY_PREVIOUS` | Only during rotation      | Previous key, used for decrypt only.                                                                         |
| `CRON_SECRET`                   | Yes to use the cron route | Shared secret; requests need `Authorization: Bearer $CRON_SECRET`. Unset means the route always returns 401. |

Behaviour when `FIELD_ENCRYPTION_KEY` is **missing**:

- **production** (`NODE_ENV=production`): encrypting throws a clear
  configuration error (the write fails rather than storing plaintext).
- **development/test**: one console warning, values are stored as **plaintext**
  so the app keeps working before the key is configured.
- Reading legacy plaintext always works. Reading an `enc:` value without the
  matching key throws a safe `FieldDecryptionError` (no content leaked).

An invalid key (not 32 bytes after base64 decode) always throws.

## Field encryption

Ciphertext format: `enc:v1:<keyId>:<iv>:<tag>:<ct>` (base64url segments).
`keyId` is a short fingerprint of the key, used to choose current vs previous
on decrypt. Encrypted fields: `identificationNumber`, `insurancePolicyNumber`,
`allergies`, `currentMedication`, `familyMedicalHistory`,
`pastMedicalHistory`.

Make sure the Appwrite attribute size for these fields fits the ciphertext
(roughly `4/3 * length + ~70` characters) before enabling encryption.

### Key management and rotation

1. Generate keys with a CSPRNG (`openssl rand -base64 32`); store them in your
   secret manager, never in the repo or client bundle. Back the key up
   separately from the database: **losing the key means losing the data.**
2. Rotate: set `FIELD_ENCRYPTION_KEY_PREVIOUS` to the old key, set
   `FIELD_ENCRYPTION_KEY` to a new key, deploy. New writes use the new key;
   old rows still decrypt via the previous key.
3. Re-encrypt existing rows (read + write each patient document, e.g. through
   the repository, which decrypts then encrypts with the current key). Verify
   no `enc:v1:<oldKeyId>:` values remain.
4. Remove `FIELD_ENCRYPTION_KEY_PREVIOUS` and redeploy. Only one previous key
   is supported at a time.
5. Rotate after suspected exposure and on a schedule set by your security
   policy.

### Honest limitations

- **Encrypted fields cannot be searched, filtered or sorted** in the database
  (each encryption uses a random IV). Do not build queries on them; search on
  non-sensitive fields or add a separate purpose-built blind index later.
- This is application-level protection of data at rest in the database. It
  does not protect against a compromised application server (which holds the
  key), nor data in logs, backups made before encryption, or the uploaded ID
  file in storage (enable storage-level encryption separately).
- No per-record AAD binding yet: a ciphertext could be copied between fields
  by someone with database write access.
- Existing plaintext rows stay plaintext until rewritten.

## Audit trail

- Entry: `{ actorId, actorRole, action, resource, resourceId?, outcome?, meta? }`.
  `outcome` is `success | denied | error`.
- Automatically adds `createdAt`, and `requestId` / `ip` when available from
  request headers (`x-request-id` or `x-vercel-id`; first `x-forwarded-for`
  entry or `x-real-ip`). The IP is only trustworthy behind a proxy you control.
- `meta` keys are allow-listed in `AUDIT_META_ALLOWED_KEYS`; everything else is
  dropped (a `_dropped` count is kept). Values are redacted and bounded.
- Failures to write are logged as one line and swallowed so audit problems can
  never break a patient flow. **Monitor for `[audit] write failed`**, as a
  silent audit gap is itself a compliance risk.
- Audit logs are not tamper-proof: anyone with the API key or database admin
  access can alter them. For stronger guarantees ship them to append-only /
  WORM storage.
- Reading the audit log (`listAuditLogs`, admin only, `pageSize <= 100`) is
  itself audited.

## Appwrite setup

Run `node scripts/appwrite-setup.mjs` (written by the scheduling/data work) to
create the `audit_logs`, `consents` and `deletion_requests` collections from
`scripts/schema/*.json` with indexes:

- `audit_logs`: `createdAt` (DESC), `action`, `actorId`
- `consents`: `userId + purpose`, `createdAt` (DESC)
- `deletion_requests`: `status`, `userId`, `createdAt` (DESC), `resolvedAt`

Set no collection-level permissions. Provide `FIELD_ENCRYPTION_KEY` and
`CRON_SECRET` in the deployment environment.

## Retention

`RETENTION` in `lib/compliance/retention.ts` holds **placeholders to be set by
counsel / your data protection owner** (`null` disables a purge):

| Setting                           | Placeholder       | Notes                                                                                                                                                          |
| --------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auditLogDays`                    | 2190 (~6 years)   | Illustrative only.                                                                                                                                             |
| `idDocumentDaysAfterVerification` | `null` (disabled) | No "verified at" marker exists yet, so the clock starts at patient registration when enabled. Deletes the stored file and detaches it from the patient record. |
| `closedDeletionRequestDays`       | 1095 (~3 years)   | Applies to approved/rejected requests, measured from `resolvedAt`.                                                                                             |

`purgeExpiredRecords({ dryRun })` is a server function, not a public action.
It is bounded per run (500 rows per type; ID document scan capped), returns
counts, counts failures in `errors` instead of throwing, and audits the run.
Schedule it with your platform's cron:

```
GET /api/cron/retention?dryRun=1     Authorization: Bearer $CRON_SECRET   # count only
GET /api/cron/retention              Authorization: Bearer $CRON_SECRET   # purge
```

Always run with `dryRun=1` first and review the counts. The secret is compared
in constant time; a missing secret, header or mismatch returns 401.

## What is NOT covered

- Legal review of consent wording, privacy notices, retention periods and
  erasure/retention trade-offs (patient records often have statutory minimum
  retention that can override erasure requests).
- Business Associate Agreements (HIPAA) / Data Processing Agreements and
  vendor due diligence for Appwrite, hosting, SMS/email, Sentry and any AI
  provider; cross-border transfer assessments.
- Breach detection, notification process and timelines; incident response.
- Appointing a DPO / privacy and security officers; DPIA / risk analysis;
  staff training; access reviews.
- Guardian/minor consent, consent for children, and verifiable-identity
  processes for rights requests.
- Backup, disaster recovery, and purging data from backups and third-party
  processors.
- Transport security, secret management, storage encryption, and access
  control hardening beyond what is in this repo.
- Grievance redressal workflows and response-time tracking for rights
  requests.
- No UI yet for patients or admins; only the server actions.

**Again: this is not legal advice. Confirm with counsel.**
