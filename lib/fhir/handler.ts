// Request handling for the read-only FHIR facade. Server only.
// The route file is a thin wrapper so this logic is unit testable.
import { BOOKING_MAX_HORIZON_DAYS } from "@/constants";
import { recordAudit } from "@/lib/compliance/audit";
import { deriveConsentState } from "@/lib/compliance/consent";
import {
  decryptFields,
  SENSITIVE_PATIENT_FIELDS,
} from "@/lib/compliance/crypto";
import { toDoctorSchedule } from "@/lib/scheduling/schedule";
import { DAY_MS, MINUTE_MS } from "@/lib/scheduling/time";
import type { Doctor } from "@/types/appwrite.types";

import {
  authenticateFhirRequest,
  consumeRateLimit,
  type FhirPrincipal,
  type FhirScope,
  isFhirEnabled,
} from "./auth";
import { buildSearchBundle, parsePaging, type Paging } from "./bundle";
import * as data from "./data";
import {
  appointmentStatusFromFhir,
  buildCapabilityStatement,
  mapAppointment,
  mapConsents,
  mapPatient,
  mapPractitioner,
  mapPractitionerRole,
  mapSchedule,
  mapSlot,
  type FhirSlotStatus,
} from "./mappers";
import {
  badRequest,
  fhirResponse,
  forbidden,
  methodNotAllowed,
  notEnabled,
  notFound,
  serverError,
  tooManyRequests,
  unauthorized,
} from "./outcome";
import {
  isSupportedFormat,
  isValidId,
  parseDateRange,
  parseReferenceId,
  unsupportedParams,
  wantsSensitive,
} from "./search-params";
import { buildSlots } from "./slots";
import { FHIR_SYSTEMS, type FhirResource } from "./types";

const MAX_SLOT_WINDOW_DAYS = 31;
const DEFAULT_SLOT_WINDOW_DAYS = 7;
const MAX_SLOT_MINUTES = 240;
const VALID_SLOT_STATUSES: readonly FhirSlotStatus[] = [
  "free",
  "busy",
  "busy-unavailable",
];

type Ctx = {
  params: URLSearchParams;
  baseUrl: string;
  principal: FhirPrincipal;
  now: Date;
};

/** What a route produced, for the response and the audit record. */
type Result = {
  response: Response;
  type: string;
  id?: string;
  count?: number;
  total?: number;
  sensitive?: boolean;
};

const fail = (type: string, response: Response, id?: string): Result => ({
  response,
  type,
  id,
});

const baseUrlFor = (request: Request): string => {
  const configured = process.env.FHIR_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return `${new URL(request.url).origin}/api/fhir`;
};

const hasScope = (ctx: Ctx, scope: FhirScope) => ctx.principal.scopes.has(scope);

/** Shared parameter checks. Returns an error Result or null. */
const checkParams = (
  ctx: Ctx,
  type: string,
  allowed: readonly string[],
): Result | null => {
  const bad = unsupportedParams(ctx.params, allowed);
  if (bad.length > 0) {
    return fail(
      type,
      badRequest(`Unsupported search parameter: ${bad.join(", ")}.`, "not-supported"),
    );
  }
  if (!isSupportedFormat(ctx.params)) {
    return fail(type, badRequest("Only JSON (_format=json) is supported.", "not-supported"));
  }
  return null;
};

/**
 * `_include=sensitive` requires the `read:sensitive` scope; asking without it
 * is a 403 (never a silent downgrade).
 */
const resolveSensitive = (
  ctx: Ctx,
  type: string,
): { sensitive: boolean } | Result => {
  const parsed = wantsSensitive(ctx.params);
  if (!parsed.ok) {
    return fail(type, badRequest("Only _include=sensitive is supported.", "not-supported"));
  }
  if (parsed.sensitive && !hasScope(ctx, "read:sensitive")) {
    return fail(type, forbidden("The read:sensitive scope is required for _include=sensitive."));
  }
  return { sensitive: parsed.sensitive };
};

