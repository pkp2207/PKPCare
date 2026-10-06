"use server";

import { revalidatePath } from "next/cache";

import {
  APPOINTMENT_CLOCK_SKEW_MINUTES,
  APPOINTMENT_SLOT_MINUTES,
} from "@/constants";
import * as appointmentRepo from "@/lib/appwrite/appointment.repository";
import { toUserMessage } from "@/lib/appwrite/client";
import * as patientRepo from "@/lib/appwrite/patient.repository";
import { AdminAuthError, requireAdmin } from "@/lib/auth/admin";
import { formatDateTime, parseStringify } from "@/lib/utils";
import {
  CreateAppointmentServerSchema,
  IdSchema,
  PhysicianSchema,
  StatusSchema,
  getAppointmentSchema,
} from "@/lib/validation";
import { Appointment } from "@/types/appwrite.types";

const MINUTE_MS = 60 * 1000;
const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 10;

const fail = (error: string): { ok: false; error: string } => ({
  ok: false,
  error,
});

const firstIssue = (error: { issues: { message: string }[] }) =>
  error.issues[0]?.message ?? "Invalid input";

const UNAUTHORIZED = "Unauthorized";

const isInPast = (schedule: Date) =>
  schedule.getTime() < Date.now() - APPOINTMENT_CLOCK_SKEW_MINUTES * MINUTE_MS;

// True when the same physician already has a non-cancelled appointment within
// one slot (before or after) of `schedule`. NOTE: check-then-write is not
// atomic; two simultaneous requests could still both pass. A unique index on
// (primaryPhysician, slot start) would be needed to close that fully.
const hasConflict = async (
  primaryPhysician: string,
  schedule: Date,
  excludeId?: string
) => {
  const slotMs = APPOINTMENT_SLOT_MINUTES * MINUTE_MS;
  const conflict = await appointmentRepo.findConflictingAppointment({
    primaryPhysician,
    after: new Date(schedule.getTime() - slotMs),
    before: new Date(schedule.getTime() + slotMs),
    excludeId,
  });
  return conflict !== null;
};

const CONFLICT_ERROR =
  "That doctor is already booked around this time. Please choose another time.";

// Not exported: exported functions in a "use server" file are public
// endpoints, and this must never be callable from the browser.
const notifyBySms = async (userId: string, content: string) => {
  try {
    await appointmentRepo.sendSms(userId, content);
  } catch (error) {
    // Best effort: the DB update already succeeded.
    console.error("An error occurred while sending sms:", error);
  }
};

