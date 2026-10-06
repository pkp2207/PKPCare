# Admin console

Role-aware console under `/admin`. Every route is gated twice: `middleware.ts`
(edge, via `ADMIN_ROUTE_ROLES` in `lib/auth/access.ts`) and the page itself
(`requireStaffPage(...roles)`); every action re-checks with `requireRole(...)`.
Hiding a nav link is never the control.

## Routes and roles

| Route | admin | frontdesk | doctor | Notes |
|---|---|---|---|---|
| `/admin` | yes | yes | redirected to `/admin/schedule` | Appointments: search, filters, sort, bulk, CSV |
| `/admin/schedule` | yes | yes | yes | Upcoming appointments (doctor: own only) + own hours/time off (doctor) |
| `/admin/doctors` | yes | no | no | Doctors, weekly hours, time off |
| `/admin/staff` | yes | no | no | Staff accounts |
| `/admin/analytics` | yes | yes | no | Aggregates, no PHI |
| `/admin/privacy` | yes | no | no | Deletion requests |
| `/admin/audit` | yes | no | no | Audit log |

Nav links per role: admin = Appointments, Doctors, Staff, Analytics, Privacy
requests, Audit; frontdesk = Appointments, Analytics; doctor = My schedule
(`components/admin/nav.ts`; a test asserts nav and route policy agree).

## Server actions (`lib/actions/admin.actions.ts`)

| Action | Roles |
|---|---|
| `searchAppointments({q,status,doctorId,from,to,visitType,sort,page,pageSize})` -> `AppointmentSearchResult` (= `RecentAppointmentList` + `matchCount`, `truncated`, `scanCap`, `scope`) | admin, frontdesk, doctor (own only) |
| `exportAppointmentsCsv(filters)` -> `{filename,csv,rowCount,truncated,cap}` | admin, frontdesk |
| `bulkUpdateAppointments({ids,action:"confirm"\|"cancel",reason?})` -> per-item `BulkResult` | admin, frontdesk, doctor (own only, enforced per item) |
| `listAllDoctors()`, `getOwnDoctor()` | admin / doctor |
| `listConflictingAppointments({doctorId,start,end})` | admin, doctor (own doc) |
| `getAnalytics({from,to,doctorId?})` -> `AnalyticsReport` | admin, frontdesk |
| `listStaff()`, `createStaff({email,name,role})`, `setStaffRole({userId,role})`, `disableStaff`, `enableStaff`, `resetStaffPassword` | admin |
| `listDeletionRequestsWithNames()` | admin |

All return `ActionResult<T>`. Doctors page and schedule page also use F2's
`upsertDoctor`, `setDoctorActive`, `addTimeOff`, `listDoctors`; privacy and
audit pages use F3's `listDeletionRequests`/`resolveDeletionRequest`/`listAuditLogs`.

Pure logic (unit tested in `tests/admin`): `lib/admin/filters.ts`,
`lib/admin/csv.ts`, `lib/admin/staff-guard.ts`, `lib/analytics/*`,
`components/admin/weekly-hours.ts`, `components/admin/nav.ts`.

## Appointments

- Filters live in the URL (`q`, `status`, `doctorId`, `visitType`, `from`, `to`,
  `sort`, `page`, `pageSize`); the filter form is a plain GET form. Dates are
  **UTC days**, inclusive.
- Status, doctor and date range are pushed to Appwrite (indexed attributes).
  Free text (patient name, physician, reason) and visit type are matched in
  memory over a scan of at most **2000** rows, because patient names live on a
  related document and Appwrite has no cross-document search. When that cap is
  hit the page says so.
- Doctor role scoping mirrors `getRecentAppointmentList`: only the doctors
  document with their `staffUserId`; none linked => empty; a `doctorId` filter is
  ignored for them.
- Only name, email and phone of the patient reach the browser (encrypted/medical
  patient fields are stripped server-side).
- Sort: date column cycles ascending, descending, default (newest created).
  Header carries `aria-sort`.
- Bulk confirm/cancel (max 50, loops server-side through `updateAppointment`, so
  slots, SMS/notifications and per-item audit behave as in the single flow).
  Past or conflicting items are reported per item, never abort the batch.
  Cancel needs a reason. Results are announced in a live region.
