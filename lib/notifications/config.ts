// Env-derived notification settings. Read at call time (never cached) so tests
// and runtime config changes behave predictably.
import { type Channel, isChannel } from "./types";

type Env = Record<string, string | undefined>;

const DEFAULT_CHANNELS: Channel[] = ["sms"];

export const parseChannelList = (value: unknown): Channel[] => {
  const items: unknown[] = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  const out: Channel[] = [];
  for (const item of items) {
    const channel = typeof item === "string" ? item.trim().toLowerCase() : item;
    if (isChannel(channel) && !out.includes(channel)) out.push(channel);
  }
  return out;
};

/** `NOTIFY_CHANNELS` (comma separated, ordered). Default `["sms"]`. */
export const envChannels = (env: Env = process.env): Channel[] => {
  const parsed = parseChannelList(env.NOTIFY_CHANNELS);
  return parsed.length > 0 ? parsed : [...DEFAULT_CHANNELS];
};

/** `fallback` (default): first channel that succeeds wins. `all`: try every one. */
export const channelMode = (env: Env = process.env): "fallback" | "all" =>
  (env.NOTIFY_CHANNELS_MODE ?? "").trim().toLowerCase() === "all"
    ? "all"
    : "fallback";

export const isWhatsAppConfigured = (env: Env = process.env): boolean =>
  Boolean(env.WHATSAPP_TOKEN?.trim() && env.WHATSAPP_PHONE_NUMBER_ID?.trim());

const positiveInt = (value: string | undefined, fallback: number, max: number) => {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : fallback;
};

/** How long a waitlist offer can be claimed. Default 30 minutes. */
export const offerClaimMinutes = (env: Env = process.env): number =>
  positiveInt(env.WAITLIST_OFFER_MINUTES, 30, 24 * 60);

/** Expected gap between cron runs. Default 10 minutes. */
export const reminderIntervalMinutes = (env: Env = process.env): number =>
  positiveInt(env.REMINDER_CRON_INTERVAL_MINUTES, 10, 120);

/** Max appointments handled per window per cron run. Default 100, cap 200. */
export const reminderBatchSize = (env: Env = process.env): number =>
  positiveInt(env.REMINDER_BATCH_SIZE, 100, 200);

/** Per-notification time budget so a slow provider cannot hang an action. */
export const notifyTimeoutMs = (env: Env = process.env): number =>
  positiveInt(env.NOTIFY_TIMEOUT_MS, 8000, 30000);

/**
 * "Booking received" is a new message that the previous code never sent, so it
 * is opt-in (`NOTIFY_BOOKING_RECEIVED=true`) to leave existing SMS behaviour
 * unchanged.
 */
export const sendBookingReceived = (env: Env = process.env): boolean =>
  (env.NOTIFY_BOOKING_RECEIVED ?? "").trim().toLowerCase() === "true";

/**
 * Public base URL used in message links. `APP_BASE_URL`, then
 * `NEXT_PUBLIC_APP_URL`, then Vercel's `VERCEL_URL`. Null when unset, in which
 * case messages go out without a link.
 */
export const appBaseUrl = (env: Env = process.env): string | null => {
  const raw =
    env.APP_BASE_URL?.trim() ||
    env.NEXT_PUBLIC_APP_URL?.trim() ||
    (env.VERCEL_URL?.trim() ? `https://${env.VERCEL_URL.trim()}` : "");
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
};
