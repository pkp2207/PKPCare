"use server";

import { revalidatePath } from "next/cache";

import {
  APPOINTMENT_CLOCK_SKEW_MINUTES,
  APPOINTMENT_SLOT_MINUTES,
} from "@/constants";
import * as appointmentRepo from "@/lib/appwrite/appointment.repository";
import { isNotFound, toUserMessage } from "@/lib/appwrite/client";
import * as doctorRepo from "@/lib/appwrite/doctor.repository";
import * as patientRepo from "@/lib/appwrite/patient.repository";
import { AdminAuthError, requireRole, StaffSession } from "@/lib/auth/admin";
import { assertPatientOrStaffOwns, PatientAuthError } from "@/lib/auth/patient";
import {
  decryptFields,
  SENSITIVE_PATIENT_FIELDS,
} from "@/lib/compliance/crypto";
import { notifyAppointment } from "@/lib/notifications/events";
import { onAppointmentCancelled } from "@/lib/payments/refund";
import { auditSafe } from "@/lib/scheduling/audit";
import {
  releaseSlot,
  releaseSlotAndOffer,
  reserveSlot,
  SLOT_TAKEN_MESSAGE,
  SlotTakenError,
} from "@/lib/scheduling/booking";
import {
  resolveDoctorById,
  resolveDoctorByName,
} from "@/lib/scheduling/doctors";
import { markWaitlistFulfilled } from "@/lib/scheduling/offers";
import { validateSlotBookable } from "@/lib/scheduling/schedule";
import { slotId as computeSlotId } from "@/lib/scheduling/slot-id";
import { MINUTE_MS } from "@/lib/scheduling/time";
import { parseStringify } from "@/lib/utils";
import {
  CancelMyAppointmentSchema,
  CreateAppointmentServerSchema,
  IdSchema,
  PhysicianSchema,
  RescheduleAppointmentSchema,
  StatusSchema,
  getAppointmentSchema,
} from "@/lib/validation";
import { Appointment } from "@/types/appwrite.types";

const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 10;

const fail = (error: string): { ok: false; error: string } => ({
  ok: false,
  error,
});

const firstIssue = (error: { issues: { message: string }[] }) =>
  error.issues[0]?.message ?? "Invalid input";

const UNAUTHORIZED = "Unauthorized";
const NOT_FOUND = "Appointment not found";

const CONFLICT_ERROR =
  "That doctor is already booked around this time. Please choose another time.";

const isInPast = (schedule: Date) =>
  schedule.getTime() <
  Date.now() - APPOINTMENT_CLOCK_SKEW_MINUTES * MINUTE_MS;

// True when the same physician already has a non-cancelled appointment within
// one slot (before or after) of `schedule`. This is a check-then-write and is
// NOT atomic; it is defence in depth (and the only guard for legacy
// appointments that have no slot document). The atomic guarantee comes from
// the deterministic slot document id (see lib/scheduling/booking.ts).
const hasConflict = async (
  primaryPhysician: string,
  schedule: Date,
  slotMinutes: number,
  excludeId?: string
) => {
  const slotMs = slotMinutes * MINUTE_MS;
  const conflict = await appointmentRepo.findConflictingAppointment({
    primaryPhysician,
    after: new Date(schedule.getTime() - slotMs),
    before: new Date(schedule.getTime() + slotMs),
    excludeId,
  });
  return conflict !== null;
};

// Appwrite returns every attribute of a document (null when unset), so the
// presence of the key tells us whether the appointments collection has been
// migrated by scripts/appwrite-setup.mjs. Before that, we must not write the
// new attributes or Appwrite rejects the whole document.
const hasSchedulingAttrs = (doc: object) => "slotId" in doc;

// The expanded `patient` relationship carries encrypted PHI fields.
const withDecryptedPatient = <T extends object>(doc: T): T => {
  const patient = (doc as { patient?: unknown }).patient;
  if (patient && typeof patient === "object") {
    return {
      ...doc,
      patient: decryptFields(patient as object, SENSITIVE_PATIENT_FIELDS),
    };
  }
  return doc;
};

