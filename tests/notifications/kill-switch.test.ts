import { describe, expect, it, vi } from "vitest";

import { sendNotification } from "@/lib/notifications/notifier";

const request = {
  to: { userId: "user1", phone: "+12025550100" },
  template: "appointment_confirmed",
  data: {},
} as never;

describe("NOTIFICATIONS_DISABLED kill switch", () => {
  it("sends nothing on any channel when set to true", async () => {
    const send = vi.fn().mockResolvedValue({ ok: true });
    const result = await sendNotification(request, {
      env: { NOTIFICATIONS_DISABLED: "true", NOTIFY_CHANNELS: "sms" },
      providers: { sms: { send } } as never,
    });
    expect(send).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, delivered: [], attempts: [] });
  });

  it("still sends when the flag is absent or not exactly true", async () => {
    for (const flag of [undefined, "false", "1"]) {
      const send = vi.fn().mockResolvedValue({ ok: true });
      const result = await sendNotification(request, {
        env: { NOTIFY_CHANNELS: "sms", NOTIFICATIONS_DISABLED: flag },
        providers: { sms: { send } } as never,
      });
      expect(send).toHaveBeenCalledTimes(1);
      expect(result.ok).toBe(true);
    }
  });
});
