"use server";

import { MAX_ACTIVE_WAITLIST_ENTRIES } from "@/constants";
import { toUserMessage } from "@/lib/appwrite/client";
import * as patientRepo from "@/lib/appwrite/patient.repository";
import * as waitlistRepo from "@/lib/appwrite/waitlist.repository";
import { AdminAuthError } from "@/lib/auth/admin";
import { assertPatientOrStaffOwns, PatientAuthError } from "@/lib/auth/patient";
import { auditSafe } from "@/lib/scheduling/audit";
import { resolveDoctorById } from "@/lib/scheduling/doctors";
import { parseStringify } from "@/lib/utils";
import {
  IdSchema,
  JoinWaitlistSchema,
  LeaveWaitlistSchema,
} from "@/lib/validation";
import { WaitlistEntry } from "@/types/appwrite.types";

const fail = (error: string): { ok: false; error: string } => ({
  ok: false,
  error,
});

const firstIssue = (error: { issues: { message: string }[] }) =>
  error.issues[0]?.message ?? "Invalid input";

const handleError = (
  error: unknown,
  action: string,
  notFound = "Waitlist entry not found"
): { ok: false; error: string } => {
  if (error instanceof AdminAuthError || error instanceof PatientAuthError) {
    auditSafe({
      actorId: null,
      actorRole: "anonymous",
      action,
      resource: "waitlist",
      outcome: "denied",
    });
    return fail("Unauthorized");
  }
  console.error(`An error occurred during ${action}:`, error);
  return fail(toUserMessage(error, notFound));
};

export const joinWaitlist = async (
  params: JoinWaitlistParams
): Promise<ActionResult<WaitlistEntry>> => {
  try {
    const parsed = JoinWaitlistSchema.safeParse(params);
    if (!parsed.success) return fail(firstIssue(parsed.error));
    const data = parsed.data;

    const access = await assertPatientOrStaffOwns(data.userId);

    const patient = await patientRepo.getPatientByUserId(data.userId, {
      decrypt: false,
    });
    if (!patient || patient.$id !== data.patientId) {
      return fail("Patient not found");
    }

    const doctor = await resolveDoctorById(data.doctorId);
    if (!doctor || !doctor.doc.active) return fail("Doctor not found");

    const active = await waitlistRepo.listActiveEntriesForUser(data.userId);
    if (active.some((entry) => entry.doctorId === data.doctorId)) {
      return fail("You are already on the waitlist for this doctor");
    }
    if (active.length >= MAX_ACTIVE_WAITLIST_ENTRIES) {
      return fail("You have reached the waitlist limit");
    }

    const entry = await waitlistRepo.createWaitlistEntry({
      userId: data.userId,
      patientId: data.patientId,
      doctorId: data.doctorId,
      earliest: data.earliest,
      latest: data.latest,
    });

    auditSafe({
      actorId: access.staff?.userId ?? data.userId,
      actorRole: access.staff?.role ?? "patient",
      action: "waitlist.join",
      resource: "waitlist",
      resourceId: entry.$id,
    });

    return { ok: true, data: parseStringify(entry) };
  } catch (error) {
    return handleError(error, "waitlist.join", "Patient not found");
  }
};

export const leaveWaitlist = async (
  params: LeaveWaitlistParams
): Promise<ActionResult<null>> => {
  try {
    const parsed = LeaveWaitlistSchema.safeParse(params);
    if (!parsed.success) return fail(firstIssue(parsed.error));
    const { entryId, userId } = parsed.data;

    const access = await assertPatientOrStaffOwns(userId);

    const entry = await waitlistRepo.getWaitlistEntry(entryId);
    // Same message as a missing entry so existence isn't leaked.
    if (entry.userId !== userId) return fail("Waitlist entry not found");

    await waitlistRepo.deleteWaitlistEntry(entryId);

    auditSafe({
      actorId: access.staff?.userId ?? userId,
      actorRole: access.staff?.role ?? "patient",
      action: "waitlist.leave",
      resource: "waitlist",
      resourceId: entryId,
    });

    return { ok: true, data: null };
  } catch (error) {
    return handleError(error, "waitlist.leave");
  }
};

export const listMyWaitlist = async (
  userId: string
): Promise<ActionResult<WaitlistEntry[]>> => {
  try {
    const parsedUserId = IdSchema.safeParse(userId);
    if (!parsedUserId.success) return fail("Invalid user id");
    await assertPatientOrStaffOwns(parsedUserId.data);

    const entries = await waitlistRepo.listActiveEntriesForUser(
      parsedUserId.data
    );
    return { ok: true, data: parseStringify(entries) };
  } catch (error) {
    return handleError(error, "waitlist.list");
  }
};
