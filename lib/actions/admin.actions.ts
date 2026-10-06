"use server";

import { revalidatePath } from "next/cache";
import { ID, Models, Query } from "node-appwrite";
import { z } from "zod";

import { updateAppointment } from "@/lib/actions/appointment.actions";
import {
  listDeletionRequests,
  type DeletionRequestRow,
} from "@/lib/actions/compliance.actions";
import { toCsv } from "@/lib/admin/csv";
import {
  type AppointmentFilters,
  dateRangeBounds,
  matchesQuery,
  normalizeAppointmentFilters,
  parseDateParam,
} from "@/lib/admin/filters";
import { generatePassword } from "@/lib/admin/password";
import {
  countWaitlist,
  queryAppointmentsPage,
  scanAppointments,
  slimPatient,
} from "@/lib/admin/scan";
import {
  checkStaffChange,
  type StaffChange,
  type StaffTarget,
} from "@/lib/admin/staff-guard";
import { buildAnalyticsReport, type AnalyticsReport } from "@/lib/analytics/report";
import * as appointmentRepo from "@/lib/appwrite/appointment.repository";
import { getClients, isNotFound } from "@/lib/appwrite/client";
import * as doctorRepo from "@/lib/appwrite/doctor.repository";
import * as patientRepo from "@/lib/appwrite/patient.repository";
import { AdminAuthError, requireRole, type StaffSession } from "@/lib/auth/admin";
import { isRole, type Role, ROLES, roleFromLabels } from "@/lib/auth/roles";
import { recordAudit } from "@/lib/compliance/audit";
import { auditSafe } from "@/lib/scheduling/audit";
import {
  parseTimeOff,
  parseWeeklyHours,
  toDoctorSchedule,
} from "@/lib/scheduling/schedule";
import { MINUTE_MS } from "@/lib/scheduling/time";
import { parseStringify } from "@/lib/utils";
import { IdSchema } from "@/lib/validation";
import type { Appointment, Doctor } from "@/types/appwrite.types";

// ---------------------------------------------------------------------------
// Shared plumbing
// ---------------------------------------------------------------------------

export type AppointmentSearchInput = {
  q?: string;
  status?: Status;
  doctorId?: string;
  from?: string;
  to?: string;
  visitType?: VisitType;
  sort?: "created_desc" | "schedule_asc" | "schedule_desc";
  page?: number;
  pageSize?: number;
};

const fail = (error: string): { ok: false; error: string } => ({
  ok: false,
  error,
});

const GENERIC = "Something went wrong. Please try again.";

const errorInfo = (error: unknown) => ({
  name: (error as { name?: string } | null)?.name ?? "Error",
  code: (error as { code?: number | string } | null)?.code ?? null,
});

/** Never logs messages (they can echo PII); name + code only. */
const handleError = (
  error: unknown,
  action: string
): { ok: false; error: string } => {
  if (error instanceof AdminAuthError) {
    auditSafe({
      actorId: null,
      actorRole: "anonymous",
      action,
      resource: "admin",
      outcome: "denied",
    });
    return fail(error.message === "Forbidden" ? "Forbidden" : "Unauthorized");
  }
  console.error(`[admin] ${action} failed`, errorInfo(error));
  return fail(GENERIC);
};

/** Awaited (unlike auditSafe) so the record exists before data leaves the server. */
const audit = (
  staff: StaffSession,
  action: string,
  resource: string,
  resourceId?: string,
  meta?: Record<string, unknown>
) =>
  recordAudit({
    actorId: staff.userId,
    actorRole: staff.role,
    action,
    resource,
    resourceId,
    meta,
  });