type Access = { actor: "patient" | "staff"; staff?: StaffSession };

const actorOf = (access: Access, userId: string) => ({
  actorId: access.staff?.userId ?? userId,
  actorRole: access.staff?.role ?? "patient",
});

const asDate = (value: unknown) => new Date(value as string | number | Date);

/** Shared catch-block mapping. Never leaks internals, audits denials. */
const handleError = (
  error: unknown,
  action: string,
  resource: string,
  notFound = NOT_FOUND
): { ok: false; error: string } => {
  if (error instanceof AdminAuthError || error instanceof PatientAuthError) {
    auditSafe({
      actorId: null,
      actorRole: "anonymous",
      action,
      resource,
      outcome: "denied",
    });
    return fail(error.message === "Forbidden" ? "Forbidden" : UNAUTHORIZED);
  }
  if (error instanceof SlotTakenError) return fail(SLOT_TAKEN_MESSAGE);
  console.error(`An error occurred during ${action}:`, error);
  return fail(toUserMessage(error, notFound));
};

const emptyList = (page: number, pageSize: number): RecentAppointmentList => ({
  totalCount: 0,
  scheduledCount: 0,
  pendingCount: 0,
  cancelledCount: 0,
  documents: [],
  page,
  pageSize,
  totalPages: 1,
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

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export const createAppointment = async (
  params: CreateAppointmentParams
): Promise<ActionResult<Appointment>> => {
  try {
    const parsed = CreateAppointmentServerSchema.safeParse(params);
    if (!parsed.success) return fail(firstIssue(parsed.error));
    const data = parsed.data;

    const access = await assertPatientOrStaffOwns(data.userId);

    // The patient record must belong to the user.
    const patient = await patientRepo.getPatientByUserId(data.userId, {
      decrypt: false,
    });
    if (!patient || patient.$id !== data.patient) {
      return fail("Patient not found");
    }

    const now = new Date();
    const byId = data.doctorId !== undefined && data.slotStart !== undefined;
    const start = (byId ? data.slotStart : data.schedule) as Date;

    const resolved = byId
      ? await resolveDoctorById(data.doctorId as string)
      : await resolveDoctorByName(data.primaryPhysician as string);
    if (!resolved) return fail(byId ? "Doctor not found" : "Select a valid doctor");
    if (resolved.source === "db" && !resolved.doc.active) {
      return fail("That doctor is not accepting appointments");
    }

    const slotMinutes = resolved.schedule.slotMinutes;
    const actor = actorOf(access, data.userId);
    let created;

    if (resolved.source === "fallback") {
      // Doctors collection not set up yet: original behaviour, no slot doc,
      // and none of the new attributes (they may not exist yet).
      if (isInPast(start)) return fail("Appointment time must be in the future");
      if (await hasConflict(resolved.name, start, APPOINTMENT_SLOT_MINUTES)) {
        return fail(CONFLICT_ERROR);
      }
      created = await appointmentRepo.createAppointmentDocument({
        userId: data.userId,
        patient: data.patient,
        primaryPhysician: resolved.name,
        reason: data.reason,
        schedule: start,
        note: data.note,
        status: "pending", // never trusted from the client
        ...(data.visitType === "video" ? { visitType: data.visitType } : {}),
      });
    } else {
      const bookable = validateSlotBookable(resolved.schedule, start, now);
      if (!bookable.ok) return fail(bookable.error);

      if (await hasConflict(resolved.name, start, slotMinutes)) {
        return fail(CONFLICT_ERROR);
      }

      // 1) claim the slot (409 => "just taken")  2) create the appointment
      // 3) on failure, give the slot back.
      const appointmentId = appointmentRepo.generateAppointmentId();
      const slot = await reserveSlot({
        doctorId: resolved.doc.$id,
        start,
        end: bookable.end,
        appointmentId,
        now,
      });
      try {
        created = await appointmentRepo.createAppointmentDocument(
          {
            userId: data.userId,
            patient: data.patient,
            primaryPhysician: resolved.name,
            reason: data.reason,
            schedule: start,
            note: data.note,
            status: "pending", // never trusted from the client
            doctorId: resolved.doc.$id,
            slotId: slot.$id,
            visitType: data.visitType,
          },
          appointmentId
        );
      } catch (error) {
        await releaseSlot(slot.$id);
        throw error;
      }
      await markWaitlistFulfilled(data.userId, resolved.doc.$id, start);
    }

    // Best effort and off by default (NOTIFY_BOOKING_RECEIVED): never fails the action.
    await notifyAppointment("booking_received", created as never, {
      patient,
      doctorName: resolved.name,
      doctorId: resolved.source === "db" ? resolved.doc.$id : null,
    });

    auditSafe({
      ...actor,
      action: "appointment.create",
      resource: "appointment",
      resourceId: String(created.$id),
    });

    revalidatePath("/admin");
    return { ok: true, data: parseStringify(created) };
  } catch (error) {
    return handleError(
      error,
      "appointment.create",
      "appointment",
      "Patient not found"
    );
  }
};

// ---------------------------------------------------------------------------
// Admin / staff
// ---------------------------------------------------------------------------

export const getRecentAppointmentList = async ({
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
  status,
}: {
  page?: number;
  pageSize?: number;
  status?: Status;
} = {}): Promise<ActionResult<RecentAppointmentList>> => {
  try {
    const staff = await requireRole("admin", "frontdesk", "doctor");

    const statusFilter = StatusSchema.optional().safeParse(status ?? undefined);
    if (!statusFilter.success) return fail("Invalid status");

    const safePage = Math.max(1, Math.floor(Number(page)) || 1);
    const safePageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, Math.floor(Number(pageSize)) || DEFAULT_PAGE_SIZE)
    );

    // A doctor only ever sees their own appointments (doctorId match). A
    // doctor login without a linked doctors document sees nothing.
    let doctorId: string | undefined;
    if (staff.role === "doctor") {
      const own = await doctorIdForStaff(staff);
      if (!own) return { ok: true, data: emptyList(safePage, safePageSize) };
      doctorId = own;
    }

    const [totalCount, scheduledCount, pendingCount, cancelledCount, list] =
      await Promise.all([
        appointmentRepo.countAppointments(undefined, doctorId),
        appointmentRepo.countAppointments("scheduled", doctorId),
        appointmentRepo.countAppointments("pending", doctorId),
        appointmentRepo.countAppointments("cancelled", doctorId),
        appointmentRepo.listAppointments({
          status: statusFilter.data,
          doctorId,
          limit: safePageSize,
          offset: (safePage - 1) * safePageSize,
        }),
      ]);

    const filteredTotal = statusFilter.data ? list.total : totalCount;

    auditSafe({
      actorId: staff.userId,
      actorRole: staff.role,
      action: "appointment.list",
      resource: "appointment",
      meta: { page: safePage, count: list.documents.length },
    });

    return {
      ok: true,
      data: parseStringify({
        totalCount,
        scheduledCount,
        pendingCount,
        cancelledCount,
        documents: list.documents.map(withDecryptedPatient),
        page: safePage,
        pageSize: safePageSize,
        totalPages: Math.max(1, Math.ceil(filteredTotal / safePageSize)),
      }),
    };
  } catch (error) {
    return handleError(error, "appointment.list", "appointment");
  }
};

