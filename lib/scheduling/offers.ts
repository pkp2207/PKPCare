import { BOOKING_MIN_LEAD_MINUTES } from "@/constants";
import * as waitlistRepo from "@/lib/appwrite/waitlist.repository";
import type { WaitlistEntry } from "@/types/appwrite.types";

import { onWaitlistOffer } from "./hooks";
import { MINUTE_MS } from "./time";
import { selectWaitlistCandidate } from "./waitlist";

/**
 * Mark the first matching waiting entry as "offered" for a slot that just
 * freed up and return it (null when nobody matches, the slot is no longer
 * bookable, or anything fails). Never throws. Deliberately NOT in a
 * "use server" file: it must not be callable from the browser.
 *
 * Not atomic: two slots freed at the same instant could offer the same entry
 * twice; harmless because offers are advisory and booking is atomic.
 */
export const offerFreedSlotToWaitlist = async (
  doctorId: string,
  start: Date,
  opts: { excludeUserId?: string; now?: Date } = {}
): Promise<WaitlistEntry | null> => {
  try {
    const now = opts.now ?? new Date();
    if (start.getTime() < now.getTime() + BOOKING_MIN_LEAD_MINUTES * MINUTE_MS) {
      return null;
    }

    const entries = await waitlistRepo.listWaitingForDoctor(doctorId);
    const candidate = selectWaitlistCandidate(
      entries,
      doctorId,
      start,
      opts.excludeUserId
    );
    if (!candidate) return null;

    const offered = await waitlistRepo.updateWaitlistEntry(candidate.$id, {
      status: "offered",
      offeredStart: start.toISOString(),
      offeredAt: now.toISOString(),
    });
    try {
      await onWaitlistOffer(offered, start);
    } catch (error) {
      console.error("Waitlist offer hook failed:", error);
    }
    return offered;
  } catch (error) {
    console.error("Failed to offer freed slot to waitlist:", error);
    return null;
  }
};

/**
 * Best effort: once a patient books, close their matching live waitlist
 * entries for that doctor. Never throws.
 */
export const markWaitlistFulfilled = async (
  userId: string,
  doctorId: string,
  start: Date
): Promise<void> => {
  try {
    const entries = await waitlistRepo.listActiveEntriesForUser(userId);
    const startMs = start.getTime();
    await Promise.all(
      entries
        .filter(
          (entry) =>
            entry.doctorId === doctorId &&
            Date.parse(entry.earliest) <= startMs &&
            startMs <= Date.parse(entry.latest)
        )
        .map((entry) =>
          waitlistRepo.updateWaitlistEntry(entry.$id, { status: "fulfilled" })
        )
    );
  } catch (error) {
    console.error("Failed to mark waitlist entries fulfilled:", error);
  }
};