/** doctors document id for a `doctor`-role staff member, or null. */
const doctorIdForStaff = async (staff: StaffSession): Promise<string | null> => {
  try {
    const doc = await doctorRepo.findDoctorByStaffUserId(staff.userId);
    return doc ? doc.$id : null;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
};

const SEARCH_SCAN_CAP = 2000;
const EXPORT_CAP = 5000;
const ANALYTICS_SCAN_CAP = 5000;
const MAX_ANALYTICS_DAYS = 93;
const MAX_BULK = 50;
const MAX_PAGE_SIZE = 50;

const toAppointmentView = (doc: Appointment): Appointment =>
  ({
    ...doc,
    // Only contact basics reach the UI; encrypted/medical fields are dropped.
    patient: slimPatient((doc as { patient?: unknown }).patient),
  }) as unknown as Appointment;

const patientNameOf = (doc: Appointment) =>
  ((doc as { patient?: { name?: string } | null }).patient?.name ?? "") || null;

const passesInMemoryFilters = (doc: Appointment, filters: AppointmentFilters) => {
  if (filters.visitType && (doc.visitType ?? "in_person") !== filters.visitType) {
    return false;
  }
  return matchesQuery(
    {
      patientName: patientNameOf(doc),
      primaryPhysician: doc.primaryPhysician,
      reason: doc.reason,
    },
    filters.q
  );
};

const needsInMemoryFilter = (filters: AppointmentFilters) =>
  Boolean(filters.q || filters.visitType);

// ---------------------------------------------------------------------------
// Appointments: search
// ---------------------------------------------------------------------------

export type AppointmentSearchResult = RecentAppointmentList & {
  /** Rows matching the current filters (totalCount is the unfiltered total). */
  matchCount: number;
  /** True when a text / visit-type search hit the scan cap. */
  truncated: boolean;
  scanCap: number;
  scope: "all" | "own";
};

const emptyResult = (
  page: number,
  pageSize: number,
  scope: "all" | "own"
): AppointmentSearchResult => ({
  totalCount: 0,
  scheduledCount: 0,
  pendingCount: 0,
  cancelledCount: 0,
  documents: [],
  page,
  pageSize,
  totalPages: 1,
  matchCount: 0,
  truncated: false,
  scanCap: SEARCH_SCAN_CAP,
  scope,
});

/**
 * Searchable, filterable appointment list. Same shape as
 * getRecentAppointmentList plus match info. A `doctor` only ever sees their own
 * appointments (doctorId match; no linked doctors document => empty), exactly
 * like getRecentAppointmentList, and any doctorId filter they pass is ignored.
 *
 * Status, doctor and date range are pushed to the database (indexed). Free
 * text (patient name, physician, reason) and visit type are matched in memory
 * over a capped scan because patient names live on a related document and
 * Appwrite has no cross-document search.
 */
export const searchAppointments = async (
  input: AppointmentSearchInput = {}
): Promise<ActionResult<AppointmentSearchResult>> => {
  try {
    const staff = await requireRole("admin", "frontdesk", "doctor");

    const filters = normalizeAppointmentFilters(input);
    const pageSize = Math.min(MAX_PAGE_SIZE, filters.pageSize);
    const page = filters.page;

    let scopeDoctorId: string | undefined;
    if (staff.role === "doctor") {
      const own = await doctorIdForStaff(staff);
      if (!own) return { ok: true, data: emptyResult(page, pageSize, "own") };
      scopeDoctorId = own;
    }
    const doctorId = scopeDoctorId ?? filters.doctorId;
    const { fromIso, toIso } = dateRangeBounds(filters);
    const readFilter = {
      status: filters.status,
      doctorId,
      fromIso,
      toIso,
      sort: filters.sort,
    };
    const offset = (page - 1) * pageSize;

    const countsPromise = Promise.all([
      appointmentRepo.countAppointments(undefined, scopeDoctorId),
      appointmentRepo.countAppointments("scheduled", scopeDoctorId),
      appointmentRepo.countAppointments("pending", scopeDoctorId),
      appointmentRepo.countAppointments("cancelled", scopeDoctorId),
    ]);

    let documents: Appointment[];
    let matchCount: number;
    let truncated = false;

    if (needsInMemoryFilter(filters)) {
      const scan = await scanAppointments(readFilter, { cap: SEARCH_SCAN_CAP });
      const matched = scan.documents.filter((doc) =>
        passesInMemoryFilters(doc, filters)
      );
      matchCount = matched.length;
      documents = matched.slice(offset, offset + pageSize);
      truncated = scan.truncated;
    } else {
      const result = await queryAppointmentsPage(readFilter, {
        limit: pageSize,
        offset,
      });
      documents = result.documents;
      matchCount = result.total;
    }

    const [totalCount, scheduledCount, pendingCount, cancelledCount] =
      await countsPromise;

    auditSafe({
      actorId: staff.userId,
      actorRole: staff.role,
      action: "appointment.list",
      resource: "appointment",
      meta: { page, count: documents.length },
    });

    return {
      ok: true,
      data: parseStringify({
        totalCount,
        scheduledCount,
        pendingCount,
        cancelledCount,
        documents: documents.map(toAppointmentView),
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(matchCount / pageSize)),
        matchCount,
        truncated,
        scanCap: SEARCH_SCAN_CAP,
        scope: scopeDoctorId ? "own" : "all",
      }),
    };
  } catch (error) {
    return handleError(error, "appointment.list");
  }
};

