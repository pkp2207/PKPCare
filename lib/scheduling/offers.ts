import { BOOKING_MIN_LEAD_MINUTES } from "@/constants";
import { isNotFound } from "@/lib/appwrite/client";
import * as slotRepo from "@/lib/appwrite/slot.repository";
import * as waitlistRepo from "@/lib/appwrite/waitlist.repository";
import { offerClaimMinutes } from "@/lib/notifications/config";
import { listOfferedWaitlist } from "@/lib/notifications/store";
import type { WaitlistEntry } from "@/types/appwrite.types";

import { onWaitlistOffer } from "./hooks";
import { slotId } from "./slot-id";
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

export type ExpireOffersSummary = {
  dryRun: boolean;
  found: number;
  expired: number;
  reoffered: number;
  errors: number;
};

/**
 * Moves `offered` entries whose claim window has lapsed to `expired` and, when
 * the offered time is still free and bookable, offers it to the next waiting
 * entry. Bounded (`limit`), per-entry error isolation, never throws. Run by
 * app/api/cron/reminders.
 */
export const expireStaleWaitlistOffers = async (
  options: { now?: Date; dryRun?: boolean; limit?: number } = {}
): Promise<ExpireOffersSummary> => {
  const now = options.now ?? new Date();
  const summary: ExpireOffersSummary = {
    dryRun: Boolean(options.dryRun),
    found: 0,
    expired: 0,
    reoffered: 0,
    errors: 0,
  };
  let entries: WaitlistEntry[];
  try {
    entries = await listOfferedWaitlist(options.limit ?? 100);
  } catch (error) {
    console.error("Failed to list offered waitlist entries:", (error as Error)?.name);
    summary.errors += 1;
    return summary;
  }

  const windowMs = offerClaimMinutes() * MINUTE_MS;
  for (const entry of entries) {
    const offeredAt = entry.offeredAt ? Date.parse(entry.offeredAt) : NaN;
    const offeredStart = entry.offeredStart ? new Date(entry.offeredStart) : null;
    const lapsed =
      !Number.isFinite(offeredAt) ||
      now.getTime() >= offeredAt + windowMs ||
      (offeredStart !== null && offeredStart.getTime() <= now.getTime());
    if (!lapsed) continue;
    summary.found += 1;
    if (summary.dryRun) continue;

    try {
      await waitlistRepo.updateWaitlistEntry(entry.$id, { status: "expired" });
      summary.expired += 1;

      if (!offeredStart) continue;
      try {
        await slotRepo.getSlot(slotId(entry.doctorId, offeredStart));
        continue; // someone booked (or blocked) it meanwhile
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
      const next = await offerFreedSlotToWaitlist(entry.doctorId, offeredStart, {
        excludeUserId: entry.userId,
        now,
      });
      if (next) summary.reoffered += 1;
    } catch (error) {
      summary.errors += 1;
      console.error("Failed to expire waitlist offer:", (error as Error)?.name);
    }
  }
  return summary;
};
