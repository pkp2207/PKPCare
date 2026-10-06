import { z } from "zod";

import {
  AVAILABILITY_MAX_WINDOW_DAYS,
  BOOKING_MAX_HORIZON_DAYS,
  MAX_TIME_OFF_ENTRIES,
  VISIT_TYPES,
} from "@/constants";
import { isValidTimeZone, parseHHMM, WEEKDAY_KEYS } from "@/lib/scheduling/time";

export const UserFormValidation = z.object({
  name: z
    .string()
    .min(2, "Name must be at least 2 characters")
    .max(50, "Name must be at most 50 characters"),
  email: z.string().email("Invalid email address"),
  phone: z
    .string()
    .refine((phone) => /^\+\d{10,15}$/.test(phone), "Invalid phone number"),
});

export const PatientFormValidation = z.object({
  name: z
    .string()
    .min(2, "Name must be at least 2 characters")
    .max(50, "Name must be at most 50 characters"),
  email: z.string().email("Invalid email address"),
  phone: z
    .string()
    .refine((phone) => /^\+\d{10,15}$/.test(phone), "Invalid phone number"),
  birthDate: z.coerce.date(),
  gender: z.enum(["Male", "Female", "Other"]),
  address: z
    .string()
    .min(5, "Address must be at least 5 characters")
    .max(500, "Address must be at most 500 characters"),
  occupation: z
    .string()
    .min(2, "Occupation must be at least 2 characters")
    .max(500, "Occupation must be at most 500 characters"),
  emergencyContactName: z
    .string()
    .min(2, "Contact name must be at least 2 characters")
    .max(50, "Contact name must be at most 50 characters"),
  emergencyContactNumber: z
    .string()
    .refine(
      (emergencyContactNumber) => /^\+\d{10,15}$/.test(emergencyContactNumber),
      "Invalid phone number"
    ),
  primaryPhysician: z.string().min(2, "Select at least one doctor"),
  insuranceProvider: z
    .string()
    .min(2, "Insurance name must be at least 2 characters")
    .max(50, "Insurance name must be at most 50 characters"),
  insurancePolicyNumber: z
    .string()
    .min(2, "Policy number must be at least 2 characters")
    .max(50, "Policy number must be at most 50 characters"),
  allergies: z.string().optional(),
  currentMedication: z.string().optional(),
  familyMedicalHistory: z.string().optional(),
  pastMedicalHistory: z.string().optional(),
  identificationType: z.string().optional(),
  identificationNumber: z.string().optional(),
  identificationDocument: z.custom<File[]>().optional(),
  treatmentConsent: z
    .boolean()
    .default(false)
    .refine((value) => value === true, {
      message: "You must consent to treatment in order to proceed",
    }),
  disclosureConsent: z
    .boolean()
    .default(false)
    .refine((value) => value === true, {
      message: "You must consent to disclosure in order to proceed",
    }),
  privacyConsent: z
    .boolean()
    .default(false)
    .refine((value) => value === true, {
      message: "You must consent to privacy in order to proceed",
    }),
});

export const CreateAppointmentSchema = z.object({
  primaryPhysician: z.string().min(2, "Select at least one doctor"),
  schedule: z.coerce.date(),
  reason: z
    .string()
    .min(2, "Reason must be at least 2 characters")
    .max(500, "Reason must be at most 500 characters"),
  note: z.string().optional(),
  cancellationReason: z.string().optional(),
});

export const ScheduleAppointmentSchema = z.object({
  primaryPhysician: z.string().min(2, "Select at least one doctor"),
  schedule: z.coerce.date(),
  reason: z.string().optional(),
  note: z.string().optional(),
  cancellationReason: z.string().optional(),
});

export const CancelAppointmentSchema = z.object({
  primaryPhysician: z.string().min(2, "Select at least one doctor"),
  schedule: z.coerce.date(),
  reason: z.string().optional(),
  note: z.string().optional(),
  cancellationReason: z
    .string()
    .min(2, "Reason must be at least 2 characters")
    .max(500, "Reason must be at most 500 characters"),
});