// ---------------------------------------------------------------------------
// Appointments: CSV export
// ---------------------------------------------------------------------------

export type AppointmentsCsv = {
  filename: string;
  csv: string;
  rowCount: number;
  /** True when more rows matched than the export cap allows. */
  truncated: boolean;
  cap: number;
};

type ExportRow = {
  id: string;
  schedule: string;
  status: string;
  doctor: string;
  visitType: string;
  patient: string;
  cancelledBy: string;
  createdAt: string;
};

const EXPORT_COLUMNS = [
  { header: "Appointment ID", value: (r: ExportRow) => r.id },
  { header: "Scheduled (UTC)", value: (r: ExportRow) => r.schedule },
  { header: "Status", value: (r: ExportRow) => r.status },
  { header: "Doctor", value: (r: ExportRow) => r.doctor },
  { header: "Visit type", value: (r: ExportRow) => r.visitType },
  { header: "Patient", value: (r: ExportRow) => r.patient },
  { header: "Cancelled by", value: (r: ExportRow) => r.cancelledBy },
  { header: "Created (UTC)", value: (r: ExportRow) => r.createdAt },
];

const isoOrEmpty = (value: unknown) => {
  const t = Date.parse(String(value ?? ""));
  return Number.isNaN(t) ? "" : new Date(t).toISOString();
};

/**
 * Admin and front desk only. Honours the same filters as the list (not paging),
 * capped at 5000 rows. Columns are deliberately limited to scheduling facts
 * plus the patient's name: no contact details, reason, notes, cancellation
 * reason or any medical field. Text cells are CSV-injection safe. Every export
 * is audited (awaited) before the data is returned.
 */
export const exportAppointmentsCsv = async (
  input: AppointmentSearchInput = {}
): Promise<ActionResult<AppointmentsCsv>> => {
  try {
    const staff = await requireRole("admin", "frontdesk");
    const filters = normalizeAppointmentFilters(input);
    const { fromIso, toIso } = dateRangeBounds(filters);

    const scan = await scanAppointments(
      {
        status: filters.status,
        doctorId: filters.doctorId,
        fromIso,
        toIso,
        sort: filters.sort,
      },
      { cap: EXPORT_CAP }
    );
    const matched = scan.documents.filter((doc) =>
      passesInMemoryFilters(doc, filters)
    );

    const rows: ExportRow[] = matched.map((doc) => ({
      id: doc.$id,
      schedule: isoOrEmpty(doc.schedule),
      status: doc.status,
      doctor: doc.primaryPhysician ?? "",
      visitType: doc.visitType ?? "in_person",
      patient: patientNameOf(doc) ?? "",
      cancelledBy: doc.cancelledBy ?? "",
      createdAt: isoOrEmpty(doc.$createdAt),
    }));

    await audit(staff, "appointment.export", "appointment", undefined, {
      count: rows.length,
      status: filters.status ?? "all",
    });

    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    return {
      ok: true,
      data: {
        filename: `appointments-${stamp}.csv`,
        csv: toCsv(EXPORT_COLUMNS, rows),
        rowCount: rows.length,
        truncated: scan.truncated,
        cap: EXPORT_CAP,
      },
    };
  } catch (error) {
    return handleError(error, "appointment.export");
  }
};

// ---------------------------------------------------------------------------
// Appointments: bulk confirm / cancel
// ---------------------------------------------------------------------------

export type BulkItemResult = {
  id: string;
  patientName: string | null;
  status: "ok" | "skipped" | "failed";
  message?: string;
};