const isResult = (value: unknown): value is Result =>
  typeof value === "object" && value !== null && "response" in value;

const bundleResult = (
  ctx: Ctx,
  type: string,
  paging: Paging,
  resources: FhirResource[],
  total: number,
  sensitive = false,
): Result => ({
  response: fhirResponse(
    buildSearchBundle({
      baseUrl: ctx.baseUrl,
      path: type,
      params: ctx.params,
      paging,
      resources,
      total,
    }),
  ),
  type,
  count: resources.length,
  total,
  sensitive,
});

const emptyBundle = (ctx: Ctx, type: string, paging: Paging, sensitive = false) =>
  bundleResult(ctx, type, paging, [], 0, sensitive);

const pagingOf = (ctx: Ctx, type: string): Paging | Result => {
  const parsed = parsePaging(ctx.params);
  return parsed.ok ? parsed.paging : fail(type, badRequest(parsed.error));
};

const singleValue = (ctx: Ctx, name: string): string | null | "multiple" => {
  const values = ctx.params.getAll(name);
  if (values.length === 0) return null;
  return values.length === 1 ? values[0] : "multiple";
};

const decryptPatient = <T extends object>(doc: T, sensitive: boolean): T =>
  sensitive ? decryptFields(doc, SENSITIVE_PATIENT_FIELDS) : doc;

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const metadata = (ctx: Ctx): Result => {
  const invalid = checkParams(ctx, "metadata", []);
  if (invalid) return invalid;
  return {
    response: fhirResponse(
      buildCapabilityStatement({ baseUrl: ctx.baseUrl, now: ctx.now }),
    ),
    type: "metadata",
  };
};

const readPatient = async (ctx: Ctx, id: string): Promise<Result> => {
  const type = "Patient";
  const invalid = checkParams(ctx, type, []);
  if (invalid) return invalid;
  const mode = resolveSensitive(ctx, type);
  if (isResult(mode)) return mode;
  if (!isValidId(id)) return fail(type, notFound(), undefined);

  const doc = await data.getPatientById(id);
  if (!doc) return fail(type, notFound(), id);

  return {
    response: fhirResponse(
      mapPatient(decryptPatient(doc, mode.sensitive), { sensitive: mode.sensitive }),
    ),
    type,
    id,
    sensitive: mode.sensitive,
  };
};

const searchPatients = async (ctx: Ctx): Promise<Result> => {
  const type = "Patient";
  const invalid = checkParams(ctx, type, ["identifier", "email"]);
  if (invalid) return invalid;
  const mode = resolveSensitive(ctx, type);
  if (isResult(mode)) return mode;
  const paging = pagingOf(ctx, type);
  if (isResult(paging)) return paging;

  const identifier = singleValue(ctx, "identifier");
  const email = singleValue(ctx, "email");
  if (identifier === "multiple" || email === "multiple") {
    return fail(type, badRequest("Each search parameter may be given once."));
  }
  if (identifier === null && email === null) {
    return fail(
      type,
      badRequest("Patient search requires identifier or email.", "required"),
    );
  }

  let userId: string | undefined;
  if (identifier !== null) {
    const bar = identifier.indexOf("|");
    const system = bar >= 0 ? identifier.slice(0, bar) : undefined;
    const value = bar >= 0 ? identifier.slice(bar + 1) : identifier;
    if ((system !== undefined && system !== FHIR_SYSTEMS.userId) || !isValidId(value)) {
      return emptyBundle(ctx, type, paging, mode.sensitive);
    }
    userId = value;
  }

  let normalizedEmail: string | undefined;
  if (email !== null) {
    normalizedEmail = email.trim();
    if (normalizedEmail.length > 200 || !/^[^\s@]+@[^\s@]+$/.test(normalizedEmail)) {
      return fail(type, badRequest("email must be a valid address."));
    }
  }

  let page;
  try {
    page = await data.findPatients({
      userId,
      email: normalizedEmail,
      limit: paging.count,
      offset: paging.offset,
    });
  } catch (error) {
    // Searching a non-indexed attribute is rejected by Appwrite with 400.
    if (normalizedEmail && (error as { code?: number } | null)?.code === 400) {
      return fail(
        type,
        badRequest("Search by email is not available on this server.", "not-supported"),
      );
    }
    throw error;
  }

  return bundleResult(
    ctx,
    type,
    paging,
    page.documents.map((doc) =>
      mapPatient(decryptPatient(doc, mode.sensitive), { sensitive: mode.sensitive }),
    ),
    page.total,
    mode.sensitive,
  );
};

