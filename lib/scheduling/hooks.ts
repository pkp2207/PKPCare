import * as patientRepo from "@/lib/appwrite/patient.repository";
import { safeLogLine } from "@/lib/compliance/redact";
import { notifyTimeoutMs, offerClaimMinutes } from "@/lib/notifications/config";
import { withTimeout } from "@/lib/notifications/events";
import { createWaitlistLink } from "@/lib/notifications/links";
import { sendNotification } from "@/lib/notifications/notifier";
import { resolveDoctorById } from "@/lib/scheduling/doctors";
import type { WaitlistEntry } from "@/types/appwrite.types";

/**
 * Called when a freed slot has been offered to a waitlist entry. Sends the
 * waitlist-offer message with a signed link that expires with the claim window
 * (WAITLIST_OFFER_MINUTES, default 30) or at the slot time, whichever is first.
 * The caller (offers.ts) catches errors; failures here only log ids.
 */
export const onWaitlistOffer = async (
  entry: Pick<WaitlistEntry, "$id" | "doctorId" | "userId">,
  slotStart: Date
): Promise<void> => {
  console.info(
    `[waitlist] offered slot ${slotStart.toISOString()} for doctor ${entry.doctorId} to entry ${entry.$id}`
  );
  try {
    await withTimeout(sendOffer(entry, slotStart), notifyTimeoutMs(), undefined);
  } catch (error) {
    console.error(`[waitlist] offer notification failed: ${safeLogLine((error as Error)?.name ?? "error", 60)}`);
  }
};

const sendOffer = async (
  entry: Pick<WaitlistEntry, "$id" | "doctorId" | "userId">,
  slotStart: Date
) => {
  const minutes = offerClaimMinutes();
  const expiresAt = new Date(
    Math.min(Date.now() + minutes * 60_000, slotStart.getTime())
  );
  const doctor = await resolveDoctorById(entry.doctorId).catch(() => null);
  const patient = await patientRepo
    .getPatientByUserId(entry.userId, { decrypt: false })
    .catch(() => null);
  const p = patient as { phone?: string; email?: string; notifyChannels?: unknown } | null;

  await sendNotification({
    to: { userId: entry.userId, phone: p?.phone ?? null, email: p?.email ?? null },
    template: "waitlist_offer",
    data: {
      doctorName: doctor?.name,
      start: slotStart,
      timezone: doctor?.schedule.timezone ?? null,
      link: createWaitlistLink({ entryId: entry.$id, userId: entry.userId, expiresAt }),
      claimMinutes: minutes,
    },
    preferredChannels: p?.notifyChannels,
    idempotencyKey: `waitlist_offer:${entry.$id}:${slotStart.getTime()}`,
  });
};