export type BulkResult = {
  action: "confirm" | "cancel";
  succeeded: number;
  skipped: number;
  failed: number;
  results: BulkItemResult[];
};

const BulkSchema = z.object({
  ids: z.array(IdSchema).min(1, "Select at least one appointment").max(MAX_BULK),
  action: z.enum(["confirm", "cancel"]),
  reason: z.string().trim().max(500).optional(),
});

/**
 * Confirms or cancels several appointments, one at a time, through
 * `updateAppointment` (so slot handling, doctor scoping, SMS and per-item
 * audit are identical to the single-item flow). Returns a per-item summary;
 * one failure never stops the rest. Cancelling needs a reason (2-500 chars).
 */
export const bulkUpdateAppointments = async (input: {
  ids: string[];
  action: "confirm" | "cancel";
  reason?: string;
}): Promise<ActionResult<BulkResult>> => {
  try {
    const staff = await requireRole("admin", "frontdesk", "doctor");

    const parsed = BulkSchema.safeParse(input);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid request");
    }
    const { action, reason } = parsed.data;
    if (action === "cancel" && (!reason || reason.length < 2)) {
      return fail("A cancellation reason (at least 2 characters) is required");
    }
    const ids = Array.from(new Set(parsed.data.ids));

    const ownDoctorId =
      staff.role === "doctor" ? await doctorIdForStaff(staff) : null;

    const results: BulkItemResult[] = [];
    for (const id of ids) {
      let patientName: string | null = null;
      try {
        const existing = await appointmentRepo.getAppointmentDocument(id);
        patientName = patientNameOf(existing);

        if (staff.role === "doctor" && (!ownDoctorId || existing.doctorId !== ownDoctorId)) {
          results.push({ id, patientName: null, status: "failed", message: "Appointment not found" });
          continue;
        }
        if (action === "cancel" && existing.status === "cancelled") {
          results.push({ id, patientName, status: "skipped", message: "Already cancelled" });
          continue;
        }
        if (action === "confirm" && existing.status === "scheduled") {
          results.push({ id, patientName, status: "skipped", message: "Already scheduled" });
          continue;
        }

        const outcome = await updateAppointment({
          appointmentId: id,
          userId: existing.userId,
          appointment: {
            primaryPhysician: existing.primaryPhysician,
            schedule: new Date(existing.schedule),
            ...(action === "cancel" ? { cancellationReason: reason } : {}),
          },
          type: action === "cancel" ? "cancel" : "schedule",
        });
        results.push(
          outcome.ok
            ? { id, patientName, status: "ok" }
            : { id, patientName, status: "failed", message: outcome.error }
        );
      } catch (error) {
        results.push({
          id,
          patientName,
          status: "failed",
          message: isNotFound(error) ? "Appointment not found" : GENERIC,
        });
      }
    }

    const succeeded = results.filter((r) => r.status === "ok").length;
    const failed = results.filter((r) => r.status === "failed").length;
    const skipped = results.length - succeeded - failed;

    await audit(staff, "appointment.bulk_update", "appointment", undefined, {
      count: succeeded,
      errors: failed,
      status: action === "cancel" ? "cancelled" : "scheduled",
    });

    revalidatePath("/admin");
    revalidatePath("/admin/schedule");
    return { ok: true, data: { action, succeeded, skipped, failed, results } };
  } catch (error) {
    return handleError(error, "appointment.bulk_update");
  }
};

// ---------------------------------------------------------------------------
// Doctors (admin console)
// ---------------------------------------------------------------------------

export type AdminDoctor = {
  id: string;
  name: string;
  specialty: string;
  image: string;
  email: string | null;
  staffUserId: string | null;
  active: boolean;
  slotMinutes: number;
  timezone: string;
  weeklyHours: WeeklyHours;
  timeOff: TimeOffEntry[];
};

const toAdminDoctor = (doc: Doctor): AdminDoctor => {
  const schedule = toDoctorSchedule(doc);
  return {
    id: doc.$id,
    name: doc.name,
    specialty: doc.specialty,
    image: doc.image,
    email: doc.email ?? null,
    staffUserId: doc.staffUserId ?? null,
    active: doc.active !== false,
    slotMinutes: schedule.slotMinutes,
    timezone: schedule.timezone,
    weeklyHours: parseWeeklyHours(doc.weeklyHours),
    timeOff: parseTimeOff(doc.timeOff),
  };
};

