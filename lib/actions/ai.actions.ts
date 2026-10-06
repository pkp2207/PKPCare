"use server";

// AI-assisted features. OFF by default (AI_ENABLED=true + ANTHROPIC_API_KEY).
// Assistive only: every result is a suggestion a human confirms. Safety
// behaviour (red flags, allergy/medication lines) is deterministic and never
// depends on the model. Prompts and outputs are not stored or logged; the audit
// record carries only feature, model, latency, token counts and outcome.
//
// Only async functions may be exported from a "use server" file; helpers live
// in lib/ai/**.
import { auditAi } from "@/lib/ai/audit";
import { resolveAiActor } from "@/lib/ai/caller";
import { aiUserMessage } from "@/lib/ai/client";
import {
  AI_NOT_ENABLED_MESSAGE,
  getEmergencyNumber,
  isAiEnabled,
} from "@/lib/ai/config";
import {
  runIdExtract,
  validateIdImage,
  type IdExtractData,
} from "@/lib/ai/id-extract";
import { takeAiRateLimit } from "@/lib/ai/rate-limit";
import {
  checkRedFlags,
  runModelTriage,
  TriageInputSchema,
  type TriageData,
  type TriageDoctor,
} from "@/lib/ai/triage";
import {
  buildSummaryInput,
  buildTemplateSummary,
  runVisitSummary,
  type PreVisitSummaryData,
} from "@/lib/ai/visit-summary";
import * as appointmentRepo from "@/lib/appwrite/appointment.repository";
import { isNotFound } from "@/lib/appwrite/client";
import * as doctorRepo from "@/lib/appwrite/doctor.repository";
import * as patientRepo from "@/lib/appwrite/patient.repository";
import { AdminAuthError, requireRole } from "@/lib/auth/admin";
import {
  decryptFields,
  SENSITIVE_PATIENT_FIELDS,
} from "@/lib/compliance/crypto";
import { IdSchema } from "@/lib/validation";

import { listDoctors } from "./doctor.actions";

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

const NOT_FOUND = "Appointment not found";
const RATE_LIMITED = aiUserMessage("rate_limited");

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * Cheap, model-free check used by the UI to decide whether to render anything.
 * `emergencyNumber` is the operator-configured EMERGENCY_NUMBER (optional).
 */
export const getAiStatus = async (): Promise<
  ActionResult<{ enabled: boolean; emergencyNumber?: string }>
> => {
  const emergencyNumber = getEmergencyNumber();
  return {
    ok: true,
    data: { enabled: isAiEnabled(), ...(emergencyNumber ? { emergencyNumber } : {}) },
  };
};

// ---------------------------------------------------------------------------
// Triage / specialty routing
// ---------------------------------------------------------------------------

export const suggestSpecialty = async (params: {
  reason: string;
}): Promise<ActionResult<TriageData>> => {
  try {
    if (!isAiEnabled()) return fail(AI_NOT_ENABLED_MESSAGE);

    const parsed = TriageInputSchema.safeParse(params);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input");
    }
    const { reason } = parsed.data;

    const actor = await resolveAiActor();
    const allowed = takeAiRateLimit("triage", actor);
    const who = { actorId: actor.userId, actorRole: actor.role };

    // STEP 1: deterministic red flags. No model call, and never blocked by the
    // rate limit (only the audit row is skipped when over it).
    const red = checkRedFlags(reason, getEmergencyNumber());
    if (red) {
      if (allowed) await auditAi({ feature: "triage", ...who, outcome: "red_flag" });
      return { ok: true, data: red.data };
    }

    if (!allowed) {
      await auditAi({ feature: "triage", ...who, outcome: "rate_limited" });
      return fail(RATE_LIMITED);
    }

    const doctors = await listDoctors();
    if (!doctors.ok) return fail("AI assistance is temporarily unavailable.");
    const list: TriageDoctor[] = doctors.data.map((d) => ({
      id: d.id,
      name: d.name,
      specialty: d.specialty,
    }));

    // STEP 2: model.
    const run = await runModelTriage(reason, list);
    await auditAi({
      feature: "triage",
      ...who,
      outcome: run.outcome,
      model: run.model,
      latencyMs: run.latencyMs,
      usage: run.usage,
      errorCode: run.errorCode,
    });
    return run.result;
  } catch (error) {
    console.error("[ai] suggestSpecialty failed:", (error as Error)?.name ?? "error");
    return fail("AI assistance is temporarily unavailable.");
  }
};

