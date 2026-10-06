// One-time password generator for staff accounts (server only: Node crypto).
import { randomInt } from "node:crypto";

const SETS = [
  "abcdefghijkmnopqrstuvwxyz",
  "ABCDEFGHJKLMNPQRSTUVWXYZ",
  "23456789",
  "!@#$%^&*-_=+",
];

/**
 * Random password with at least one character from every set, shuffled with a
 * CSPRNG (same policy as scripts/create-staff.mjs). Ambiguous glyphs
 * (0/O, 1/l/I) are left out so it can be read out or typed.
 */
export const generatePassword = (length = 24): string => {
  const size = Math.max(length, SETS.length);
  const all = SETS.join("");
  const chars = SETS.map((set) => set[randomInt(set.length)]);
  while (chars.length < size) chars.push(all[randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
};