/** Every doctor including inactive ones, with email and staff link. Admin only. */
export const listAllDoctors = async (): Promise<ActionResult<AdminDoctor[]>> => {
  try {
    await requireRole("admin");
    let docs: Doctor[] = [];
    try {
      docs = await doctorRepo.listDoctors({ limit: 100 });
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
    return { ok: true, data: parseStringify(docs.map(toAdminDoctor)) };
  } catch (error) {
    return handleError(error, "doctor.list_all");
  }
};

/** The doctors document linked to the signed-in `doctor` user, or null. */
export const getOwnDoctor = async (): Promise<ActionResult<AdminDoctor | null>> => {
  try {
    const staff = await requireRole("doctor");
    try {
      const doc = await doctorRepo.findDoctorByStaffUserId(staff.userId);
      return { ok: true, data: doc ? parseStringify(toAdminDoctor(doc)) : null };
    } catch (error) {
      if (isNotFound(error)) return { ok: true, data: null };
      throw error;
    }
  } catch (error) {
    return handleError(error, "doctor.get_own");
  }
};

export type ConflictingAppointment = {
  id: string;
  patientName: string | null;
  schedule: string;
  status: Status;
  visitType: VisitType;
};

/**
 * Non-cancelled appointments that overlap a time-off window, so staff can
 * cancel them after addTimeOff. Admin for any doctor; a doctor only for their
 * own document.
 */
export const listConflictingAppointments = async (params: {
  doctorId: string;
  start: string;
  end: string;
}): Promise<ActionResult<ConflictingAppointment[]>> => {
  try {
    const staff = await requireRole("admin", "doctor");
    const id = IdSchema.safeParse(params?.doctorId);
    const start = new Date(params?.start);
    const end = new Date(params?.end);
    if (!id.success || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      return fail("Invalid request");
    }
    if (staff.role === "doctor" && (await doctorIdForStaff(staff)) !== id.data) {
      return fail("Forbidden");
    }

    const doc = await doctorRepo.getDoctor(id.data);
    const slotMs = toDoctorSchedule(doc).slotMinutes * MINUTE_MS;

    // By physician name so legacy appointments without a doctorId are found too.
    const scan = await scanAppointments(
      {
        primaryPhysician: doc.name,
        fromIso: new Date(start.getTime() - slotMs).toISOString(),
        toIso: end.toISOString(),
        sort: "schedule_asc",
      },
      { cap: 500 }
    );

    const conflicts = scan.documents
      .filter((appt) => {
        if (appt.status === "cancelled") return false;
        const t = Date.parse(String(appt.schedule));
        return !Number.isNaN(t) && t < end.getTime() && t + slotMs > start.getTime();
      })
      .map((appt) => ({
        id: appt.$id,
        patientName: patientNameOf(appt),
        schedule: new Date(appt.schedule).toISOString(),
        status: appt.status,
        visitType: (appt.visitType ?? "in_person") as VisitType,
      }));

    await audit(staff, "appointment.list", "appointment", undefined, {
      count: conflicts.length,
    });
    return { ok: true, data: conflicts };
  } catch (error) {
    if (isNotFound(error)) return fail("Doctor not found");
    return handleError(error, "appointment.list_conflicts");
  }
};

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

/**
 * Aggregates (no PHI) for [from, to] inclusive, both YYYY-MM-DD (UTC days),
 * window <= 93 days. Admin and front desk. Reads at most 5000 appointments;
 * `truncated` tells the UI when the cap cut the window short.
 */
export const getAnalytics = async (params: {
  from: string;
  to: string;
  doctorId?: string;
}): Promise<ActionResult<AnalyticsReport>> => {
  try {
    const staff = await requireRole("admin", "frontdesk");

    const from = parseDateParam(params?.from);
    const to = parseDateParam(params?.to);
    if (!from || !to) return fail("Choose a valid date range");
    if (from > to) return fail("The start date must be on or before the end date");
    const { fromIso, toIso } = dateRangeBounds({ from, to });
    const fromDate = new Date(fromIso as string);
    const toDate = new Date(toIso as string);
    if ((toDate.getTime() - fromDate.getTime()) / 86_400_000 > MAX_ANALYTICS_DAYS) {
      return fail(`Choose a range of at most ${MAX_ANALYTICS_DAYS} days`);
    }
    let doctorId: string | undefined;
    if (params.doctorId) {
      const parsedId = IdSchema.safeParse(params.doctorId);
      if (!parsedId.success) return fail("Invalid doctor");
      doctorId = parsedId.data;
    }

    let doctorDocs: Doctor[] = [];
    try {
      doctorDocs = await doctorRepo.listDoctors({ limit: 100 });
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
    const scoped = doctorId
      ? doctorDocs.filter((doc) => doc.$id === doctorId)
      : doctorDocs;
    const idByName = new Map(doctorDocs.map((doc) => [doc.name, doc.$id]));

    const scan = await scanAppointments(
      { doctorId, fromIso, toIso, sort: "schedule_asc" },
      { cap: ANALYTICS_SCAN_CAP, lean: true }
    );

    // Waitlist is a current snapshot, not range-bound.
    let waiting = 0;
    let offered = 0;
    for (let i = 0; i < scoped.length; i += 10) {
      const chunk = scoped.slice(i, i + 10);
      const counts = await Promise.all(
        chunk.map(async (doc) => [
          await countWaitlist(doc.$id, "waiting"),
          await countWaitlist(doc.$id, "offered"),
        ])
      );
      for (const [w, o] of counts) {
        waiting += w;
        offered += o;
      }
    }

    const report = buildAnalyticsReport({
      appointments: scan.documents.map((doc) => ({
        status: doc.status,
        schedule: String(doc.schedule),
        createdAt: String(doc.$createdAt),
        doctorId:
          doc.doctorId ?? idByName.get(doc.primaryPhysician) ?? null,
      })),
      doctors: scoped.map((doc) => ({
        name: doc.name,
        schedule: toDoctorSchedule(doc),
      })),
      from: fromDate,
      to: toDate,
      now: new Date(),
      waitlist: { waiting, offered },
      truncated: scan.truncated,
      scanCap: ANALYTICS_SCAN_CAP,
    });

    await audit(staff, "analytics.view", "analytics", undefined, {
      count: report.scanned,
    });
    return { ok: true, data: parseStringify(report) };
  } catch (error) {
    return handleError(error, "analytics.view");
  }
};

// ---------------------------------------------------------------------------
// Staff management (Appwrite Users API). Admin only, all audited.
// ---------------------------------------------------------------------------

export type StaffMember = {
  id: string;
  name: string;
  email: string;
  role: Role | null;
  blocked: boolean;
  mfa: boolean;
  lastAccess: string | null;
  createdAt: string;
};

type AppwriteUser = Models.User<Models.Preferences>;

const toStaffMember = (user: AppwriteUser): StaffMember => ({
  id: user.$id,
  name: user.name,
  email: user.email,
  role: roleFromLabels(user.labels),
  blocked: user.status === false,
  mfa: user.mfa === true,
  lastAccess: user.accessedAt || null,
  createdAt: user.registration,
});

const USER_PAGE = 100;
const USER_SCAN_PAGES = 20;

/** Users that carry a staff role label (patients never do). */
const fetchStaffUsers = async (): Promise<AppwriteUser[]> => {
  const { users } = getClients();
  const found = new Map<string, AppwriteUser>();
  try {
    for (const role of ROLES) {
      const result = await users.list<Models.Preferences>([
        Query.equal("labels", [role]),
        Query.limit(USER_PAGE),
      ]);
      for (const user of result.users) found.set(user.$id, user);
    }
    return Array.from(found.values());
  } catch (error) {
    if ((error as { code?: number } | null)?.code !== 400) throw error;
  }

  // Server rejected label queries: bounded scan of all users instead.
  found.clear();
  let cursor: string | undefined;
  for (let page = 0; page < USER_SCAN_PAGES; page += 1) {
    const queries = [Query.limit(USER_PAGE)];
    if (cursor) queries.push(Query.cursorAfter(cursor));
    const result = await users.list<Models.Preferences>(queries);
    for (const user of result.users) {
      if (roleFromLabels(user.labels)) found.set(user.$id, user);
    }
    if (result.users.length < USER_PAGE) break;
    cursor = result.users[result.users.length - 1].$id;
  }
  return Array.from(found.values());
};

const sortStaff = (members: StaffMember[]) =>
  members.sort(
    (a, b) =>
      ROLES.indexOf((a.role ?? "doctor") as Role) -
        ROLES.indexOf((b.role ?? "doctor") as Role) ||
      a.name.localeCompare(b.name)
  );

export const listStaff = async (): Promise<ActionResult<StaffMember[]>> => {
  try {
    const staff = await requireRole("admin");
    const members = sortStaff((await fetchStaffUsers()).map(toStaffMember));
    await audit(staff, "staff.list", "staff", undefined, { count: members.length });
    return { ok: true, data: parseStringify(members) };
  } catch (error) {
    return handleError(error, "staff.list");
  }
};

const CreateStaffSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(200),
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(128),
  role: z.enum(ROLES),
});

