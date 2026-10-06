"use server";

import { isNotFound } from "@/lib/appwrite/client";
import * as doctorRepo from "@/lib/appwrite/doctor.repository";
import { assertPatientOrStaffOwns, PatientAuthError } from "@/lib/auth/patient";
import { auditSafe } from "@/lib/scheduling/audit";
import { isTelehealthEnabled } from "@/lib/telehealth";
import { signVisitToken, type VisitRole } from "@/lib/telehealth/token";
import {
  checkVisitEligibility,
  loadVisitContext,
} from "@/lib/telehealth/visit";
import { computeVisitWindow, visitTokenExpiry } from "@/lib/telehealth/window";
import { IdSchema } from "@/lib/validation";

const ACTION = "telehealth.link";
const UNAUTHORIZED = "Unauthorized";

const fail = (error: string): { ok: false; error: string } => ({
  ok: false,
  error,
});

const audit = (
  outcome: "success" | "denied" | "error",
  appointmentId: string | undefined,
  actorId: string | null,
  actorRole: string,
  actor?: string,
) =>
  auditSafe({
    actorId,
    actorRole,
    action: ACTION,
    resource: "appointment",
    resourceId: appointmentId,
    outcome,
    meta: actor ? { actor } : undefined,
  });

/**
 * App link (`/visit/{token}`) to join a video visit. Never returns the raw
 * room URL: the visit page re-checks the time window and appointment state on
 * every load and only reveals the room while the window is open.
 *
 * Allowed: the owning patient (`assertPatientOrStaffOwns`), staff with role
 * admin / frontdesk, and the doctor the appointment is assigned to. Staff
 * links carry the "doctor" (clinic side) role.
 */
export const getVisitLink = async (
  appointmentId: string,
): Promise<ActionResult<{ url: string; opensAt: string }>> => {
  let actorId: string | null = null;
  let actorRole = "anonymous";
  try {
    const id = IdSchema.safeParse(appointmentId);
    if (!id.success) return fail("Appointment not found");

    if (!isTelehealthEnabled()) return fail("Video visits are not enabled.");

    const ctx = await loadVisitContext(id.data);
    if (!ctx) return fail("Appointment not found");

    // ---- authorization ------------------------------------------------
    let role: VisitRole;
    let actor: "patient" | "staff";
    try {
      const access = await assertPatientOrStaffOwns(ctx.userId);
      actor = access.actor;
      role = "patient";
      if (access.actor === "staff" && access.staff) {
        const staff = access.staff;
        actorId = staff.userId;
        actorRole = staff.role;
        role = "doctor";
        if (staff.role === "doctor") {
          let own = null;
          try {
            own = await doctorRepo.findDoctorByStaffUserId(staff.userId);
          } catch (error) {
            if (!isNotFound(error)) throw error;
          }
          if (!own || !ctx.doctorId || own.$id !== ctx.doctorId) {
            audit("denied", ctx.appointmentId, actorId, actorRole);
            return fail(UNAUTHORIZED);
          }
        }
      }
    } catch (error) {
      if (error instanceof PatientAuthError) {
        audit("denied", ctx.appointmentId, actorId, actorRole);
        return fail(UNAUTHORIZED);
      }
      throw error;
    }

    // ---- eligibility (only revealed after authorization) ---------------
    const eligible = checkVisitEligibility(ctx);
    if (!eligible.ok) return fail(eligible.message);

    const window = computeVisitWindow(ctx.start, ctx.end, new Date());
    if (window.state === "late") return fail("This visit has ended.");

    const token = signVisitToken(
      { appointmentId: ctx.appointmentId, role },
      visitTokenExpiry(ctx.end),
    );
    audit("success", ctx.appointmentId, actorId, actorRole, actor);
    return {
      ok: true,
      data: { url: `/visit/${token}`, opensAt: window.opensAt.toISOString() },
    };
  } catch (error) {
    console.error(
      `[telehealth] getVisitLink failed name=${(error as Error | null)?.name ?? "Error"}`,
    );
    audit("error", undefined, actorId, actorRole);
    return fail("Something went wrong. Please try again.");
  }
};
