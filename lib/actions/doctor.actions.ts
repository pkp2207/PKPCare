"use server";

import { revalidatePath } from "next/cache";

import {
  DEFAULT_SLOT_MINUTES,
  DEFAULT_TIMEZONE,
  DEFAULT_WEEKLY_HOURS,
  MAX_TIME_OFF_ENTRIES,
} from "@/constants";
import * as appointmentRepo from "@/lib/appwrite/appointment.repository";
import { isNotFound, toUserMessage } from "@/lib/appwrite/client";
import * as doctorRepo from "@/lib/appwrite/doctor.repository";
import * as slotRepo from "@/lib/appwrite/slot.repository";
import { AdminAuthError, requireRole, StaffSession } from "@/lib/auth/admin";
import { auditSafe } from "@/lib/scheduling/audit";
import {
  doctorsNotConfigured,
  fallbackPublicDoctors,
  resolveDoctorById,
} from "@/lib/scheduling/doctors";
import {
  BusyInterval,
  computeAvailability,
  parseTimeOff,
} from "@/lib/scheduling/schedule";
import { DAY_MS, MINUTE_MS } from "@/lib/scheduling/time";
import { parseStringify } from "@/lib/utils";
import {
  AddTimeOffSchema,
  AvailabilitySchema,
  SetDoctorActiveSchema,
  UpsertDoctorSchema,
} from "@/lib/validation";
import { Doctor } from "@/types/appwrite.types";

const fail = (error: string): { ok: false; error: string } => ({
  ok: false,
  error,
});

const firstIssue = (error: { issues: { message: string }[] }) =>
  error.issues[0]?.message ?? "Invalid input";

const TIME_OFF_RETENTION_MS = 30 * DAY_MS;

const handleError = (
  error: unknown,
  action: string,
  notFound = "Doctor not found"
): { ok: false; error: string } => {
  if (error instanceof AdminAuthError) {
    auditSafe({
      actorId: null,
      actorRole: "anonymous",
      action,
      resource: "doctor",
      outcome: "denied",
    });
    return fail(error.message === "Forbidden" ? "Forbidden" : "Unauthorized");
  }
  console.error(`An error occurred during ${action}:`, error);
  return fail(toUserMessage(error, notFound));
};

const toPublicDoctor = (doc: Doctor): PublicDoctor => ({
  id: doc.$id,
  name: doc.name,
  specialty: doc.specialty,
  image: doc.image,
  slotMinutes: doc.slotMinutes,
  timezone: doc.timezone,
});