export const updateAppointment = async ({
  appointmentId,
  appointment,
  type,
}: UpdateAppointmentParams): Promise<ActionResult<Appointment>> => {
  // The client-supplied userId is intentionally ignored: the SMS recipient
  // comes from the stored appointment.
  try {
    const staff = await requireRole("admin", "frontdesk", "doctor");

    if (type !== "schedule" && type !== "cancel") {
      return fail("Invalid update type");
    }
    const parsedId = IdSchema.safeParse(appointmentId);
    if (!parsedId.success) return fail("Invalid appointment id");

    const parsed = getAppointmentSchema(type).safeParse(appointment);
    if (!parsed.success) return fail(firstIssue(parsed.error));

    const existing = await appointmentRepo.getAppointmentDocument(
      parsedId.data
    );

    if (staff.role === "doctor") {
      const own = await doctorIdForStaff(staff);
      if (!own || existing.doctorId !== own) return fail(NOT_FOUND);
    }

    if (existing.status === "cancelled") {
      return fail("This appointment is already cancelled");
    }

    const supportsScheduling = hasSchedulingAttrs(existing);
    let updated;
    let notification: () => Promise<unknown>;
    let action: string;

    if (type === "schedule") {
      action = "appointment.update";
      const physician = PhysicianSchema.safeParse(parsed.data.primaryPhysician);
      if (!physician.success) return fail(firstIssue(physician.error));

      const schedule = parsed.data.schedule;
      if (isInPast(schedule)) {
        return fail("Appointment time must be in the future");
      }

      const resolved = await resolveDoctorByName(physician.data);
      if (!resolved) return fail("Select a valid doctor");

      if (resolved.source === "fallback") {
        if (await hasConflict(resolved.name, schedule, APPOINTMENT_SLOT_MINUTES, parsedId.data)) {
          return fail(CONFLICT_ERROR);
        }
        updated = await appointmentRepo.updateAppointmentDocument(
          parsedId.data,
          {
            primaryPhysician: resolved.name,
            schedule,
            status: "scheduled", // derived from type, not trusted from client
          }
        );
      } else {
        const doctorId = resolved.doc.$id;
        const newSlotId = computeSlotId(doctorId, schedule);

        if (existing.slotId === newSlotId) {
          // Same doctor, same time, slot already held: just confirm it.
          updated = await appointmentRepo.updateAppointmentDocument(
            parsedId.data,
            { status: "scheduled" }
          );
        } else {
          // Staff override: only the past is rejected (hours, lead time and
          // time off are waived), but the slot is still claimed atomically.
          const bookable = validateSlotBookable(
            resolved.schedule,
            schedule,
            new Date(),
            "staff"
          );
          if (!bookable.ok) return fail(bookable.error);
          if (
            await hasConflict(
              resolved.name,
              schedule,
              resolved.schedule.slotMinutes,
              parsedId.data
            )
          ) {
            return fail(CONFLICT_ERROR);
          }

          const slot = await reserveSlot({
            doctorId,
            start: schedule,
            end: bookable.end,
            appointmentId: parsedId.data,
          });
          try {
            updated = await appointmentRepo.updateAppointmentDocument(
              parsedId.data,
              {
                primaryPhysician: resolved.name,
                schedule,
                status: "scheduled",
                doctorId,
                slotId: slot.$id,
              }
            );
          } catch (error) {
            await releaseSlot(slot.$id);
            throw error;
          }
          if (existing.slotId && existing.doctorId) {
            await releaseSlotAndOffer({
              slotId: existing.slotId,
              doctorId: existing.doctorId,
              start: asDate(existing.schedule),
            });
          }
        }
      }
      notification = () =>
        notifyAppointment("confirmed", existing, {
          start: schedule,
          doctorName: resolved.name,
          doctorId: resolved.source === "db" ? resolved.doc.$id : null,
        });
    } else {
      action = "appointment.cancel";
      // Cancelling only changes status + reason; physician/schedule stay as stored.
      const reason = parsed.data.cancellationReason;
      updated = await appointmentRepo.updateAppointmentDocument(
        parsedId.data,
        {
          status: "cancelled",
          cancellationReason: reason,
          ...(supportsScheduling ? { cancelledBy: "staff" as const } : {}),
        }
      );
      if (existing.slotId && existing.doctorId) {
        await releaseSlotAndOffer({
          slotId: existing.slotId,
          doctorId: existing.doctorId,
          start: asDate(existing.schedule),
        });
      }
      notification = async () => {
        await notifyAppointment("cancelled", existing);
        await onAppointmentCancelled(existing);
      };
    }

    await notification();

    auditSafe({
      actorId: staff.userId,
      actorRole: staff.role,
      action,
      resource: "appointment",
      resourceId: parsedId.data,
    });

    revalidatePath("/admin");
    return { ok: true, data: parseStringify(updated) };
  } catch (error) {
    return handleError(error, "appointment.update", "appointment");
  }
};