- CSV: admin/frontdesk only, max **5000** rows. Columns: appointment id,
  scheduled (UTC), status, doctor, visit type, patient name, cancelled by,
  created. No contact details, reason, notes, cancellation reason or medical
  fields. Text cells starting with `= + - @` (or tab/CR) get a leading `'`.
  Each export is audited (`appointment.export`, awaited) before data is returned.
- Detail drawer: contact, reason, notes, doctor, derived history (requested /
  reminder / last changed), video-visit link (`getVisitLink`), and
  `PreVisitSummary`.
- `AutoRefresh`: `router.refresh()` every 30 s while the tab is visible, not
  paused and no dialog open; shows "Updated hh:mm" and Pause/Resume. To move to
  Appwrite Realtime later: add the client SDK, subscribe to
  `databases.<db>.collections.<appointments>.documents` in an effect, and call
  `router.refresh()` from the callback (debounced); keep the Pause control.

## Doctors and schedule

Weekly-hours editor validates like the server (HH:MM, start < end, no overlaps,
<= 6 ranges/day) before saving. Time off calls `addTimeOff`; if bookings
overlap (`conflictingAppointments` > 0) the overlapping appointments are listed
and can be cancelled in one step (reason required). Removing time off re-saves
the list via `upsertDoctor`. Doctors (role) edit only hours, slot length,
timezone and time off on their own profile (F2 enforces this server-side).
Time-off inputs use the browser timezone.

## Staff

Chosen approach: **generated one-time password**, returned once in the
`createStaff` / `resetStaffPassword` response and shown once in the UI (never
stored or logged). Appwrite password recovery was not used because it needs SMTP
and a public reset page that do not exist yet. There is no in-app "change my
password" page yet, so use "New password" to rotate.

Rules (`checkStaffChange`): only accounts that already carry a role label can be
managed (a patient can never be promoted here); you cannot change your own role
or disable yourself; the last enabled admin cannot be demoted or disabled. All
changes are audited (`staff.*`, target id and role only).
Role changes apply at the user's next login (role is baked into the 8 h token);
disabling blocks new logins but an open session lives until it expires or
`ADMIN_SESSION_SECRET` is rotated. The UI says so. Listing uses label queries
and falls back to a bounded scan (2000 users) if the server rejects them.

## Privacy and audit

Approval of a deletion request is irreversible: the dialog lists what is
deleted and what is retained (from `docs/compliance.md`) and requires typing the
request id. Patient name is shown for pending requests (name only). The audit
page filters by action, actor and UTC dates, 25 per page; viewing is itself
audited by F3.

## Analytics

`getAnalytics` reads at most **5000** appointments for a window of at most 93
days and says when truncated. Metrics: cancellation rate, lead-time
distribution and median, utilization per doctor (non-cancelled bookings /
slots from weekly hours minus time off, via the scheduling engine), peak-hours
heatmap (weekday x hour in the clinic's most common doctor timezone), status
funnel, current waitlist size. Each chart has a "View as table" alternative.

**No-show caveat**: the app records no attendance, so a real no-show rate is not
measurable. The "no-show proxy" is past, non-cancelled appointments still
`pending` (never confirmed) as a share of past non-cancelled appointments.
Adding an attendance status would make this exact.

## Accessibility

Skip link, header/nav/main landmarks, `aria-current` nav, captioned tables with
`scope` and `aria-sort`, labelled checkboxes, Radix dialogs (focus trap and
return), live regions for bulk/export/save results, tables scroll horizontally
on narrow screens, buttons >= 36-44 px high, black text on green/red buttons for
contrast. Not verified with a screen reader or automated audit.

## Caveats

- Status filter chips and stat cards use status names "scheduled" / "pending" /
  "cancelled"; "Confirm" sets `scheduled`.
- Date filters and analytics ranges are UTC days; table times render in the
  viewer's timezone after hydration.
- The schedule form (U1's `AppointmentForm`) still lists the static `Doctors`
  constant; bulk actions do not depend on it.
- The doctor filter lists active doctors only (public `listDoctors`).
- Nothing here was run against a live Appwrite project or in a browser.
