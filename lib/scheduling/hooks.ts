import type { WaitlistEntry } from "@/types/appwrite.types";

/**
 * TODO(phase 2): notify the patient (SMS/email) that a slot opened up and give
 * them a short claim window. Phase 1 only logs. Log ids only - no PHI.
 */
export const onWaitlistOffer = async (
  entry: Pick<WaitlistEntry, "$id" | "doctorId">,
  slotStart: Date
): Promise<void> => {
  console.info(
    `[waitlist] offered slot ${slotStart.toISOString()} for doctor ${entry.doctorId} to entry ${entry.$id}`
  );
};