// ---------------------------------------------------------------------------
// Patient-facing
// ---------------------------------------------------------------------------

export const getAppointment = async (
  appointmentId: string,
  userId: string
): Promise<ActionResult<Appointment>> => {
  try {
    const parsedAppointmentId = IdSchema.safeParse(appointmentId);
    const parsedUserId = IdSchema.safeParse(userId);
    if (!parsedAppointmentId.success || !parsedUserId.success) {
      return fail("Invalid id");
    }
    await assertPatientOrStaffOwns(parsedUserId.data);

    const appointment = await appointmentRepo.getAppointmentDocument(
      parsedAppointmentId.data
    );

    // Same message as a missing document so existence isn't leaked.
    if (appointment.userId !== parsedUserId.data) {
      return fail(NOT_FOUND);
    }

    return { ok: true, data: parseStringify(withDecryptedPatient(appointment)) };
  } catch (error) {
    return handleError(error, "appointment.read", "appointment");
  }
};

export const listMyAppointments = async (
  userId: string
): Promise<ActionResult<Appointment[]>> => {
  try {
    const parsedUserId = IdSchema.safeParse(userId);
    if (!parsedUserId.success) return fail("Invalid user id");
    await assertPatientOrStaffOwns(parsedUserId.data);

    const appointments = await appointmentRepo.listAppointmentsByUser(
      parsedUserId.data
    );
    return {
      ok: true,
      data: parseStringify(appointments.map(withDecryptedPatient)),
    };
  } catch (error) {
    return handleError(error, "appointment.list_mine", "appointment");
  }
};

