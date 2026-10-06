// Public surface of the telehealth module (server only).
import { getProvider, getProviderName } from "./providers";

export { getProvider, getProviderName } from "./providers";
export type {
  RoomRequest,
  TelehealthProvider,
  TelehealthProviderName,
} from "./providers";
export { deriveRoomName } from "./room";
export {
  signVisitToken,
  verifyVisitToken,
  type VisitClaims,
  type VisitRole,
} from "./token";
export {
  computeVisitWindow,
  VISIT_CLOSE_AFTER_MINUTES,
  VISIT_OPEN_BEFORE_MINUTES,
  visitTokenExpiry,
} from "./window";

/** For UI gating: true when TELEHEALTH_PROVIDER is a real provider (not `none`). */
export const isTelehealthEnabled = (): boolean => getProviderName() !== "none";

/** `getRoom({ appointmentId, start }) -> { url }` of the configured provider. */
export const getRoom = (request: { appointmentId: string; start: Date | string }) =>
  getProvider().getRoom(request);