const doctorSource = (doc: Doctor) => ({
  $id: doc.$id,
  $updatedAt: doc.$updatedAt,
  name: doc.name,
  specialty: doc.specialty,
  active: doc.active,
  timezone: doc.timezone,
  slotMinutes: doc.slotMinutes,
});

type DoctorType = "Practitioner" | "PractitionerRole" | "Schedule";

const mapDoctorResource = (type: DoctorType, doc: Doctor, ctx: Ctx) => {
  const source = doctorSource(doc);
  if (type === "Practitioner") return mapPractitioner(source);
  if (type === "PractitionerRole") return mapPractitionerRole(source);
  return mapSchedule(source, { now: ctx.now, horizonDays: BOOKING_MAX_HORIZON_DAYS });
};

const readDoctorResource = async (
  ctx: Ctx,
  type: DoctorType,
  id: string,
): Promise<Result> => {
  const invalid = checkParams(ctx, type, []);
  if (invalid) return invalid;
  if (!isValidId(id)) return fail(type, notFound());
  const doc = await data.getDoctorById(id);
  if (!doc) return fail(type, notFound(), id);
  return {
    response: fhirResponse(mapDoctorResource(type, doc, ctx)),
    type,
    id,
  };
};

const FILTER_PARAM: Record<DoctorType, { name: string; refType: string } | null> = {
  Practitioner: null,
  PractitionerRole: { name: "practitioner", refType: "Practitioner" },
  Schedule: { name: "actor", refType: "Practitioner" },
};

const searchDoctorResource = async (ctx: Ctx, type: DoctorType): Promise<Result> => {
  const filter = FILTER_PARAM[type];
  const invalid = checkParams(ctx, type, filter ? [filter.name] : []);
  if (invalid) return invalid;
  const paging = pagingOf(ctx, type);
  if (isResult(paging)) return paging;

  if (filter) {
    const raw = singleValue(ctx, filter.name);
    if (raw === "multiple") {
      return fail(type, badRequest("Each search parameter may be given once."));
    }
    if (raw !== null) {
      const id = parseReferenceId(raw, filter.refType);
      if (!id) return fail(type, badRequest(`${filter.name} must be a Practitioner reference.`));
      const doc = await data.getDoctorById(id);
      return doc
        ? bundleResult(ctx, type, paging, [mapDoctorResource(type, doc, ctx)], 1)
        : emptyBundle(ctx, type, paging);
    }
  }

  const page = await data.listDoctorsPage({ limit: paging.count, offset: paging.offset });
  return bundleResult(
    ctx,
    type,
    paging,
    page.documents.map((doc) => mapDoctorResource(type, doc, ctx)),
    page.total,
  );
};

