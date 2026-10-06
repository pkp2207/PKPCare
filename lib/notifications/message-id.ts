import { createHash } from "node:crypto";

/**
 * Appwrite message ids: <= 36 chars, [A-Za-z0-9._-], not starting with a
 * special character. Deterministic for a given (channel, key) so a repeated
 * send is rejected by Appwrite with HTTP 409 instead of delivering twice.
 */
export const deterministicMessageId = (channel: string, key: string): string =>
  `m${createHash("sha256").update(`${channel}:${key}`).digest("hex").slice(0, 35)}`;
