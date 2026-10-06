// Booking form validation (client UX only - createAppointment re-validates).

import { z } from "zod";

export const BookingFormSchema = z
  .object({
    doctorId: z.string().min(1, "Choose a doctor"),
    legacy: z.boolean().default(false),
    visitType: z.enum(["in_person", "video"]),
    /** ISO instant of the chosen slot (new, slot-based doctors). */
    slotStart: z.string().optional(),
    /** Free date-time for legacy (static list) doctors. */
    legacySchedule: z.coerce.date().optional(),
    reason: z
      .string()
      .trim()
      .min(2, "Tell us briefly why you are coming (at least 2 characters)")
      .max(500, "Reason must be at most 500 characters"),
    note: z.string().max(500, "Notes must be at most 500 characters").optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.legacy && !value.slotStart) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Choose a day and a time",
        path: ["slotStart"],
      });
    }
    if (value.legacy) {
      const when = value.legacySchedule;
      if (!when || Number.isNaN(when.getTime())) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Choose a date and time",
          path: ["legacySchedule"],
        });
      } else if (when.getTime() <= Date.now()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Choose a time in the future",
          path: ["legacySchedule"],
        });
      }
    }
  });

export type BookingFormValues = z.infer<typeof BookingFormSchema>;

/** First validation message per field, or {} when valid. */
export const validateBooking = (values: BookingFormValues): Record<string, string> => {
  const parsed = BookingFormSchema.safeParse(values);
  if (parsed.success) return {};
  const errors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const field = String(issue.path[0] ?? "form");
    if (!errors[field]) errors[field] = issue.message;
  }
  return errors;
};

/** Picks the default doctor: explicit id, else the patient's primary physician, else none. */
export const pickDefaultDoctorId = (
  doctors: readonly { id: string; name: string }[],
  options: { initialDoctorId?: string | null; primaryPhysicianName?: string | null }
): string => {
  if (options.initialDoctorId && doctors.some((d) => d.id === options.initialDoctorId)) {
    return options.initialDoctorId;
  }
  if (options.primaryPhysicianName) {
    const match = doctors.find((d) => d.name === options.primaryPhysicianName);
    if (match) return match.id;
  }
  return "";
};

/** Next half hour, strictly in the future (default for the legacy free date picker). */
export const defaultLegacySchedule = (now: Date = new Date()): Date => {
  const date = new Date(now);
  date.setMinutes(date.getMinutes() + (30 - (date.getMinutes() % 30)), 0, 0);
  return date;
};