const searchSlots = async (ctx: Ctx): Promise<Result> => {
  const type = "Slot";
  const invalid = checkParams(ctx, type, ["schedule", "start", "status"]);
  if (invalid) return invalid;
  const paging = pagingOf(ctx, type);
  if (isResult(paging)) return paging;

  const scheduleParam = singleValue(ctx, "schedule");
  if (scheduleParam === null || scheduleParam === "multiple") {
    return fail(type, badRequest("Slot search requires exactly one schedule.", "required"));
  }
  const doctorId = parseReferenceId(scheduleParam, "Schedule");
  if (!doctorId) return fail(type, badRequest("schedule must be a Schedule reference."));

  const startValues = ctx.params.getAll("start");
  if (startValues.length > 2) {
    return fail(type, badRequest("At most two start values are supported."));
  }
  const range = parseDateRange(startValues);
  if (!range) return fail(type, badRequest("start must be a valid FHIR date."));

  const wanted = singleValue(ctx, "status");
  if (wanted === "multiple") return fail(type, badRequest("Each search parameter may be given once."));
  let statuses: FhirSlotStatus[] | null = null;
  if (wanted !== null) {
    statuses = wanted.split(",") as FhirSlotStatus[];
    if (!statuses.every((s) => VALID_SLOT_STATUSES.includes(s))) {
      return fail(type, badRequest("status must be free, busy or busy-unavailable."));
    }
  }

  const fromMs = range.gte ?? ctx.now.getTime();
  const toMs = range.lt ?? fromMs + DEFAULT_SLOT_WINDOW_DAYS * DAY_MS;
  if (toMs - fromMs > MAX_SLOT_WINDOW_DAYS * DAY_MS) {
    return fail(
      type,
      badRequest(
        `The start range may not exceed ${MAX_SLOT_WINDOW_DAYS} days.`,
        "too-costly",
      ),
    );
  }
  if (toMs <= fromMs) return emptyBundle(ctx, type, paging);

  const doctor = await data.getDoctorById(doctorId);
  if (!doctor || doctor.active === false) return emptyBundle(ctx, type, paging);

  const from = new Date(fromMs);
  const to = new Date(toMs);
  // Look back one maximum slot length so a slot that starts before `from`
  // but overlaps the first candidate is seen.
  const lookback = new Date(fromMs - MAX_SLOT_MINUTES * MINUTE_MS);
  const [held, legacyStarts] = await Promise.all([
    data.listHeldSlots(doctorId, lookback, to),
    data.listLegacyScheduleTimes(doctor.name, lookback, to),
  ]);

  const slots = buildSlots({
    doctor: toDoctorSchedule(doctor),
    held: held.map((slot) => ({
      start: slot.start,
      end: slot.end,
      status: slot.status,
    })),
    legacyStarts,
    from,
    to,
    now: ctx.now,
  }).filter((slot) => !statuses || statuses.includes(slot.status));

  const pageSlots = slots.slice(paging.offset, paging.offset + paging.count);
  return bundleResult(ctx, type, paging, pageSlots.map(mapSlot), slots.length);
};

/** Durations and display names for a set of appointments (one query). */
const doctorLookup = async (doctorIds: (string | null | undefined)[]) => {
  const ids = doctorIds.filter((id): id is string => typeof id === "string" && id !== "");
  const doctors = await data.getDoctorsByIds(ids);
  return new Map(doctors.map((doc) => [doc.$id, doc]));
};

const readAppointment = async (ctx: Ctx, id: string): Promise<Result> => {
  const type = "Appointment";
  const invalid = checkParams(ctx, type, []);
  if (invalid) return invalid;
  const mode = resolveSensitive(ctx, type);
  if (isResult(mode)) return mode;
  if (!isValidId(id)) return fail(type, notFound());

  const doc = await data.getAppointmentById(id);
  if (!doc) return fail(type, notFound(), id);
  const doctors = await doctorLookup([doc.doctorId]);
  const doctor = doc.doctorId ? doctors.get(doc.doctorId) : undefined;

  return {
    response: fhirResponse(
      mapAppointment(doc, {
        sensitive: mode.sensitive,
        durationMinutes: doctor?.slotMinutes,
        doctorName: doctor?.name,
      }),
    ),
    type,
    id,
    sensitive: mode.sensitive,
  };
};

