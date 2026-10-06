// Pure helpers for the patient dashboard (tests/portal/appointments.test.ts).

export type DashboardAppointment = {
  $id: string;
  schedule: string | Date;
  status: "pending" | "scheduled" | "cancelled";
  primaryPhysician: string;
  reason?: string;
  doctorId?: string | null;
  visitType?: "in_person" | "video" | null;
  cancellationReason?: string | null;
};

const ms = (value: string | Date) => new Date(value).getTime();

/**
 * Upcoming = not cancelled and not in the past (soonest first).
 * Past = everything else (most recent first); cancelled appointments always
 * land in "past" so they do not look actionable.
 */
export const splitAppointments = <T extends DashboardAppointment>(
  appointments: readonly T[],
  now: Date = new Date()
): { upcoming: T[]; past: T[] } => {
  const upcoming: T[] = [];
  const past: T[] = [];
  for (const appointment of appointments) {
    const time = ms(appointment.schedule);
    if (appointment.status !== "cancelled" && time >= now.getTime()) {
      upcoming.push(appointment);
    } else {
      past.push(appointment);
    }
  }
  upcoming.sort((a, b) => ms(a.schedule) - ms(b.schedule));
  past.sort((a, b) => ms(b.schedule) - ms(a.schedule));
  return { upcoming, past };
};

/** Patients can only change appointments that are active and in the future. */
export const canModifyAppointment = (
  appointment: Pick<DashboardAppointment, "status" | "schedule">,
  now: Date = new Date()
): boolean => appointment.status !== "cancelled" && ms(appointment.schedule) > now.getTime();

export const isVideoVisit = (appointment: Pick<DashboardAppointment, "visitType">) =>
  appointment.visitType === "video";

/** Finds the doctor record for an appointment: by id when stored, else by name. */
export const findDoctorFor = <D extends { id: string; name: string }>(
  appointment: Pick<DashboardAppointment, "doctorId" | "primaryPhysician">,
  doctors: readonly D[]
): D | null => {
  if (appointment.doctorId) {
    const byId = doctors.find((d) => d.id === appointment.doctorId);
    if (byId) return byId;
  }
  return doctors.find((d) => d.name === appointment.primaryPhysician) ?? null;
};

export type VisitLinkResult =
  | { ok: true; data: { url: string; opensAt: string } }
  | { ok: false; error: string };

export type VideoLinkState =
  | { kind: "open"; url: string }
  | { kind: "early"; opensAt: string }
  | { kind: "unavailable"; message: string };

const safeVisitUrl = (url: unknown): url is string => {
  if (typeof url !== "string" || url.length === 0 || url.length > 2048) return false;
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
};

/** Decides what the "Join video visit" button does with I1's getVisitLink result. */
export const videoLinkState = (
  result: VisitLinkResult | null | undefined,
  now: Date = new Date()
): VideoLinkState => {
  if (!result || !result.ok) {
    return {
      kind: "unavailable",
      message:
        result && !result.ok && result.error
          ? result.error
          : "Your video visit link is not available yet. Please try again closer to your appointment.",
    };
  }
  const opensAt = Date.parse(result.data?.opensAt ?? "");
  if (!Number.isNaN(opensAt) && opensAt > now.getTime()) {
    return { kind: "early", opensAt: result.data.opensAt };
  }
  if (!safeVisitUrl(result.data?.url)) {
    return { kind: "unavailable", message: "Your video visit link could not be opened. Please contact the clinic." };
  }
  return { kind: "open", url: result.data.url };
};

/** "Reschedule" / "Cancel" are explained to the patient when not allowed. */
export const modifyBlockedReason = (
  appointment: Pick<DashboardAppointment, "status" | "schedule">,
  now: Date = new Date()
): string | null => {
  if (appointment.status === "cancelled") return "This appointment was cancelled.";
  if (ms(appointment.schedule) <= now.getTime()) return "This appointment has already taken place.";
  return null;
};
