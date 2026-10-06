import type { WaitlistEntry } from "@/types/appwrite.types";

type Candidate = Pick<
  WaitlistEntry,
  "$id" | "userId" | "doctorId" | "earliest" | "latest" | "status" | "createdAt"
>;

/**
 * First waiting entry (oldest createdAt, then id) for this doctor whose
 * [earliest, latest] window contains the freed slot. Pure.
 */
export const selectWaitlistCandidate = <T extends Candidate>(
  entries: T[],
  doctorId: string,
  slotStart: Date,
  excludeUserId?: string
): T | null => {
  const startMs = slotStart.getTime();
  const matches = entries.filter(
    (entry) =>
      entry.status === "waiting" &&
      entry.doctorId === doctorId &&
      entry.userId !== excludeUserId &&
      Date.parse(entry.earliest) <= startMs &&
      startMs <= Date.parse(entry.latest)
  );
  matches.sort(
    (a, b) =>
      Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
      a.$id.localeCompare(b.$id)
  );
  return matches[0] ?? null;
};