export const cancelMyAppointment = async (
  params: CancelMyAppointmentParams
): Promise<ActionResult<Appointment>> => {
  try {
    const parsed = CancelMyAppointmentSchema.safeParse(params);
    if (!parsed.success) return fail(firstIssue(parsed.error));
    const { appointmentId, userId, reason } = parsed.data;

    const access = await assertPatientOrStaffOwns(userId);

    const existing = await appointmentRepo.getAppointmentDocument(appointmentId);
    if (existing.userId !== userId) return fail(NOT_FOUND);
    if (existing.status === "cancelled") {
      return fail("This appointment is already cancelled");
    }
    const start = asDate(existing.schedule);
    if (start.getTime() < Date.now()) {
      return fail("Past appointments cannot be cancelled");
    }

    const updated = await appointmentRepo.updateAppointmentDocument(
      appointmentId,
      {
        status: "cancelled",
        cancellationReason: reason,
        ...(hasSchedulingAttrs(existing)
          ? { cancelledBy: access.staff ? ("staff" as const) : ("patient" as const) }
          : {}),
      }
    );

    if (existing.slotId && existing.doctorId) {
      await releaseSlotAndOffer({
        slotId: existing.slotId,
        doctorId: existing.doctorId,
        start,
        excludeUserId: userId,
      });
    }

    await notifyAppointment("cancelled", existing);
    await onAppointmentCancelled(existing);

    auditSafe({
      ...actorOf(access, userId),
      action: "appointment.cancel",
      resource: "appointment",
      resourceId: appointmentId,
    });

    revalidatePath("/admin");
    return { ok: true, data: parseStringify(updated) };
  } catch (error) {
    return handleError(error, "appointment.cancel", "appointment");
  }
};