const searchAppointments = async (ctx: Ctx): Promise<Result> => {
  const type = "Appointment";
  const invalid = checkParams(ctx, type, ["patient", "practitioner", "date", "status"]);
  if (invalid) return invalid;
  const mode = resolveSensitive(ctx, type);
  if (isResult(mode)) return mode;
  const paging = pagingOf(ctx, type);
  if (isResult(paging)) return paging;

  const patientParam = singleValue(ctx, "patient");
  const practitionerParam = singleValue(ctx, "practitioner");
  const statusParam = singleValue(ctx, "status");
  if ([patientParam, practitionerParam, statusParam].includes("multiple")) {
    return fail(type, badRequest("Each search parameter may be given once."));
  }
  const dateValues = ctx.params.getAll("date");
  if (patientParam === null && practitionerParam === null && dateValues.length === 0) {
    return fail(
      type,
      badRequest("Appointment search requires patient, practitioner or date.", "required"),
    );
  }

  let userId: string | undefined;
  if (patientParam !== null) {
    const patientId = parseReferenceId(patientParam, "Patient");
    if (!patientId) return fail(type, badRequest("patient must be a Patient reference."));
    const patient = await data.getPatientById(patientId);
    if (!patient || !patient.userId) return emptyBundle(ctx, type, paging, mode.sensitive);
    userId = patient.userId;
  }

  let doctorId: string | undefined;
  if (practitionerParam !== null) {
    const id = parseReferenceId(practitionerParam, "Practitioner");
    if (!id) return fail(type, badRequest("practitioner must be a Practitioner reference."));
    doctorId = id;
  }

  if (dateValues.length > 2) {
    return fail(type, badRequest("At most two date values are supported."));
  }
  const range = dateValues.length > 0 ? parseDateRange(dateValues) : {};
  if (!range) return fail(type, badRequest("date must be a valid FHIR date."));

  let status: string[] | undefined;
  if (statusParam !== null) {
    const mapped = statusParam.split(",").map(appointmentStatusFromFhir);
    if (mapped.some((s) => s === null)) {
      return fail(type, badRequest("status must be proposed, booked or cancelled."));
    }
    status = mapped as string[];
  }

  const page = await data.searchAppointments({
    userId,
    doctorId,
    status,
    gte: range.gte,
    lt: range.lt,
    limit: paging.count,
    offset: paging.offset,
  });
  const doctors = await doctorLookup(page.documents.map((doc) => doc.doctorId));

  return bundleResult(
    ctx,
    type,
    paging,
    page.documents.map((doc) => {
      const doctor = doc.doctorId ? doctors.get(doc.doctorId) : undefined;
      return mapAppointment(doc, {
        sensitive: mode.sensitive,
        durationMinutes: doctor?.slotMinutes,
        doctorName: doctor?.name,
      });
    }),
    page.total,
    mode.sensitive,
  );
};

const searchConsents = async (ctx: Ctx): Promise<Result> => {
  const type = "Consent";
  const invalid = checkParams(ctx, type, ["patient"]);
  if (invalid) return invalid;
  const paging = pagingOf(ctx, type);
  if (isResult(paging)) return paging;

  const patientParam = singleValue(ctx, "patient");
  if (patientParam === null || patientParam === "multiple") {
    return fail(type, badRequest("Consent search requires exactly one patient.", "required"));
  }
  const patientId = parseReferenceId(patientParam, "Patient");
  if (!patientId) return fail(type, badRequest("patient must be a Patient reference."));

  const patient = await data.getPatientById(patientId);
  if (!patient || !patient.userId) return emptyBundle(ctx, type, paging);

  const history = await data.listConsentHistory(patient.userId);
  const resources = mapConsents(patient.$id, deriveConsentState(history), history);
  return bundleResult(
    ctx,
    type,
    paging,
    resources.slice(paging.offset, paging.offset + paging.count),
    resources.length,
  );
};

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

