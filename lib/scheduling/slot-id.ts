import { createHash } from "node:crypto";

// Appwrite custom document ids: <= 36 chars, [a-zA-Z0-9._-], no leading
// special character.
const APPWRITE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/;

/**
 * Deterministic slot document id. Two bookings of the same (doctor, start)
 * compute the same id, so the second createDocument fails with HTTP 409 -
 * the database, not a check-then-write, arbitrates the race.
 *
 *   `${doctorId}_${startEpochMs}`     when that is a legal Appwrite id (<= 36)
 *   "h" + sha256(doctorId|epoch)[0:35] otherwise (long / unusual doctor ids)
 */
export const slotId = (doctorId: string, start: Date | number | string) => {
  const epoch = new Date(start).getTime();
  if (Number.isNaN(epoch)) throw new Error("Invalid slot start");
  const plain = `${doctorId}_${epoch}`;
  if (APPWRITE_ID.test(plain)) return plain;
  return `h${createHash("sha256").update(`${doctorId}|${epoch}`).digest("hex").slice(0, 35)}`;
};
