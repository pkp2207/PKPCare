# Scheduling, availability and booking

Phase 1 of the patient-portal platform: doctors with working hours, DB-enforced
atomic booking, patient self-service (list / cancel / reschedule) and a
waitlist. Everything is additive: every previously exported action keeps its
name and call shape, and the app keeps working (on the static `Doctors`
constant and the old overlap check) until the setup script has been run.

## Data model

Fixed collection ids (constants in `constants/index.ts`), created by
`scripts/appwrite-setup.mjs`. All collections have **no client permissions**
(server API key only) and `documentSecurity: false`.

### `doctors`

| attribute     | type       | notes |
|---------------|------------|-------|
| `name`        | string 100 | required. Legacy appointments reference the doctor by this name (`primaryPhysician`). |
| `specialty`   | string 100 | required |
| `image`       | string 500 | required (path or URL) |
| `email`       | string 200 | optional, never returned by public actions |
| `staffUserId` | string 36  | optional. Appwrite user id of the `doctor`-role staff account; drives role scoping and self-service edits. Unique index. |
| `active`      | boolean    | default `true`. Inactive doctors are hidden and cannot be booked. |
| `slotMinutes` | integer    | 5..240, default 30 |
| `timezone`    | string 64  | IANA name, default `UTC`. Working hours are wall-clock in this zone. |
| `weeklyHours` | string 4000 | JSON: `{"mon":[["09:00","13:00"],["14:00","17:00"]],"sat":[]}`. Keys `mon..sun`; `"24:00"` is allowed as an end. No intervals crossing midnight. |
| `timeOff`     | string 16000 | JSON array of `{start,end,reason?}` (ISO instants), default `[]`. Max 100 entries; entries that ended more than 30 days ago are pruned on write. |

### `slots`

One document per **held** time. A free time has no document.

| attribute       | type     | notes |
|-----------------|----------|-------|
| `doctorId`      | string 36 | required |
| `start` / `end` | datetime | required |
| `appointmentId` | string 36 | the appointment that holds it (null for `blocked`) |
| `status`        | enum `booked` / `blocked` | required |

Indexes: `uniq_doctor_start` (unique `doctorId`+`start`, second line of defence
for non-canonical ids), `idx_appointmentId`.

### `waitlist`

`userId`, `patientId`, `doctorId`, `earliest`, `latest` (datetime window the
patient will accept), `status` (`waiting` / `offered` / `fulfilled` /
`expired`), `createdAt`, plus optional `offeredStart`, `offeredAt`.
Indexes: `idx_user_status`, `idx_doctor_status_created`.

### `appointments` (existing collection, additive)

New optional attributes: `doctorId` (string 36), `slotId` (string 36),
`visitType` (enum `in_person`/`video`, default `in_person`), `reminderSentAt`
(datetime), `cancelledBy` (enum `patient`/`staff`/`system`).
The script adds these to the collection named by `APPOINTMENT_COLLECTION_ID`
(it never creates that collection).

**Indexes the appointments collection needs** (the script creates them if the
underlying attributes exist; otherwise create them in the console):

`schedule`, `primaryPhysician`+`schedule`, `status`, `doctorId`+`schedule`,
`userId`, `slotId`. Without `userId` and `doctorId` the "my appointments" and
doctor-scoped admin lists do full scans; without `primaryPhysician`+`schedule`
the legacy overlap check does.

## Slot ids and atomic booking

A booking first creates a `slots` document whose **id is deterministic**:

```
slotId(doctorId, start) = `${doctorId}_${start.getTime()}`        (<= 36 chars, [A-Za-z0-9._-])
                        = "h" + sha256(doctorId|epoch)[0..35]      (otherwise, e.g. long doctor ids)
```

Appwrite rejects a second document with the same id with **HTTP 409**, so two
concurrent bookings of the same (doctor, start) cannot both succeed - the
database arbitrates, not a query-then-insert check. The loser gets
*"That time was just taken. Please choose another time."*

Booking order (`lib/scheduling/booking.ts`, `appointment.actions.ts`):

1. pre-generate the appointment id, 2. create the slot (409 => "just taken"),
3. create the appointment with that id and `slotId`, 4. if step 3 fails, delete
the slot (rollback).

- **Cancel** deletes the slot, then offers the freed time to the waitlist.
- **Reschedule** books the *new* slot first, updates the appointment, and only
  then releases the old slot; a failure rolls the new slot back and leaves the
  original booking untouched.
- **Orphans**: if the process dies between steps 2 and 3 (or the rollback
  delete fails) a slot is left pointing at nothing. On a 409 the booking code
  reaps such a slot and retries once, but only if it is older than 2 minutes
  (`ORPHAN_SLOT_GRACE_MINUTES`) *and* its appointment is missing, cancelled or
  points at a different slot - so an in-flight booking is never stolen. `blocked`
  slots are never reaped.
- The old 30-minute overlap query still runs (window = the doctor's
  `slotMinutes`). It is not atomic; it exists so legacy appointments that have
  no slot document still block their time.