const SCOPE_FOR: Record<string, FhirScope> = {
  Patient: "read:patient",
  Practitioner: "read:practitioner",
  PractitionerRole: "read:practitioner",
  Schedule: "read:slot",
  Slot: "read:slot",
  Appointment: "read:appointment",
  Consent: "read:consent",
};

const dispatch = async (ctx: Ctx, segments: string[]): Promise<Result> => {
  const [type, id, ...rest] = segments;

  if (type === "metadata" && segments.length === 1) return metadata(ctx);

  const scope = type ? SCOPE_FOR[type] : undefined;
  if (!type || !scope || rest.length > 0) {
    return fail("unknown", notFound("Unknown endpoint."));
  }
  if (!hasScope(ctx, scope)) return fail(type, forbidden());

  switch (type) {
    case "Patient":
      return id === undefined ? searchPatients(ctx) : readPatient(ctx, id);
    case "Practitioner":
    case "PractitionerRole":
    case "Schedule":
      return id === undefined
        ? searchDoctorResource(ctx, type)
        : readDoctorResource(ctx, type, id);
    case "Slot":
      return id === undefined
        ? searchSlots(ctx)
        : fail(type, notFound("Slot has no read endpoint; use search."));
    case "Appointment":
      return id === undefined ? searchAppointments(ctx) : readAppointment(ctx, id);
    case "Consent":
      return id === undefined
        ? searchConsents(ctx)
        : fail(type, notFound("Consent has no read endpoint; use search."));
    default:
      return fail("unknown", notFound("Unknown endpoint."));
  }
};

const audit = (
  principal: FhirPrincipal,
  result: Result,
  outcome: "success" | "denied" | "error",
  status: number,
) =>
  recordAudit({
    actorId: principal.name,
    actorRole: principal.role,
    action: "fhir.read",
    resource: `fhir.${result.type}`,
    resourceId: result.id,
    outcome,
    // No PHI: counts, HTTP status and the access mode only.
    meta: {
      status,
      count: result.count,
      total: result.total,
      purpose: result.sensitive ? "sensitive" : "minimal",
      actor: principal.kind,
    },
  });

/**
 * GET-only entry point. `segments` is the catch-all path below /api/fhir.
 * Never throws and never includes internal detail in a response.
 */
export const handleFhirRequest = async (
  request: Request,
  segments: string[] | undefined,
  now: Date = new Date(),
): Promise<Response> => {
  if (!isFhirEnabled()) return notEnabled();
  if (request.method !== "GET" && request.method !== "HEAD") {
    return methodNotAllowed();
  }

  const auth = await authenticateFhirRequest(request);
  if (!auth.ok) {
    if (auth.attempted) {
      // A presented-but-wrong credential is worth a trail; anonymous probes
      // are not (they would only flood the audit log).
      await recordAudit({
        actorId: null,
        actorRole: "fhir-anonymous",
        action: "fhir.read",
        resource: "fhir.auth",
        outcome: "denied",
        meta: { status: 401 },
      });
    }
    return unauthorized();
  }
  const { principal } = auth;

  if (!consumeRateLimit(principal.name)) return tooManyRequests(60);

  const ctx: Ctx = {
    params: new URL(request.url).searchParams,
    baseUrl: baseUrlFor(request),
    principal,
    now,
  };

  let result: Result;
  try {
    result = await dispatch(ctx, (segments ?? []).map(String));
  } catch (error) {
    console.error(
      `[fhir] request failed name=${(error as Error | null)?.name ?? "Error"}`,
    );
    const failed: Result = { response: serverError(), type: "unknown" };
    await audit(principal, failed, "error", 500);
    return failed.response;
  }

  const status = result.response.status;
  await audit(
    principal,
    result,
    status === 403 ? "denied" : status >= 400 ? "error" : "success",
    status,
  );
  return result.response;
};