/**
 * Creates an Appwrite user with the role label and a generated password that is
 * returned ONCE in this response (never stored or logged). Chosen over
 * Appwrite password recovery because recovery needs SMTP and a public reset
 * page, neither of which exists yet; the admin hands the password over
 * securely and can issue a fresh one with resetStaffPassword.
 */
export const createStaff = async (input: {
  email: string;
  name: string;
  role: Role;
}): Promise<ActionResult<{ staff: StaffMember; password: string }>> => {
  try {
    const actor = await requireRole("admin");
    const parsed = CreateStaffSchema.safeParse(input);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid request");
    }
    const { email, name, role } = parsed.data;

    const { users } = getClients();
    const password = generatePassword();
    let user: AppwriteUser;
    try {
      user = await users.create<Models.Preferences>(
        ID.unique(),
        email,
        undefined,
        password,
        name
      );
    } catch (error) {
      if ((error as { code?: number } | null)?.code === 409) {
        return fail("A user with that email already exists");
      }
      throw error;
    }

    try {
      user = await users.updateLabels<Models.Preferences>(user.$id, [role]);
    } catch (error) {
      // No half-created accounts: without the label the user is not staff.
      await users.delete(user.$id).catch(() => undefined);
      throw error;
    }

    await audit(actor, "staff.create", "staff", user.$id, { status: role });
    return {
      ok: true,
      data: { staff: parseStringify(toStaffMember(user)), password },
    };
  } catch (error) {
    return handleError(error, "staff.create");
  }
};

