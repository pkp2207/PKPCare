import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "@/app/api/cron/reminders/route";

const run = vi.hoisted(() => vi.fn());
const expire = vi.hoisted(() => vi.fn());
vi.mock("@/lib/notifications/reminders", () => ({ runReminders: run }));
vi.mock("@/lib/scheduling/offers", () => ({ expireStaleWaitlistOffers: expire }));
vi.mock("@/lib/compliance/audit", () => ({ recordAudit: vi.fn() }));

const req = (headers: Record<string, string> = {}, query = "", method = "GET") =>
  new Request(`http://localhost/api/cron/reminders${query}`, { method, headers });

const summary = {
  dryRun: false,
  windows: {
    reminder_24h: { found: 1, due: 1, sent: 1, failed: 0 },
    reminder_1h: { found: 0, due: 0, sent: 0, failed: 0 },
  },
  skippedNoSchema: 0,
};

describe("reminders cron route", () => {
  beforeEach(() => {
    run.mockReset().mockResolvedValue(summary);
    expire.mockReset().mockResolvedValue({ dryRun: false, found: 0, expired: 0, reoffered: 0, errors: 0 });
    vi.stubEnv("CRON_SECRET", "s3cret-value");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("401 without or with a wrong bearer secret", async () => {
    for (const authorization of [undefined, "Bearer wrong", "Basic s3cret-value", "s3cret-value", "Bearer "]) {
      const res = await GET(req(authorization ? { authorization } : {}));
      expect(res.status).toBe(401);
    }
    expect(run).not.toHaveBeenCalled();
    expect(expire).not.toHaveBeenCalled();
  });

  it("fails closed when CRON_SECRET is unset", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(req({ authorization: "Bearer " }))).status).toBe(401);
    expect((await GET(req({ authorization: "Bearer undefined" }))).status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it("runs on GET and POST and returns counts", async () => {
    const headers = { authorization: "Bearer s3cret-value" };
    for (const res of [await GET(req(headers)), await POST(req(headers, "", "POST"))]) {
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, reminders: summary, waitlistOffers: { expired: 0 } });
    }
    expect(run).toHaveBeenCalledWith({ dryRun: false });
  });

  it("passes dryRun=1 through to both jobs", async () => {
    await GET(req({ authorization: "Bearer s3cret-value" }, "?dryRun=1"));
    expect(run).toHaveBeenCalledWith({ dryRun: true });
    expect(expire).toHaveBeenCalledWith({ dryRun: true });
  });

  it("returns a generic 500 when a job throws", async () => {
    run.mockRejectedValueOnce(new Error("secret detail"));
    const res = await GET(req({ authorization: "Bearer s3cret-value" }));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret detail");
  });
});
