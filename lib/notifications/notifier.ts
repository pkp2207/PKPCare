// Channel selection + delivery with fallback. Pure of Appwrite: providers are
// injected (defaults wired in `defaultProviders`).
import { safeLogLine } from "@/lib/compliance/redact";

import { channelMode, envChannels, isWhatsAppConfigured, parseChannelList } from "./config";
import { emailProvider } from "./email";
import { smsProvider } from "./sms";
import {
  type Channel,
  type DeliveryAttempt,
  type NotificationProvider,
  type NotifyResult,
  type Recipient,
  type TemplateData,
  type TemplateId,
} from "./types";
import { whatsappProvider } from "./whatsapp";

export const defaultProviders = (): Record<Channel, NotificationProvider> => ({
  sms: smsProvider,
  email: emailProvider,
  whatsapp: whatsappProvider,
});

/**
 * Ordered channel list for one send. A valid per-patient preference wins, else
 * NOTIFY_CHANNELS (default "sms"). WhatsApp is dropped unless configured. If
 * everything was filtered out the env default is used, then "sms".
 */
export const selectChannels = (
  preferred?: unknown,
  env: Record<string, string | undefined> = process.env
): Channel[] => {
  const whatsapp = isWhatsAppConfigured(env);
  const usable = (list: Channel[]) =>
    list.filter((channel) => channel !== "whatsapp" || whatsapp);

  const fromPatient = usable(parseChannelList(preferred));
  if (fromPatient.length > 0) return fromPatient;
  const fromEnv = usable(envChannels(env));
  return fromEnv.length > 0 ? fromEnv : ["sms"];
};

export type NotifyRequest = {
  to: Recipient;
  template: TemplateId;
  data: TemplateData;
  /** Per-patient preference (array or CSV), if the patient record has one. */
  preferredChannels?: unknown;
  idempotencyKey?: string;
  locale?: string;
};

export type NotifierDeps = {
  providers?: Partial<Record<Channel, NotificationProvider>>;
  env?: Record<string, string | undefined>;
};

/**
 * Sends through the selected channels. Never throws. `fallback` mode (default)
 * stops at the first channel that succeeds; `all` tries each.
 */
export const sendNotification = async (
  request: NotifyRequest,
  deps: NotifierDeps = {}
): Promise<NotifyResult> => {
  const env = deps.env ?? process.env;
  const providers = { ...defaultProviders(), ...deps.providers };
  const channels = selectChannels(request.preferredChannels, env);
  const mode = channelMode(env);

  const attempts: DeliveryAttempt[] = [];
  const delivered: Channel[] = [];

  for (const channel of channels) {
    const provider = providers[channel];
    let attempt: DeliveryAttempt;
    if (!provider) {
      attempt = { channel, ok: false, error: "no_provider" };
    } else {
      try {
        const result = await provider.send({
          channel,
          to: request.to,
          template: request.template,
          data: request.data,
          idempotencyKey: request.idempotencyKey,
          locale: request.locale,
        });
        attempt = { channel, ok: result.ok, error: result.ok ? undefined : result.error };
      } catch {
        // Never log the raw error: it may embed recipient data.
        attempt = { channel, ok: false, error: "provider_threw" };
      }
    }
    attempts.push(attempt);
    if (attempt.ok) {
      delivered.push(channel);
      if (mode === "fallback") break;
    } else {
      console.error(
        `[notify] send failed channel=${channel} template=${request.template} code=${safeLogLine(
          attempt.error ?? "unknown",
          40
        )}`
      );
    }
  }

  return { ok: delivered.length > 0, delivered, attempts };
};