type StaffContext = {
  actor: StaffSession;
  user: AppwriteUser;
  target: StaffTarget;
};

/** Loads the target and runs the guard rules for a change. */
const guardedStaffChange = async (
  userId: unknown,
  change: StaffChange
): Promise<
  { ok: true; ctx: StaffContext } | { ok: false; error: string }
> => {
  const actor = await requireRole("admin");
  const id = IdSchema.safeParse(userId);
  if (!id.success) return fail("Invalid user");

  let user: AppwriteUser;
  try {
    user = await getClients().users.get<Models.Preferences>(id.data);
  } catch (error) {
    if (isNotFound(error)) return fail("User not found");
    throw error;
  }

  const target: StaffTarget = {
    id: user.$id,
    role: roleFromLabels(user.labels),
    blocked: user.status === false,
  };
  const activeAdminIds = (await fetchStaffUsers())
    .filter((u) => roleFromLabels(u.labels) === "admin" && u.status !== false)
    .map((u) => u.$id);

  const verdict = checkStaffChange({
    actorId: actor.userId,
    target,
    change,
    activeAdminIds,
  });
  if (!verdict.ok) {
    await audit(actor, `staff.${change.type}`, "staff", user.$id, {
      status: "rejected",
    });
    return fail(verdict.error);
  }
  return { ok: true, ctx: { actor, user, target } };
};

