import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "@/app/api/cron/retention/route";

const purge = vi.hoisted(() => vi.fn());
vi.mock("@/lib/compliance/retention", () => ({ purgeExpiredRecords: purge }));
vi.mock("@/lib/compliance/audit", () => ({ recordAudit: vi.fn() }));

const req = (
  headers: Record<string, string> = {},
  query = "",
  method = "GET",
) =>
  new Request(`http://localhost/api/cron/retention${query}`, {
    method,
    headers,
  });

describe("retention cron route", () => {
  beforeEach(() => {
    purge.mockReset().mockResolvedValue({
      dryRun: false,
      auditLogs: 1,
      idDocuments: 0,
      deletionRequests: 2,
      errors: 0,
    });
    vi.stubEnv("CRON_SECRET", "s3cret-value");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("401 without an Authorization header", async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(purge).not.toHaveBeenCalled();
  });

  it("401 for a wrong secret, wrong scheme, or different length", async () => {
    for (const authorization of [
      "Bearer wrong",
      "Basic s3cret-value",
      "s3cret-value",
      "Bearer s3cret-value-extra",
      "Bearer ",
    ]) {
      expect((await GET(req({ authorization }))).status).toBe(401);
    }
    expect(purge).not.toHaveBeenCalled();
  });

  it("fails closed (401) when CRON_SECRET is not configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(req({ authorization: "Bearer " }))).status).toBe(401);
    expect((await GET(req({ authorization: "Bearer undefined" }))).status).toBe(
      401,
    );
    expect(purge).not.toHaveBeenCalled();
  });

  it("runs a real purge with a valid secret", async () => {
    const res = await GET(req({ authorization: "Bearer s3cret-value" }));
    expect(res.status).toBe(200);
    expect(purge).toHaveBeenCalledWith({ dryRun: false });
    expect(await res.json()).toMatchObject({
      ok: true,
      auditLogs: 1,
      deletionRequests: 2,
    });
  });

  it("supports ?dryRun=1 and POST", async () => {
    await POST(
      req({ authorization: "Bearer s3cret-value" }, "?dryRun=1", "POST"),
    );
    expect(purge).toHaveBeenCalledWith({ dryRun: true });
  });

  it("returns a generic 500 when the purge throws", async () => {
    purge.mockRejectedValue(new Error("appwrite exploded with details"));
    const res = await GET(req({ authorization: "Bearer s3cret-value" }));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("details");
  });
});
