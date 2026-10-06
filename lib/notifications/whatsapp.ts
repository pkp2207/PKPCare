// WhatsApp via the Meta Cloud API (plain fetch, no SDK). Enabled only when
// WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID are set. Business-initiated
// messages must use pre-approved TEMPLATE messages, so this sends template
// messages whose names/parameters are defined in templates.ts.
import { isWhatsAppConfigured } from "./config";
import { renderTemplate } from "./templates";
import type { NotificationProvider, SendRequest, SendResult } from "./types";

const DEFAULT_API_VERSION = "v20.0";
const REQUEST_TIMEOUT_MS = 8000;

/** Digits only (Meta wants the number without "+"); null if implausible. */
export const normalizeWhatsAppNumber = (phone?: string | null): string | null => {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
};

export const createWhatsAppProvider = (
  options: {
    env?: Record<string, string | undefined>;
    fetchImpl?: typeof fetch;
  } = {}
): NotificationProvider => ({
  channel: "whatsapp",
  async send(request: SendRequest): Promise<SendResult> {
    const env = options.env ?? process.env;
    if (!isWhatsAppConfigured(env)) return { ok: false, error: "whatsapp_disabled" };

    const to = normalizeWhatsAppNumber(request.to.phone);
    if (!to) return { ok: false, error: "no_phone" };

    const { whatsapp } = renderTemplate(request.template, request.data, request.locale);
    const version = env.WHATSAPP_API_VERSION?.trim() || DEFAULT_API_VERSION;
    const url = `https://graph.facebook.com/${version}/${encodeURIComponent(
      (env.WHATSAPP_PHONE_NUMBER_ID as string).trim()
    )}/messages`;

    const body = {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: whatsapp.name,
        language: { code: env.WHATSAPP_TEMPLATE_LANG?.trim() || whatsapp.language },
        components: [
          {
            type: "body",
            parameters: whatsapp.params.map((text) => ({ type: "text", text })),
          },
        ],
      },
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await (options.fetchImpl ?? fetch)(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${(env.WHATSAPP_TOKEN as string).trim()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      // Error bodies can echo the recipient number, so only the status is kept.
      if (!response.ok) return { ok: false, error: `whatsapp_http_${response.status}` };
      const json = (await response.json().catch(() => null)) as {
        messages?: { id?: string }[];
      } | null;
      return { ok: true, providerId: json?.messages?.[0]?.id };
    } catch (error) {
      const aborted = (error as { name?: string } | null)?.name === "AbortError";
      return { ok: false, error: aborted ? "whatsapp_timeout" : "whatsapp_network" };
    } finally {
      clearTimeout(timer);
    }
  },
});

export const whatsappProvider: NotificationProvider = createWhatsAppProvider();