/** Takes effect at that user's next login: the role is baked into the 8h staff token. */
export const setStaffRole = async (input: {
  userId: string;
  role: Role;
}): Promise<ActionResult<StaffMember>> => {
  try {
    if (!isRole(input?.role)) {
      await requireRole("admin");
      return fail("Unknown role");
    }
    const guarded = await guardedStaffChange(input.userId, {
      type: "set_role",
      role: input.role,
    });
    if (!guarded.ok) return guarded;
    const { actor, user } = guarded.ctx;

    const labels = [...user.labels.filter((l) => !isRole(l)), input.role];
    const updated = await getClients().users.updateLabels<Models.Preferences>(
      user.$id,
      labels
    );
    await audit(actor, "staff.set_role", "staff", user.$id, { status: input.role });
    revalidatePath("/admin/staff");
    return { ok: true, data: parseStringify(toStaffMember(updated)) };
  } catch (error) {
    return handleError(error, "staff.set_role");
  }
};

/**
 * Blocks the Appwrite user (login is refused). An already issued staff cookie
 * stays valid until it expires (up to 8h) or ADMIN_SESSION_SECRET is rotated.
 */
export const disableStaff = async (input: {
  userId: string;
}): Promise<ActionResult<StaffMember>> => {
  try {
    const guarded = await guardedStaffChange(input?.userId, { type: "disable" });
    if (!guarded.ok) return guarded;
    const { actor, user } = guarded.ctx;
    const updated = await getClients().users.updateStatus<Models.Preferences>(
      user.$id,
      false
    );
    await audit(actor, "staff.disable", "staff", user.$id);
    revalidatePath("/admin/staff");
    return { ok: true, data: parseStringify(toStaffMember(updated)) };
  } catch (error) {
    return handleError(error, "staff.disable");
  }
};

export const enableStaff = async (input: {
  userId: string;
}): Promise<ActionResult<StaffMember>> => {
  try {
    const guarded = await guardedStaffChange(input?.userId, { type: "enable" });
    if (!guarded.ok) return guarded;
    const { actor, user } = guarded.ctx;
    const updated = await getClients().users.updateStatus<Models.Preferences>(
      user.$id,
      true
    );
    await audit(actor, "staff.enable", "staff", user.$id);
    revalidatePath("/admin/staff");
    return { ok: true, data: parseStringify(toStaffMember(updated)) };
  } catch (error) {
    return handleError(error, "staff.enable");
  }
};

/** New one-time password, returned once. Existing sessions are not revoked. */
export const resetStaffPassword = async (input: {
  userId: string;
}): Promise<ActionResult<{ staff: StaffMember; password: string }>> => {
  try {
    const guarded = await guardedStaffChange(input?.userId, {
      type: "reset_password",
    });
    if (!guarded.ok) return guarded;
    const { actor, user } = guarded.ctx;
    const password = generatePassword();
    const updated = await getClients().users.updatePassword<Models.Preferences>(
      user.$id,
      password
    );
    await audit(actor, "staff.reset_password", "staff", user.$id);
    return {
      ok: true,
      data: { staff: parseStringify(toStaffMember(updated)), password },
    };
  } catch (error) {
    return handleError(error, "staff.reset_password");
  }
};

// ---------------------------------------------------------------------------
// Privacy requests (names for the confirmation step)
// ---------------------------------------------------------------------------

export type DeletionRequestWithName = DeletionRequestRow & {
  patientName: string | null;
};

/**
 * listDeletionRequests plus the patient's name (name only, no other PHI) so the
 * admin can type it to confirm an irreversible erasure. Admin only.
 */
export const listDeletionRequestsWithNames = async (): Promise<
  ActionResult<DeletionRequestWithName[]>
> => {
  try {
    await requireRole("admin");
    const listed = await listDeletionRequests();
    if (!listed.ok) return listed;

    const names = new Map<string, string | null>();
    for (const row of listed.data) {
      if (row.status !== "pending" || names.has(row.userId)) continue;
      try {
        const patient = await patientRepo.getPatientByUserId(row.userId, {
          decrypt: false,
        });
        const name = (patient as { name?: string } | null)?.name;
        names.set(row.userId, typeof name === "string" ? name : null);
      } catch {
        names.set(row.userId, null);
      }
    }
    return {
      ok: true,
      data: listed.data.map((row) => ({
        ...row,
        patientName: names.get(row.userId) ?? null,
      })),
    };
  } catch (error) {
    return handleError(error, "deletion.list");
  }
};
