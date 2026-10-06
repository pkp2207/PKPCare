// Pure Slot computation for the FHIR facade: a doctor's weekly hours expanded
// into slots, each marked free / busy / busy-unavailable.
import { BOOKING_MIN_LEAD_MINUTES } from "@/constants";
import {
  type DoctorSchedule,
  generateCandidateSlots,
  overlapsTimeOff,
} from "@/lib/scheduling/schedule";
import { MINUTE_MS } from "@/lib/scheduling/time";

import type { FhirSlotStatus } from "./mappers";

export type FhirSlot = {
  doctorId: string;
  start: Date;
  end: Date;
  status: FhirSlotStatus;
};

export type HeldSlot = {
  start: string;
  end: string;
  status: "booked" | "blocked";
};

const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) =>
  aStart < bEnd && aEnd > bStart;

/**
 * - `busy`: held by a booked slot document, or by a legacy appointment
 *   (`legacyStarts`, ISO instants without a slot document).
 * - `busy-unavailable`: blocked slot, time off, already past, or inside the
 *   booking lead time (not bookable by a patient any more).
 * - `free`: everything else.
 * Held slot documents that fall outside working hours (staff overrides) are
 * still reported as busy.
 */
export const buildSlots = ({
  doctor,
  held,
  legacyStarts,
  from,
  to,
  now,
}: {
  doctor: DoctorSchedule;
  held: HeldSlot[];
  legacyStarts: string[];
  from: Date;
  to: Date;
  now: Date;
}): FhirSlot[] => {
  const slotMs = doctor.slotMinutes * MINUTE_MS;
  const earliestFree = now.getTime() + BOOKING_MIN_LEAD_MINUTES * MINUTE_MS;

  const heldRanges = held
    .map((slot) => ({
      start: Date.parse(slot.start),
      end: Date.parse(slot.end),
      status: slot.status,
    }))
    .filter((slot) => !Number.isNaN(slot.start) && !Number.isNaN(slot.end));

  const legacyRanges = legacyStarts
    .map((iso) => Date.parse(iso))
    .filter((start) => !Number.isNaN(start))
    .map((start) => ({ start, end: start + slotMs }));

  const statusFor = (start: number, end: number): FhirSlotStatus => {
    if (
      heldRanges.some(
        (h) => h.status === "blocked" && overlaps(start, end, h.start, h.end),
      )
    ) {
      return "busy-unavailable";
    }
    if (
      heldRanges.some((h) => overlaps(start, end, h.start, h.end)) ||
      legacyRanges.some((l) => overlaps(start, end, l.start, l.end))
    ) {
      return "busy";
    }
    if (overlapsTimeOff({ start: new Date(start), end: new Date(end) }, doctor.timeOff)) {
      return "busy-unavailable";
    }
    if (start < earliestFree) return "busy-unavailable";
    return "free";
  };

  const byStart = new Map<number, FhirSlot>();
  for (const candidate of generateCandidateSlots(doctor, from, to)) {
    const start = candidate.start.getTime();
    byStart.set(start, {
      doctorId: doctor.id,
      start: candidate.start,
      end: candidate.end,
      status: statusFor(start, candidate.end.getTime()),
    });
  }

  // Held documents that are not on the candidate grid (overrides).
  for (const h of heldRanges) {
    if (h.start < from.getTime() || h.start >= to.getTime()) continue;
    if (byStart.has(h.start)) continue;
    byStart.set(h.start, {
      doctorId: doctor.id,
      start: new Date(h.start),
      end: new Date(h.end),
      status: h.status === "blocked" ? "busy-unavailable" : "busy",
    });
  }

  return Array.from(byStart.values()).sort(
    (a, b) => a.start.getTime() - b.start.getTime(),
  );
};
