import { describe, expect, it, vi } from "vitest";

import { envChannels, parseChannelList } from "@/lib/notifications/config";
import { selectChannels, sendNotification } from "@/lib/notifications/notifier";
import type { Channel, NotificationProvider } from "@/lib/notifications/types";
import { createWhatsAppProvider, normalizeWhatsAppNumber } from "@/lib/notifications/whatsapp";

vi.mock("@/lib/appwrite/appointment.repository", () => ({ sendSms: vi.fn() }));
vi.mock("@/lib/appwrite/client", () => ({ getClients: vi.fn() }));

const WA_ENV = { WHATSAPP_TOKEN: "tok", WHATSAPP_PHONE_NUMBER_ID: "123" };

const provider = (channel: Channel, ok: boolean): NotificationProvider & { send: ReturnType<typeof vi.fn> } => ({
  channel,
  send: vi.fn(async () => (ok ? { ok: true } : { ok: false, error: "boom" })),
});

const base = {
  to: { userId: "u1" },
  template: "confirmed" as const,
  data: { doctorName: "Jane", start: new Date("2026-10-08T10:00:00Z") },
};

describe("channel selection", () => {
  it("defaults to sms", () => {
    expect(envChannels({})).toEqual(["sms"]);
    expect(selectChannels(undefined, {})).toEqual(["sms"]);
  });

  it("parses env lists, dropping junk and duplicates", () => {
    expect(parseChannelList("Email, sms,fax,email")).toEqual(["email", "sms"]);
    expect(selectChannels(undefined, { NOTIFY_CHANNELS: "email,sms" })).toEqual(["email", "sms"]);
  });

  it("honours a per-patient preference over the env default", () => {
    expect(selectChannels(["email"], { NOTIFY_CHANNELS: "sms" })).toEqual(["email"]);
    expect(selectChannels("email,sms", {})).toEqual(["email", "sms"]);
    expect(selectChannels("fax", { NOTIFY_CHANNELS: "email" })).toEqual(["email"]);
  });

  it("drops whatsapp unless configured", () => {
    expect(selectChannels(undefined, { NOTIFY_CHANNELS: "whatsapp,sms" })).toEqual(["sms"]);
    expect(selectChannels(undefined, { NOTIFY_CHANNELS: "whatsapp,sms", ...WA_ENV })).toEqual(["whatsapp", "sms"]);
    expect(selectChannels(undefined, { NOTIFY_CHANNELS: "whatsapp" })).toEqual(["sms"]);
  });
});

describe("delivery", () => {
  it("falls back to the next channel when the first fails", async () => {
    const email = provider("email", false);
    const sms = provider("sms", true);
    const result = await sendNotification(base, {
      providers: { email, sms },
      env: { NOTIFY_CHANNELS: "email,sms" },
    });
    expect(result).toMatchObject({ ok: true, delivered: ["sms"] });
    expect(result.attempts.map((a) => a.channel)).toEqual(["email", "sms"]);
  });

  it("stops at the first success in fallback mode, tries all in 'all' mode", async () => {
    const email = provider("email", true);
    const sms = provider("sms", true);
    await sendNotification(base, { providers: { email, sms }, env: { NOTIFY_CHANNELS: "email,sms" } });
    expect(sms.send).not.toHaveBeenCalled();
    const r = await sendNotification(base, {
      providers: { email, sms },
      env: { NOTIFY_CHANNELS: "email,sms", NOTIFY_CHANNELS_MODE: "all" },
    });
    expect(r.delivered).toEqual(["email", "sms"]);
  });

  it("reports failure, never throws, and does not log recipient data", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const sms: NotificationProvider = {
      channel: "sms",
      send: async () => {
        throw new Error("fail +14155550123 pat@example.com");
      },
    };
    const r = await sendNotification(
      { ...base, to: { userId: "u1", phone: "+14155550123", email: "pat@example.com" } },
      { providers: { sms }, env: {} }
    );
    expect(r.ok).toBe(false);
    expect(JSON.stringify(spy.mock.calls)).not.toMatch(/415555|pat@example/);
    spy.mockRestore();
  });
});

describe("whatsapp provider", () => {
  const req = {
    channel: "whatsapp" as const,
    to: { userId: "u1", phone: "+1 (415) 555-0123" },
    template: "reminder_24h" as const,
    data: { doctorName: "Jane", start: new Date("2026-10-08T10:00:00Z"), link: "https://x.test/a/t" },
  };

  it("is disabled (no network call) when env is unset", async () => {
    const fetchImpl = vi.fn();
    const p = createWhatsAppProvider({ env: {}, fetchImpl: fetchImpl as never });
    expect(await p.send(req)).toEqual({ ok: false, error: "whatsapp_disabled" });
    const partial = createWhatsAppProvider({ env: { WHATSAPP_TOKEN: "t" }, fetchImpl: fetchImpl as never });
    expect((await partial.send(req)).error).toBe("whatsapp_disabled");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("posts a template message to the Cloud API", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }), { status: 200 }));
    const p = createWhatsAppProvider({ env: WA_ENV, fetchImpl: fetchImpl as never });
    const result = await p.send(req);
    expect(result).toEqual({ ok: true, providerId: "wamid.1" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v20.0/123/messages");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ messaging_product: "whatsapp", to: "14155550123", type: "template" });
    expect(body.template.name).toBe("pkpcare_reminder_24h");
    expect(body.template.components[0].parameters).toHaveLength(3);
  });

  it("returns only a status code on HTTP errors and rejects bad numbers", async () => {
    const fetchImpl = vi.fn(async () => new Response("recipient 14155550123 invalid", { status: 400 }));
    const p = createWhatsAppProvider({ env: WA_ENV, fetchImpl: fetchImpl as never });
    expect(await p.send(req)).toEqual({ ok: false, error: "whatsapp_http_400" });
    expect((await p.send({ ...req, to: { userId: "u1" } })).error).toBe("no_phone");
    expect(normalizeWhatsAppNumber("12")).toBeNull();
  });
});
