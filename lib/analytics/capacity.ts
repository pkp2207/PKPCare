// Available-slot capacity of a doctor over a window, from their weekly hours
// and time off (pure; reuses the scheduling engine so it matches what patients
// can actually book).
import {
  generateCandidateSlots,
  subtractTimeOff,
  type DoctorSchedule,
} from "@/lib/scheduling/schedule";

/** Slots the doctor offers with start in [from, to), minus time off. */
export const doctorCapacity = (
  schedule: DoctorSchedule,
  from: Date,
  to: Date
): number =>
  subtractTimeOff(
    generateCandidateSlots(schedule, from, to),
    schedule.timeOff
  ).length;

/** Most common timezone among the given ones (ties: first seen), else UTC. */
export const dominantTimeZone = (zones: readonly string[]): string => {
  const counts = new Map<string, number>();
  for (const zone of zones) counts.set(zone, (counts.get(zone) ?? 0) + 1);
  let best = "UTC";
  let bestCount = 0;
  for (const [zone, count] of Array.from(counts.entries())) {
    if (count > bestCount) {
      best = zone;
      bestCount = count;
    }
  }
  return best;
};