export function getAppointmentSchema(type: string) {
  switch (type) {
    case "create":
      return CreateAppointmentSchema;
    case "cancel":
      return CancelAppointmentSchema;
    default:
      return ScheduleAppointmentSchema;
  }
}

// ---------------------------------------------------------------------------
// Server-side schemas. Client-side form schemas above are UX only; actions must
// re-validate everything here because server actions are public endpoints.
// ---------------------------------------------------------------------------

// Appwrite custom id charset: a-z A-Z 0-9 . - _ (max 36, no leading special).
export const IdSchema = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/, "Invalid id");

// Format only. Whether the name is a real doctor is checked against the
// doctors collection (with the static `Doctors` fallback) by the actions.
export const PhysicianSchema = z
  .string()
  .min(2, "Select a valid doctor")
  .max(100, "Select a valid doctor");

export const StatusSchema = z.enum(["pending", "scheduled", "cancelled"]);

const OptionalText = (max: number) => z.string().max(max).optional();

export const CreateUserServerSchema = UserFormValidation;

/** Server schema for RegisterUserParams minus the file (validated separately). */
export const RegisterPatientServerSchema = PatientFormValidation.omit({
  identificationDocument: true,
})
  .extend({
    userId: IdSchema,
    birthDate: z.coerce
      .date()
      .refine((date) => date.getTime() <= Date.now(), "Invalid birth date"),
    primaryPhysician: PhysicianSchema,
    allergies: OptionalText(2000),
    currentMedication: OptionalText(2000),
    familyMedicalHistory: OptionalText(2000),
    pastMedicalHistory: OptionalText(2000),
    identificationType: OptionalText(100),
    identificationNumber: OptionalText(100),
  });

export const VisitTypeSchema = z.enum(VISIT_TYPES);

/**
 * Two booking shapes, at least one required:
 *  - new:    doctorId + slotStart (atomic slot booking)
 *  - legacy: primaryPhysician (name) + schedule
 */
export const CreateAppointmentServerSchema = z
  .object({
    userId: IdSchema,
    patient: IdSchema,
    reason: z
      .string()
      .min(2, "Reason must be at least 2 characters")
      .max(500, "Reason must be at most 500 characters"),
    note: OptionalText(500),
    visitType: VisitTypeSchema.default("in_person"),
    doctorId: IdSchema.optional(),
    slotStart: z.coerce.date().optional(),
    primaryPhysician: PhysicianSchema.optional(),
    schedule: z.coerce.date().optional(),
  })
  .superRefine((value, ctx) => {
    const isNew = value.doctorId !== undefined && value.slotStart !== undefined;
    const isLegacy =
      value.primaryPhysician !== undefined && value.schedule !== undefined;
    if (!isNew && !isLegacy) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select a doctor and a time",
        path: ["doctorId"],
      });
    }
  });

export const CancelMyAppointmentSchema = z.object({
  appointmentId: IdSchema,
  userId: IdSchema,
  reason: z
    .string()
    .min(2, "Reason must be at least 2 characters")
    .max(500, "Reason must be at most 500 characters"),
});

export const RescheduleAppointmentSchema = z.object({
  appointmentId: IdSchema,
  userId: IdSchema,
  newStart: z.coerce.date(),
});