// ---------------------------------------------------------------------------
// ID document extraction
// ---------------------------------------------------------------------------

export const extractIdDetails = async (
  formData: FormData,
): Promise<ActionResult<IdExtractData>> => {
  try {
    if (!isAiEnabled()) return fail(AI_NOT_ENABLED_MESSAGE);

    const actor = await resolveAiActor();
    const who = { actorId: actor.userId, actorRole: actor.role };

    const image = await validateIdImage(formData);
    if (!image.ok) {
      await auditAi({ feature: "id_extract", ...who, outcome: "invalid_input" });
      return fail(image.error);
    }

    if (!takeAiRateLimit("id_extract", actor)) {
      await auditAi({ feature: "id_extract", ...who, outcome: "rate_limited" });
      return fail(RATE_LIMITED);
    }

    const run = await runIdExtract(image.data);
    await auditAi({
      feature: "id_extract",
      ...who,
      outcome: run.outcome,
      model: run.model,
      latencyMs: run.latencyMs,
      usage: run.usage,
      errorCode: run.errorCode,
    });
    return run.result;
  } catch (error) {
    console.error("[ai] extractIdDetails failed:", (error as Error)?.name ?? "error");
    return fail("AI assistance is temporarily unavailable.");
  }
};

// ---------------------------------------------------------------------------
// Pre-visit summary (staff only)
// ---------------------------------------------------------------------------

export const getPreVisitSummary = async (
  appointmentId: string,
): Promise<ActionResult<PreVisitSummaryData>> => {
  try {
    const staff = await requireRole("admin", "frontdesk", "doctor");
    const who = { actorId: staff.userId, actorRole: staff.role };

    const id = IdSchema.safeParse(appointmentId);
    if (!id.success) return fail("Invalid appointment id");

    const appointment = await appointmentRepo.getAppointmentDocument(id.data);

    // Same scoping as updateAppointment: a doctor only sees their own
    // appointments (doctorId match); anything else looks like "not found".
    if (staff.role === "doctor") {
      let own: string | null = null;
      try {
        own = (await doctorRepo.findDoctorByStaffUserId(staff.userId))?.$id ?? null;
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
      if (!own || appointment.doctorId !== own) {
        await auditAi({
          feature: "visit_summary",
          ...who,
          outcome: "invalid_input",
          resourceId: id.data,
        });
        return fail(NOT_FOUND);
      }
    }

    // Patient fields are stored encrypted; decrypt for this request only.
    let patientRaw: unknown = appointment.patient;
    if (!patientRaw || typeof patientRaw !== "object") {
      patientRaw = await patientRepo.getPatientByUserId(appointment.userId, { decrypt: false });
    }
    const patient = patientRaw
      ? decryptFields(patientRaw as object, SENSITIVE_PATIENT_FIELDS)
      : null;

    const { input, identity } = buildSummaryInput({
      reason: appointment.reason,
      visitType: appointment.visitType,
      patient: patient as Record<string, unknown> | null,
    });

    const base = { feature: "visit_summary" as const, ...who, resourceId: id.data };

    // Template path: AI off, or over the rate limit. Still useful without a model.
    if (!isAiEnabled()) {
      await auditAi({ ...base, outcome: "disabled" });
      return { ok: true, data: buildTemplateSummary(input) };
    }
    const caller = await resolveAiActor();
    if (!takeAiRateLimit("visit_summary", caller)) {
      await auditAi({ ...base, outcome: "rate_limited" });
      return { ok: true, data: buildTemplateSummary(input) };
    }

    const run = await runVisitSummary(input, identity);
    await auditAi({
      ...base,
      outcome: run.outcome,
      model: run.model,
      latencyMs: run.latencyMs,
      usage: run.usage,
      errorCode: run.errorCode,
    });
    return run.result;
  } catch (error) {
    if (error instanceof AdminAuthError) {
      await auditAi({
        feature: "visit_summary",
        actorId: null,
        actorRole: "anonymous",
        outcome: "denied",
      });
      return fail(error.message === "Forbidden" ? "Forbidden" : "Unauthorized");
    }
    if (isNotFound(error)) return fail(NOT_FOUND);
    console.error("[ai] getPreVisitSummary failed:", (error as Error)?.name ?? "error");
    return fail("Could not prepare the summary. Please try again.");
  }
};
