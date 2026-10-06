// Deterministic, unguessable room names. No schema change: the same
// (appointmentId, start) always derives the same room, a reschedule derives a
// new one. Server only.
import { createHmac } from "node:crypto";

import { getTelehealthSecret } from "./secret";

const ROOM_CONTEXT = "pkp-telehealth-room:v1";
const ROOM_PREFIX = "pkp-";
const ROOM_CHARS = 24; // 24 base32 chars = 120 bits

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

/** RFC 4648 base32 (lowercase, unpadded). */
export const base32 = (bytes: Uint8Array): string => {
  let bits = 0;
  let value = 0;
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
};

/** Canonical ISO form, so Date / string inputs for the same instant agree. */
const canonicalStart = (start: Date | string): string => {
  const date = start instanceof Date ? start : new Date(start);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid start time");
  return date.toISOString();
};

export const deriveRoomName = (
  appointmentId: string,
  start: Date | string,
  secret: string = getTelehealthSecret(),
): string => {
  if (!appointmentId) throw new Error("appointmentId is required");
  const mac = createHmac("sha256", secret)
    .update(`${ROOM_CONTEXT}\n${appointmentId}\n${canonicalStart(start)}`)
    .digest();
  return ROOM_PREFIX + base32(mac).slice(0, ROOM_CHARS);
};