export const rescheduleAppointment = async (
  params: RescheduleAppointmentParams
): Promise<ActionResult<Appointment>> => {
  try {
    const parsed = RescheduleAppointmentSchema.safeParse(params);
    if (!parsed.success) return fail(firstIssue(parsed.error));
    const { appointmentId, userId, newStart } = parsed.data;

    const access = await assertPatientOrStaffOwns(userId);

    const existing = await appointmentRepo.getAppointmentDocument(appointmentId);
    if (existing.userId !== userId) return fail(NOT_FOUND);
    if (existing.status === "cancelled") {
      return fail("This appointment is already cancelled");
    }
    const oldStart = asDate(existing.schedule);
    if (oldStart.getTime() < Date.now()) {
      return fail("Past appointments cannot be rescheduled");
    }
    if (oldStart.getTime() === newStart.getTime()) {
      return fail("Please choose a different time");
    }

    // Prefer the stored doctorId; legacy appointments resolve by name.
    const resolved = existing.doctorId
      ? await resolveDoctorById(existing.doctorId)
      : await resolveDoctorByName(existing.primaryPhysician);
    if (!resolved) return fail("Doctor not found");

    let updated;

    if (resolved.source === "fallback") {
      // Doctors collection not set up: legacy semantics, no slot documents.
      if (isInPast(newStart)) return fail("Appointment time must be in the future");
      if (
        await hasConflict(
          resolved.name,
          newStart,
          APPOINTMENT_SLOT_MINUTES,
          appointmentId
        )
      ) {
        return fail(CONFLICT_ERROR);
      }
      updated = await appointmentRepo.updateAppointmentDocument(appointmentId, {
        schedule: newStart,
      });
    } else {
      if (!resolved.doc.active) {
        return fail("That doctor is not accepting appointments");
      }
      const now = new Date();
      const bookable = validateSlotBookable(
        resolved.schedule,
        newStart,
        now,
        access.staff ? "staff" : "patient"
      );
      if (!bookable.ok) return fail(bookable.error);

      if (
        await hasConflict(
          resolved.name,
          newStart,
          resolved.schedule.slotMinutes,
          appointmentId
        )
      ) {
        return fail(CONFLICT_ERROR);
      }

      // Book the NEW slot first; only once the appointment points at it is the
      // old slot released. Any failure in between rolls the new slot back and
      // leaves the original booking untouched.
      const newSlot = await reserveSlot({
        doctorId: resolved.doc.$id,
        start: newStart,
        end: bookable.end,
        appointmentId,
        now,
      });
      try {
        updated = await appointmentRepo.updateAppointmentDocument(
          appointmentId,
          {
            schedule: newStart,
            doctorId: resolved.doc.$id,
            slotId: newSlot.$id,
            primaryPhysician: resolved.name,
          }
        );
      } catch (error) {
        await releaseSlot(newSlot.$id);
        throw error;
      }

      if (existing.slotId && existing.slotId !== newSlot.$id) {
        await releaseSlotAndOffer({
          slotId: existing.slotId,
          doctorId: existing.doctorId ?? resolved.doc.$id,
          start: oldStart,
          excludeUserId: userId,
        });
      }
    }

    await notifyAppointment("rescheduled", existing, {
      start: newStart,
      doctorName: resolved.name,
      doctorId: resolved.source === "db" ? resolved.doc.$id : null,
    });

    auditSafe({
      ...actorOf(access, userId),
      action: "appointment.reschedule",
      resource: "appointment",
      resourceId: appointmentId,
    });

    revalidatePath("/admin");
    return { ok: true, data: parseStringify(updated) };
  } catch (error) {
    return handleError(error, "appointment.reschedule", "appointment");
  }
};