/** Own doctors document for a `doctor`-role session, or null. */
const ownDoctor = async (staff: StaffSession) => {
  try {
    return await doctorRepo.findDoctorByStaffUserId(staff.userId);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
};

/**
 * Admin may act on any doctor; a doctor only on the document whose staffUserId
 * is their own. Returns a denial message or null when allowed.
 */
const authorizeDoctorEdit = async (
  staff: StaffSession,
  doctorId: string | undefined
): Promise<string | null> => {
  if (staff.role === "admin") return null;
  const own = await ownDoctor(staff);
  if (!own || (doctorId !== undefined && doctorId !== own.$id)) {
    return "Forbidden";
  }
  return null;
};

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

/** Active doctors, public fields only (never email / staffUserId). */
export const listDoctors = async (): Promise<ActionResult<PublicDoctor[]>> => {
  try {
    let docs: Doctor[] | null = null;
    try {
      docs = await doctorRepo.listDoctors({ activeOnly: true });
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }

    // Collection missing or never populated: serve the static list so the
    // booking form keeps working before scripts/appwrite-setup.mjs runs.
    if (!docs || (docs.length === 0 && (await doctorsNotConfigured()))) {
      return { ok: true, data: fallbackPublicDoctors() };
    }
    return { ok: true, data: parseStringify(docs.map(toPublicDoctor)) };
  } catch (error) {
    return handleError(error, "doctor.list");
  }
};

/** Open slots for a doctor in [from, to) (max 14 days), as ISO strings. */
export const getAvailability = async (
  params: AvailabilityParams
): Promise<ActionResult<AvailabilitySlot[]>> => {
  try {
    const parsed = AvailabilitySchema.safeParse(params);
    if (!parsed.success) return fail(firstIssue(parsed.error));
    const { doctorId, from, to } = parsed.data;

    const resolved = await resolveDoctorById(doctorId);
    if (!resolved || !resolved.doc.active) return fail("Doctor not found");

    const { schedule } = resolved;
    const slotMs = schedule.slotMinutes * MINUTE_MS;
    const lookFrom = new Date(from.getTime() - slotMs);

    const [slots, legacyTimes] = await Promise.all([
      slotRepo.listSlots(doctorId, lookFrom, to),
      appointmentRepo.listActiveScheduleTimes(resolved.name, lookFrom, to),
    ]);

    const busy: BusyInterval[] = [
      ...slots.map((slot) => ({
        start: Date.parse(slot.start),
        end: Date.parse(slot.end),
      })),
      // Appointments without a slot document (legacy) still block their time.
      ...legacyTimes.map((time) => ({
        start: Date.parse(time),
        end: Date.parse(time) + slotMs,
      })),
    ].filter((b) => !Number.isNaN(b.start) && !Number.isNaN(b.end));

    const open = computeAvailability({
      doctor: schedule,
      from,
      to,
      busy,
      now: new Date(),
    });

    return {
      ok: true,
      data: open.map((slot) => ({
        start: slot.start.toISOString(),
        end: slot.end.toISOString(),
      })),
    };
  } catch (error) {
    return handleError(error, "doctor.availability");
  }
};

// ---------------------------------------------------------------------------
// Admin / doctor
// ---------------------------------------------------------------------------

/**
 * Create or update a doctor. Admin: full control. Doctor role: only their own
 * document (staffUserId match) and only hours-related fields
 * (weeklyHours, slotMinutes, timezone, timeOff); everything else is ignored.
 */
export const upsertDoctor = async (
  input: UpsertDoctorParams
): Promise<ActionResult<Doctor>> => {
  try {
    const staff = await requireRole("admin", "doctor");
    const isAdmin = staff.role === "admin";

    const parsed = (
      isAdmin ? UpsertDoctorSchema : UpsertDoctorSchema.partial()
    ).safeParse(input);
    if (!parsed.success) return fail(firstIssue(parsed.error));
    const value = parsed.data;

    const denied = await authorizeDoctorEdit(staff, value.id);
    if (denied) {
      auditSafe({
        actorId: staff.userId,
        actorRole: staff.role,
        action: "doctor.upsert",
        resource: "doctor",
        resourceId: value.id,
        outcome: "denied",
      });
      return fail(denied);
    }

    let id = value.id;
    if (!isAdmin) id = (await ownDoctor(staff))?.$id;
    id = id ?? doctorRepo.generateDoctorId();

    let existing: Doctor | null = null;
    try {
      existing = await doctorRepo.getDoctor(id);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
    if (!existing && !isAdmin) return fail("Doctor not found");

    if (isAdmin && value.staffUserId) {
      const owner = await doctorRepo.findDoctorByStaffUserId(value.staffUserId);
      if (owner && owner.$id !== id) {
        return fail("That staff account is already linked to another doctor");
      }
    }

    const weeklyHours =
      value.weeklyHours !== undefined
        ? JSON.stringify(value.weeklyHours)
        : undefined;
    const timeOff =
      value.timeOff !== undefined
        ? JSON.stringify(
            value.timeOff.map((entry) => ({
              start: entry.start.toISOString(),
              end: entry.end.toISOString(),
              ...(entry.reason ? { reason: entry.reason } : {}),
            }))
          )
        : undefined;

    // Fields a doctor may change on their own document.
    const hoursPatch = {
      ...(weeklyHours !== undefined ? { weeklyHours } : {}),
      ...(timeOff !== undefined ? { timeOff } : {}),
      ...(value.slotMinutes !== undefined
        ? { slotMinutes: value.slotMinutes }
        : {}),
      ...(value.timezone !== undefined ? { timezone: value.timezone } : {}),
    };

    let saved: Doctor;
    if (existing) {
      const patch = isAdmin
        ? {
            ...hoursPatch,
            ...(value.name !== undefined ? { name: value.name } : {}),
            ...(value.specialty !== undefined
              ? { specialty: value.specialty }
              : {}),
            ...(value.image !== undefined ? { image: value.image } : {}),
            ...(value.email !== undefined ? { email: value.email } : {}),
            ...(value.staffUserId !== undefined
              ? { staffUserId: value.staffUserId }
              : {}),
            ...(value.active !== undefined ? { active: value.active } : {}),
          }
        : hoursPatch;
      saved = await doctorRepo.updateDoctor(id, patch);
    } else {
      saved = await doctorRepo.createDoctor(id, {
        name: value.name as string,
        specialty: value.specialty as string,
        image: value.image as string,
        email: value.email ?? null,
        staffUserId: value.staffUserId ?? null,
        active: value.active ?? true,
        slotMinutes: value.slotMinutes ?? DEFAULT_SLOT_MINUTES,
        timezone: value.timezone ?? DEFAULT_TIMEZONE,
        weeklyHours: weeklyHours ?? JSON.stringify(DEFAULT_WEEKLY_HOURS),
        timeOff: timeOff ?? "[]",
      });
    }

    auditSafe({
      actorId: staff.userId,
      actorRole: staff.role,
      action: "doctor.upsert",
      resource: "doctor",
      resourceId: id,
    });

    revalidatePath("/admin");
    return { ok: true, data: parseStringify(saved) };
  } catch (error) {
    return handleError(error, "doctor.upsert");
  }
};

export const setDoctorActive = async (params: {
  doctorId: string;
  active: boolean;
}): Promise<ActionResult<Doctor>> => {
  try {
    const staff = await requireRole("admin");

    const parsed = SetDoctorActiveSchema.safeParse(params);
    if (!parsed.success) return fail(firstIssue(parsed.error));

    const saved = await doctorRepo.updateDoctor(parsed.data.doctorId, {
      active: parsed.data.active,
    });

    auditSafe({
      actorId: staff.userId,
      actorRole: staff.role,
      action: "doctor.set_active",
      resource: "doctor",
      resourceId: parsed.data.doctorId,
      meta: { status: parsed.data.active ? "active" : "inactive" },
    });

    revalidatePath("/admin");
    return { ok: true, data: parseStringify(saved) };
  } catch (error) {
    return handleError(error, "doctor.set_active");
  }
};

/**
 * Block [start, end) for a doctor. Existing bookings in the window are NOT
 * cancelled; their count is returned so staff can follow up.
 */
export const addTimeOff = async (params: {
  doctorId: string;
  start: Date | string;
  end: Date | string;
  reason?: string;
}): Promise<
  ActionResult<{ timeOff: TimeOffEntry[]; conflictingAppointments: number }>
> => {
  try {
    const staff = await requireRole("admin", "doctor");

    const parsed = AddTimeOffSchema.safeParse(params);
    if (!parsed.success) return fail(firstIssue(parsed.error));
    const { doctorId, start, end, reason } = parsed.data;

    const denied = await authorizeDoctorEdit(staff, doctorId);
    if (denied) {
      auditSafe({
        actorId: staff.userId,
        actorRole: staff.role,
        action: "doctor.time_off",
        resource: "doctor",
        resourceId: doctorId,
        outcome: "denied",
      });
      return fail(denied);
    }

    const resolved = await resolveDoctorById(doctorId);
    if (!resolved) return fail("Doctor not found");

    const cutoff = Date.now() - TIME_OFF_RETENTION_MS;
    const kept = parseTimeOff(resolved.doc.timeOff).filter(
      (entry) => Date.parse(entry.end) >= cutoff
    );
    if (kept.length >= MAX_TIME_OFF_ENTRIES) {
      return fail("Too many time-off entries; remove old ones first");
    }
    const timeOff: TimeOffEntry[] = [
      ...kept,
      {
        start: start.toISOString(),
        end: end.toISOString(),
        ...(reason ? { reason } : {}),
      },
    ];

    await doctorRepo.updateDoctor(doctorId, {
      timeOff: JSON.stringify(timeOff),
    });

    const slotMs = resolved.schedule.slotMinutes * MINUTE_MS;
    const booked = await slotRepo.listSlots(
      doctorId,
      new Date(start.getTime() - slotMs),
      end
    );
    const conflictingAppointments = booked.filter(
      (slot) =>
        slot.status === "booked" &&
        Date.parse(slot.start) < end.getTime() &&
        Date.parse(slot.end) > start.getTime()
    ).length;

    auditSafe({
      actorId: staff.userId,
      actorRole: staff.role,
      action: "doctor.time_off",
      resource: "doctor",
      resourceId: doctorId,
      meta: { count: conflictingAppointments },
    });

    revalidatePath("/admin");
    return { ok: true, data: { timeOff, conflictingAppointments } };
  } catch (error) {
    return handleError(error, "doctor.time_off");
  }
};
