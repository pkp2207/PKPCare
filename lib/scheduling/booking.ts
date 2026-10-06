import { ORPHAN_SLOT_GRACE_MINUTES } from "@/constants";
import * as appointmentRepo from "@/lib/appwrite/appointment.repository";
import { isConflict, isNotFound } from "@/lib/appwrite/client";
import * as slotRepo from "@/lib/appwrite/slot.repository";
import type { Slot } from "@/types/appwrite.types";

import { offerFreedSlotToWaitlist } from "./offers";
import { slotId } from "./slot-id";
import { MINUTE_MS } from "./time";

export const SLOT_TAKEN_MESSAGE =
  "That time was just taken. Please choose another time.";

export class SlotTakenError extends Error {
  constructor() {
    super(SLOT_TAKEN_MESSAGE);
    this.name = "SlotTakenError";
  }
}

/**
 * A slot document can be orphaned if the process died between "create slot"
 * and "create appointment" (or the rollback delete failed). It is reaped only
 * when it is older than the grace period AND its appointment is missing /
 * cancelled / points elsewhere, so an in-flight booking is never stolen.
 */
const reapOrphanSlot = async (id: string, now: Date): Promise<boolean> => {
  let existing: Slot;
  try {
    existing = await slotRepo.getSlot(id);
  } catch (error) {
    if (isNotFound(error)) return true; // vanished: safe to retry create
    throw error;
  }
  if (existing.status !== "booked" || !existing.appointmentId) return false;

  const age = now.getTime() - Date.parse(existing.$createdAt);
  if (!(age >= ORPHAN_SLOT_GRACE_MINUTES * MINUTE_MS)) return false;

  let orphan = false;
  try {
    const appointment = await appointmentRepo.getAppointmentDocument(
      existing.appointmentId
    );
    orphan = appointment.status === "cancelled" || appointment.slotId !== id;
  } catch (error) {
    if (!isNotFound(error)) throw error;
    orphan = true;
  }
  if (!orphan) return false;

  await slotRepo.deleteSlot(id);
  return true;
};

/**
 * Atomically claim a (doctor, start) slot: the slot document id is
 * deterministic, so a concurrent booking of the same time fails with HTTP 409
 * and we surface SlotTakenError. No query-then-insert race.
 */
export const reserveSlot = async ({
  doctorId,
  start,
  end,
  appointmentId,
  now = new Date(),
}: {
  doctorId: string;
  start: Date;
  end: Date;
  appointmentId: string;
  now?: Date;
}): Promise<Slot> => {
  const id = slotId(doctorId, start);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await slotRepo.createSlot({
        id,
        doctorId,
        start,
        end,
        appointmentId,
        status: "booked",
      });
    } catch (error) {
      if (!isConflict(error)) throw error;
      if (attempt === 0 && (await reapOrphanSlot(id, now))) continue;
      throw new SlotTakenError();
    }
  }
  throw new SlotTakenError();
};

/** Delete a slot document (rollback / cancel). Never throws; logs failures. */
export const releaseSlot = async (id: string): Promise<boolean> => {
  try {
    await slotRepo.deleteSlot(id);
    return true;
  } catch (error) {
    console.error("Failed to release slot:", id, error);
    return false;
  }
};

/**
 * Free a slot because the booking was cancelled/moved, then offer it to the
 * waitlist (awaited so it survives serverless teardown; it never throws).
 */
export const releaseSlotAndOffer = async ({
  slotId: id,
  doctorId,
  start,
  excludeUserId,
}: {
  slotId: string;
  doctorId: string;
  start: Date;
  excludeUserId?: string;
}): Promise<void> => {
  const released = await releaseSlot(id);
  if (released) {
    await offerFreedSlotToWaitlist(doctorId, start, { excludeUserId });
  }
};
