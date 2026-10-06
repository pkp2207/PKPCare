// Telehealth providers. `none` (default) disables video visits; `jitsi` builds
// a Jitsi room URL and needs no vendor account.
import { deriveRoomName } from "./room";
import { TelehealthConfigError } from "./secret";

export type TelehealthProviderName = "none" | "jitsi";

export type RoomRequest = { appointmentId: string; start: Date | string };

export interface TelehealthProvider {
  readonly name: TelehealthProviderName;
  getRoom(request: RoomRequest): Promise<{ url: string }>;
}

export const DEFAULT_JITSI_BASE_URL = "https://meet.jit.si";

// Opt-in prejoin page; deep-link off so the browser is not pushed to an app.
const JITSI_HASH = "#config.prejoinConfig.enabled=true&config.disableDeepLinking=true";

export const getProviderName = (): TelehealthProviderName =>
  process.env.TELEHEALTH_PROVIDER?.trim().toLowerCase() === "jitsi"
    ? "jitsi"
    : "none";

/** https only (http allowed for localhost); path kept, query / hash dropped. */
export const resolveJitsiBaseUrl = (
  raw: string | undefined = process.env.TELEHEALTH_BASE_URL,
): string => {
  const value = raw?.trim() || DEFAULT_JITSI_BASE_URL;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TelehealthConfigError("TELEHEALTH_BASE_URL is not a valid URL");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new TelehealthConfigError("TELEHEALTH_BASE_URL must use https");
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
};

let warnedPublicJitsi = false;

export const noneProvider: TelehealthProvider = {
  name: "none",
  async getRoom() {
    throw new TelehealthConfigError("Telehealth is not enabled");
  },
};

export const jitsiProvider: TelehealthProvider = {
  name: "jitsi",
  async getRoom({ appointmentId, start }) {
    const base = resolveJitsiBaseUrl();
    if (
      !warnedPublicJitsi &&
      process.env.NODE_ENV === "production" &&
      new URL(base).hostname === "meet.jit.si"
    ) {
      warnedPublicJitsi = true;
      console.warn(
        "[telehealth] meet.jit.si has no room access control; do not use it with real patient data (see docs/telehealth.md).",
      );
    }
    return { url: `${base}/${deriveRoomName(appointmentId, start)}${JITSI_HASH}` };
  },
};

export const getProvider = (): TelehealthProvider =>
  getProviderName() === "jitsi" ? jitsiProvider : noneProvider;