export const createAppointment = async (
  params: CreateAppointmentParams
): Promise<ActionResult<Appointment>> => {
  try {
    const parsed = CreateAppointmentServerSchema.safeParse(params);
    if (!parsed.success) return fail(firstIssue(parsed.error));
    const data = parsed.data;

    if (isInPast(data.schedule)) {
      return fail("Appointment time must be in the future");
    }

    // The patient record must belong to the user. (userId itself is still
    // client-supplied until patient authentication exists.)
    const patient = await patientRepo.getPatientByUserId(data.userId);
    if (!patient || patient.$id !== data.patient) {
      return fail("Patient not found");
    }

    if (await hasConflict(data.primaryPhysician, data.schedule)) {
      return fail(CONFLICT_ERROR);
    }

    const newAppointment = await appointmentRepo.createAppointmentDocument({
      userId: data.userId,
      patient: data.patient,
      primaryPhysician: data.primaryPhysician,
      reason: data.reason,
      schedule: data.schedule,
      note: data.note,
      status: "pending", // never trusted from the client
    });

    revalidatePath("/admin");
    return { ok: true, data: parseStringify(newAppointment) };
  } catch (error) {
    console.error("An error occurred while creating a new appointment:", error);
    return fail(toUserMessage(error, "Patient not found"));
  }
};

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
    await requireAdmin();

    const statusFilter = StatusSchema.optional().safeParse(status ?? undefined);
    if (!statusFilter.success) return fail("Invalid status");

    const safePage = Math.max(1, Math.floor(Number(page)) || 1);
    const safePageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, Math.floor(Number(pageSize)) || DEFAULT_PAGE_SIZE)
    );

    const [totalCount, scheduledCount, pendingCount, cancelledCount, list] =
      await Promise.all([
        appointmentRepo.countAppointments(),
        appointmentRepo.countAppointments("scheduled"),
        appointmentRepo.countAppointments("pending"),
        appointmentRepo.countAppointments("cancelled"),
        appointmentRepo.listAppointments({
          status: statusFilter.data,
          limit: safePageSize,
          offset: (safePage - 1) * safePageSize,
        }),
      ]);

    const filteredTotal = statusFilter.data ? list.total : totalCount;

    return {
      ok: true,
      data: parseStringify({
        totalCount,
        scheduledCount,
        pendingCount,
        cancelledCount,
        documents: list.documents,
        page: safePage,
        pageSize: safePageSize,
        totalPages: Math.max(1, Math.ceil(filteredTotal / safePageSize)),
      }),
    };
  } catch (error) {
    if (error instanceof AdminAuthError) return fail(UNAUTHORIZED);
    console.error(
      "An error occurred while retrieving the recent appointments:",
      error
    );
    return fail(toUserMessage(error));
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
    await requireAdmin();

    if (type !== "schedule" && type !== "cancel") {
      return fail("Invalid update type");
    }
    const parsedId = IdSchema.safeParse(appointmentId);
    if (!parsedId.success) return fail("Invalid appointment id");

    const parsed = getAppointmentSchema(type).safeParse(appointment);
    if (!parsed.success) return fail(firstIssue(parsed.error));

    const existing = (await appointmentRepo.getAppointmentDocument(
      parsedId.data
    )) as unknown as Appointment;

    if (existing.status === "cancelled") {
      return fail("This appointment is already cancelled");
    }

    let updated;
    let smsMessage: string;

    if (type === "schedule") {
      const physician = PhysicianSchema.safeParse(parsed.data.primaryPhysician);
      if (!physician.success) return fail(firstIssue(physician.error));

      const schedule = parsed.data.schedule;
      if (isInPast(schedule)) {
        return fail("Appointment time must be in the future");
      }
      if (await hasConflict(physician.data, schedule, parsedId.data)) {
        return fail(CONFLICT_ERROR);
      }

      updated = await appointmentRepo.updateAppointmentDocument(
        parsedId.data,
        {
          primaryPhysician: physician.data,
          schedule,
          status: "scheduled", // derived from type, not trusted from client
        }
      );
      smsMessage = `Greetings from PKPCare. Your appointment is confirmed for ${formatDateTime(schedule).dateTime} with Dr. ${physician.data}.`;
    } else {
      // Cancelling only changes status + reason; physician/schedule stay as stored.
      const reason = parsed.data.cancellationReason;
      updated = await appointmentRepo.updateAppointmentDocument(
        parsedId.data,
        { status: "cancelled", cancellationReason: reason }
      );
      smsMessage = `Greetings from PKPCare. We regret to inform that your appointment for ${formatDateTime(existing.schedule).dateTime} is cancelled. Reason: ${reason}.`;
    }

    await notifyBySms(existing.userId, smsMessage);

    revalidatePath("/admin");
    return { ok: true, data: parseStringify(updated) };
  } catch (error) {
    if (error instanceof AdminAuthError) return fail(UNAUTHORIZED);
    console.error("An error occurred while scheduling an appointment:", error);
    return fail(toUserMessage(error, "Appointment not found"));
  }
};

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

    const appointment = await appointmentRepo.getAppointmentDocument(
      parsedAppointmentId.data
    );

    // Same message as a missing document so existence isn't leaked.
    // (userId is client-supplied until patient authentication exists.)
    if (appointment.userId !== parsedUserId.data) {
      return fail("Appointment not found");
    }

    return { ok: true, data: parseStringify(appointment) };
  } catch (error) {
    console.error("An error occurred while retrieving the appointment:", error);
    return fail(toUserMessage(error, "Appointment not found"));
  }
};
