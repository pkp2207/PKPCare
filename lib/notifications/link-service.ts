// Server-side logic behind /a/<token>. Not a "use server" file; the exported
// server actions live in lib/actions/notification.actions.ts.
import * as waitlistRepo from "@/lib/appwrite/waitlist.repository";
import { resolveDoctorById } from "@/lib/scheduling/doctors";

import { offerClaimMinutes } from "./config";
import { type LinkClaims, type LinkPurpose, verifyLinkToken } from "./links";
import { getNotificationAppointment } from "./store";

export type AppointmentView = {
  kind: "appointment";
  token: string;
  claims: LinkClaims;
  appointment: {
    id: string;
    userId: string;
    doctorName: string;
    start: string;
    timezone: string | null;
    status: string;
    visitType: string;
    confirmed: boolean;
    depositStatus: string | null;
  };
  can: { confirm: boolean; cancel: boolean; reschedule: boolean };
};

export type WaitlistView = {
  kind: "waitlist";
  claims: LinkClaims;
  offer: {
    userId: string;
    doctorId: string;
    doctorName: string;
    start: string;
    timezone: string | null;
  };
};

export type LinkView =
  | AppointmentView
  | WaitlistView
  | { kind: "invalid"; reason: "expired" | "unavailable" };

const INVALID: LinkView = { kind: "invalid", reason: "unavailable" };

const timezoneOf = async (doctorId?: string | null) => {
  if (!doctorId) return null;
  try {
    return (await resolveDoctorById(doctorId))?.schedule.timezone ?? null;
  } catch {
    return null;
  }
};

const iso = (value: unknown) => new Date(value as string | number | Date).toISOString();

/** Everything the page shows. Minimal: doctor, time, status, visit type. */
export const resolveLink = async (
  token: string,
  now: Date = new Date()
): Promise<LinkView> => {
  const inspected = verifyLinkToken(token, undefined, { now });
  if (!inspected.ok) {
    return inspected.reason === "expired"
      ? { kind: "invalid", reason: "expired" }
      : INVALID;
  }
  const { claims } = inspected;

  try {
    if (claims.purposes.includes("waitlist")) {
      const entry = await waitlistRepo.getWaitlistEntry(claims.appointmentId);
      if (
        entry.userId !== claims.userId ||
        entry.status !== "offered" ||
        !entry.offeredStart ||
        new Date(entry.offeredStart).getTime() <= now.getTime()
      ) {
        return INVALID;
      }
      // The claim window may be shorter than the token: offers lapse at
      // offeredAt + window even if the token has not expired yet.
      if (
        entry.offeredAt &&
        now.getTime() > Date.parse(entry.offeredAt) + offerClaimMinutes() * 60_000 + 60_000
      ) {
        return { kind: "invalid", reason: "expired" };
      }
      const doctor = await resolveDoctorById(entry.doctorId);
      return {
        kind: "waitlist",
        claims,
        offer: {
          userId: entry.userId,
          doctorId: entry.doctorId,
          doctorName: doctor?.name ?? "your doctor",
          start: iso(entry.offeredStart),
          timezone: doctor?.schedule.timezone ?? null,
        },
      };
    }

    const appointment = await getNotificationAppointment(claims.appointmentId);
    if (appointment.userId !== claims.userId) return INVALID;
    const live = appointment.status !== "cancelled";
    const future = new Date(appointment.schedule as unknown as string).getTime() > now.getTime();
    const confirmed = Boolean(appointment.confirmedByPatientAt);
    const allows = (purpose: LinkPurpose) => claims.purposes.includes(purpose);
    return {
      kind: "appointment",
      token,
      claims,
      appointment: {
        id: appointment.$id,
        userId: appointment.userId,
        doctorName: appointment.primaryPhysician,
        start: iso(appointment.schedule),
        timezone: await timezoneOf(appointment.doctorId),
        status: appointment.status,
        visitType: appointment.visitType ?? "in_person",
        confirmed,
        depositStatus: appointment.depositStatus ?? null,
      },
      can: {
        confirm: allows("confirm") && live && future && !confirmed,
        cancel: allows("cancel") && live && future,
        reschedule: allows("reschedule") && live && future,
      },
    };
  } catch {
    return INVALID;
  }
};