## Scheduling rules (`lib/scheduling`, pure and unit tested)

- `generateCandidateSlots`, `isWithinWorkingHours`, `subtractTimeOff`,
  `validateSlotBookable`, `computeAvailability`, `slotId`,
  `zonedWallTimeToUtc` - Intl only, no dependencies.
- Patient bookings must be: in the future, >= 60 min ahead
  (`BOOKING_MIN_LEAD_MINUTES`), <= 90 days ahead (`BOOKING_MAX_HORIZON_DAYS`),
  fully inside one working interval of the doctor's local day, aligned to the
  slot grid *from the interval start*, and not overlapping time off.
- Staff (`admin`/`frontdesk`/`doctor` via `updateAppointment`, or staff using
  `rescheduleAppointment`) may override hours, lead time, horizon and time off;
  only the past is rejected. The slot is still claimed atomically.
- **DST**: wall-clock hours are converted per day. A wall time that does not
  exist (spring-forward gap) resolves to just after the gap; one that occurs
  twice (fall-back) resolves to its first occurrence. Slots are stepped in
  real elapsed time from each interval start, so on a spring-forward day a
  00:00-06:00 interval yields 5 real hours of slots and on a fall-back day 7,
  with no duplicate or missing starts.
- Availability also hides times held by legacy appointments (no slot document).

## Actions

All return `ActionResult<T>`, validate with zod and never throw.

| action | who | notes |
|--------|-----|-------|
| `createAppointment(params)` | patient (ownership check) | New path: `doctorId` + `slotStart` (+ `visitType`). Legacy path: `primaryPhysician` + `schedule`. New path wins if both are given. |
| `getAppointment(id, userId)` | patient / staff | nested patient decrypted |
| `listMyAppointments(userId)` | patient / staff | |
| `cancelMyAppointment({appointmentId,userId,reason})` | patient / staff | future appointments only |
| `rescheduleAppointment({appointmentId,userId,newStart})` | patient / staff | atomic swap, see above |
| `getRecentAppointmentList(opts)` | `admin`, `frontdesk`, `doctor` | same `RecentAppointmentList` shape. `doctor` sees only appointments whose `doctorId` is their doctors document (`staffUserId` match); a doctor with no linked document sees an empty list. |
| `updateAppointment(params)` | `admin`, `frontdesk`, `doctor` (own only) | schedule / cancel; releases and claims slots |
| `listDoctors()` | public | active only; `id,name,specialty,image,slotMinutes,timezone` (never `email`/`staffUserId`). Falls back to the static list (`legacy: true`, ids = slug of the name) while the collection is missing or empty. |
| `getAvailability({doctorId,from,to})` | public | ISO `{start,end}[]`, window <= 14 days, excludes booked slots, legacy bookings, time off, the past and lead time |
| `upsertDoctor(input)` | `admin`; `doctor` for own document | a doctor can change only `weeklyHours`, `slotMinutes`, `timezone`, `timeOff`; other fields are ignored |
| `setDoctorActive({doctorId,active})` | `admin` | |
| `addTimeOff({doctorId,start,end,reason?})` | `admin`; `doctor` for self | does **not** cancel existing bookings; returns `conflictingAppointments` so staff can follow up |
| `joinWaitlist` / `leaveWaitlist` / `listMyWaitlist` | patient / staff | one live entry per doctor, max 10 live entries |

Legacy doctor resolution: `primaryPhysician` is looked up by name in `doctors`;
if that collection is missing or empty the static `Doctors` constant is used
and the old behaviour applies (no slot document, none of the new attributes are
written). Once any doctor exists, only names in `doctors` are accepted.

### Waitlist offers

When a slot is freed (cancel / move) `offerFreedSlotToWaitlist(doctorId, start)`
(`lib/scheduling/offers.ts`, deliberately not in a `"use server"` file) marks
the oldest `waiting` entry whose window contains the time as `offered` (storing
`offeredStart`, `offeredAt`), skipping the user who just freed it and times
inside the lead window, and calls `onWaitlistOffer` in
`lib/scheduling/hooks.ts`. **Phase 2 TODO**: that hook only logs - it must send
the SMS/email and start a claim window; nothing yet moves `offered` entries to
`expired`. Booking a matching slot marks the user's matching entries
`fulfilled`.

## Running the setup script

```bash
node --env-file=.env scripts/appwrite-setup.mjs --dry-run          # plan only, no network, no env needed
node --env-file=.env scripts/appwrite-setup.mjs                    # create what is missing
node --env-file=.env scripts/appwrite-setup.mjs --seed-doctors     # also seed doctors from constants
node --env-file=.env scripts/appwrite-setup.mjs --seed-doctors --timezone=Asia/Kolkata
```

It reads **every** `scripts/schema/*.json` (other features add theirs), creates
missing collections, attributes and indexes, waits for new attributes to become
`available` before creating indexes, and never modifies or deletes anything
that exists. Exit code is 1 if any step failed. Required env:
`NEXT_PUBLIC_ENDPOINT`, `PROJECT_ID`, `API_KEY`, `DATABASE_ID`, plus whatever
`idFromEnv` names (`APPOINTMENT_COLLECTION_ID` for `appointments.json`).

