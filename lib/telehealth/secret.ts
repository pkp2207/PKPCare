// Server only. Secret used for room names and visit tokens.
export class TelehealthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TelehealthConfigError";
  }
}

/**
 * TELEHEALTH_ROOM_SECRET, falling back to ADMIN_SESSION_SECRET. Fails closed:
 * with neither set, nothing can be signed or derived. Each use adds its own
 * context prefix, so the same secret never signs two kinds of value.
 */
export const getTelehealthSecret = (): string => {
  const secret =
    process.env.TELEHEALTH_ROOM_SECRET?.trim() ||
    process.env.ADMIN_SESSION_SECRET?.trim();
  if (!secret) {
    throw new TelehealthConfigError(
      "TELEHEALTH_ROOM_SECRET (or ADMIN_SESSION_SECRET) is not configured",
    );
  }
  return secret;
};