export const AvailabilitySchema = z
  .object({
    doctorId: IdSchema,
    from: z.coerce.date(),
    to: z.coerce.date(),
  })
  .superRefine((value, ctx) => {
    const span = value.to.getTime() - value.from.getTime();
    if (!(span > 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "End must be after start",
        path: ["to"],
      });
    } else if (span > AVAILABILITY_MAX_WINDOW_DAYS * 24 * 60 * 60 * 1000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Date range must be at most ${AVAILABILITY_MAX_WINDOW_DAYS} days`,
        path: ["to"],
      });
    }
  });

// ---------------------------------------------------------------------------
// Doctors
// ---------------------------------------------------------------------------

const HHMM = z
  .string()
  .refine((value) => parseHHMM(value) !== null, "Use HH:MM (00:00-24:00)");

const DayIntervals = z
  .array(z.tuple([HHMM, HHMM]))
  .max(6, "At most 6 intervals per day")
  .superRefine((intervals, ctx) => {
    let previousEnd = -1;
    const sorted = [...intervals].sort(
      (a, b) => (parseHHMM(a[0]) ?? 0) - (parseHHMM(b[0]) ?? 0)
    );
    for (const [from, to] of sorted) {
      const start = parseHHMM(from) ?? 0;
      const end = parseHHMM(to) ?? 0;
      if (end <= start || start < previousEnd) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Intervals must be in order, non-empty and not overlap",
        });
        return;
      }
      previousEnd = end;
    }
  });

export const WeeklyHoursSchema = z
  .object(
    Object.fromEntries(
      WEEKDAY_KEYS.map((key) => [key, DayIntervals.optional()])
    ) as Record<(typeof WEEKDAY_KEYS)[number], z.ZodOptional<typeof DayIntervals>>
  )
  .strict();

export const TimeZoneSchema = z
  .string()
  .max(64)
  .refine(isValidTimeZone, "Unknown timezone (use an IANA name)");

export const SlotMinutesSchema = z.number().int().min(5).max(240);

export const TimeOffEntrySchema = z
  .object({
    start: z.coerce.date(),
    end: z.coerce.date(),
    reason: z.string().max(200).optional(),
  })
  .refine((v) => v.end.getTime() > v.start.getTime(), {
    message: "Time off must end after it starts",
    path: ["end"],
  });

export const AddTimeOffSchema = z.object({
  doctorId: IdSchema,
  start: z.coerce.date(),
  end: z.coerce.date(),
  reason: z.string().max(200).optional(),
})
  .refine((v) => v.end.getTime() > v.start.getTime(), {
    message: "Time off must end after it starts",
    path: ["end"],
  });

export const UpsertDoctorSchema = z.object({
  id: IdSchema.optional(),
  name: z.string().min(2, "Name must be at least 2 characters").max(100),
  specialty: z.string().min(2).max(100),
  image: z.string().min(1).max(500),
  email: z.string().email().max(200).nullable().optional(),
  staffUserId: IdSchema.nullable().optional(),
  active: z.boolean().optional(),
  slotMinutes: SlotMinutesSchema.optional(),
  timezone: TimeZoneSchema.optional(),
  weeklyHours: WeeklyHoursSchema.optional(),
  timeOff: z
    .array(TimeOffEntrySchema)
    .max(MAX_TIME_OFF_ENTRIES)
    .optional(),
});

export const SetDoctorActiveSchema = z.object({
  doctorId: IdSchema,
  active: z.boolean(),
});

// ---------------------------------------------------------------------------
// Waitlist
// ---------------------------------------------------------------------------

export const JoinWaitlistSchema = z
  .object({
    userId: IdSchema,
    patientId: IdSchema,
    doctorId: IdSchema,
    earliest: z.coerce.date(),
    latest: z.coerce.date(),
  })
  .superRefine((value, ctx) => {
    if (value.latest.getTime() <= value.earliest.getTime()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Latest must be after earliest",
        path: ["latest"],
      });
    }
    if (
      value.latest.getTime() >
      Date.now() + BOOKING_MAX_HORIZON_DAYS * 24 * 60 * 60 * 1000
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Waitlist window must end within ${BOOKING_MAX_HORIZON_DAYS} days`,
        path: ["latest"],
      });
    }
  });

export const LeaveWaitlistSchema = z.object({
  entryId: IdSchema,
  userId: IdSchema,
});

export const ALLOWED_ID_DOCUMENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

export const MAX_ID_DOCUMENT_BYTES = 5 * 1024 * 1024;