`--seed-doctors` creates one doctor per entry of the `Doctors` constant
(parsed from `constants/index.ts`), id = slug of the name (e.g. `john-green`),
specialty "General Medicine", Mon-Fri 09:00-17:00, 30-minute slots, timezone
`UTC` unless `--timezone` is given. Existing ids are skipped. Afterwards set
real hours/specialties with `upsertDoctor`, and link each doctor's login by
setting `staffUserId`.

### Schema file format

One JSON object per file (or an array, or `{ "collections": [...] }`):

```json
{
  "id": "doctors",                      // fixed collection id, or:
  "idFromEnv": "APPOINTMENT_COLLECTION_ID",
  "name": "Doctors",
  "existing": false,                    // true = never create the collection, only add attributes/indexes
  "documentSecurity": false,
  "permissions": [],                    // [] = server API key only
  "attributes": [
    { "key": "name", "type": "string", "size": 100, "required": true },
    { "key": "slotMinutes", "type": "integer", "min": 5, "max": 240, "required": false, "default": 30 },
    { "key": "status", "type": "enum", "elements": ["booked", "blocked"], "required": true }
  ],
  "indexes": [
    { "key": "uniq_doctor_start", "type": "unique", "attributes": ["doctorId", "start"], "orders": ["ASC", "ASC"] }
  ]
}
```

Attribute types: `string` (needs `size`), `integer`, `float`, `boolean`,
`datetime`, `enum` (needs `elements`), `email`; optional `array`. Appwrite does
not allow a default on a required attribute (the script rejects that).

### Appwrite console notes

- Attribute creation is asynchronous; if you add attributes by hand wait for
  "Available" before adding indexes.
- Index creation on a string attribute fails if the attribute is larger than
  Appwrite's index length limit; the script reports the index that failed and
  carries on.
- Do not give these collections client (role:any/users) permissions - every
  access goes through server actions with the API key.
- If `timeOff` grows past Appwrite's row width limits, raise the attribute size
  rather than the entry cap.

## Patients: field encryption and attribute sizes

`patient.repository` encrypts `SENSITIVE_PATIENT_FIELDS`
(`lib/compliance/crypto`) on write and decrypts on read (`getPatient`, the
nested `patient` of every appointment read). Legacy plaintext passes through.
Decrypted values are never logged.

**Required `patients` collection change (schema file not changed here):**
ciphertext is `enc:v1:<keyId>:<iv>:<tag>:<ct>` = `56 + ceil(4n/3)` characters
for an `n`-byte plaintext. Each encrypted string attribute must be at least
that for its longest allowed value, e.g. for ASCII-dominant data:

| field | max plaintext | min attribute size |
|-------|---------------|--------------------|
| `insurancePolicyNumber` | 50 | 128 |
| `identificationNumber` | 100 | 200 |
| `allergies`, `currentMedication`, `familyMedicalHistory`, `pastMedicalHistory` | 2000 | 2800 (10 800 if you must allow 4-byte characters) |

Raise the sizes in the console (Appwrite allows increasing a string attribute's
size) **before** enabling `FIELD_ENCRYPTION_KEY`, otherwise writes fail.
Only string attributes can be encrypted (`birthDate` is a datetime and must
stay out of the sensitive list), and encrypted fields cannot be searched or
sorted. `registerPatient` records consent (`recordConsentGrants`) **before**
creating the patient document, so a consent failure leaves nothing behind and a
retry is not blocked by the "already registered" check.

## Auditing

Fire-and-forget `recordAudit` (never awaited for failure, no PHI in `meta`):
`appointment.create|cancel|reschedule|update|list` (`appointment.read`, `appointment.list_mine` and `waitlist.list` are recorded only when access is denied),
`patient.register`, `patient.read` (staff reads only), `doctor.upsert|set_active|time_off`,
`waitlist.join|leave`. Denied staff/patient authorization is recorded with
`outcome: "denied"` and `actorRole: "anonymous"` where the caller is unknown
(or the acting staff member for forbidden doctor edits).

## Limits and assumptions

- Availability window <= 14 days; booking horizon 90 days; lead time 60 min;
  slot length 5-240 min; <= 6 working intervals per day; <= 100 time-off
  entries; <= 10 live waitlist entries per patient.
- Legacy appointments (no `doctorId`) are invisible to the `doctor` role's
  scoped list; backfill `doctorId` (e.g. by matching `primaryPhysician` to
  `doctors.name`) if doctors should see history. Rescheduling or re-confirming
  a legacy appointment through the app backfills it.
- Public actions (`listDoctors`, `getAvailability`) have no rate limiting here.
- Waitlist offers are advisory and not atomic across concurrent frees.
- Env: no new variables. Collection ids for the new collections are constants.
  `PATIENT_AUTH_ENFORCED` (owned by the auth layer) turns the patient
  ownership checks from no-ops into real enforcement.
