import { beforeEach, describe, expect, it, vi } from "vitest";

import { recordAudit, sanitizeAuditMeta } from "@/lib/compliance/audit";

const createAuditLog = vi.fn();
const headersMock = vi.fn();

vi.mock("@/lib/appwrite/compliance.repository", () => ({
  createAuditLog: (...args: unknown[]) => createAuditLog(...args),
}));
vi.mock("next/headers", () => ({ headers: () => headersMock() }));

describe("recordAudit", () => {
  beforeEach(() => {
    createAuditLog.mockReset().mockResolvedValue({ $id: "1" });
    headersMock.mockReset().mockImplementation(() => {
      throw new Error("called outside a request scope");
    });
    vi.restoreAllMocks();
  });

  it("writes a row with timestamp and null request context outside a request", async () => {
    await recordAudit({
      actorId: "u1",
      actorRole: "admin",
      action: "audit.list",
      resource: "audit_log",
    });
    const row = createAuditLog.mock.calls[0][0];
    expect(row).toMatchObject({
      actorId: "u1",
      actorRole: "admin",
      action: "audit.list",
      resource: "audit_log",
      outcome: "success",
      requestId: null,
      ip: null,
      meta: null,
    });
    expect(Date.parse(row.createdAt)).not.toBeNaN();
  });

  it("adds requestId and the first forwarded ip when available", async () => {
    const h = new Headers({
      "x-request-id": "req-123",
      "x-forwarded-for": "203.0.113.9, 10.0.0.1",
    });
    headersMock.mockImplementation(() => h);
    await recordAudit({
      actorId: null,
      actorRole: "system",
      action: "a",
      resource: "r",
    });
    expect(createAuditLog.mock.calls[0][0]).toMatchObject({
      requestId: "req-123",
      ip: "203.0.113.9",
    });
  });

  it("never throws when the write fails and logs one safe line", async () => {
    createAuditLog.mockRejectedValue(
      Object.assign(new Error("db down for jane@example.com"), { code: 500 }),
    );
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      recordAudit({
        actorId: "u",
        actorRole: "patient",
        action: "data.export",
        resource: "user_data",
      }),
    ).resolves.toBeUndefined();
    expect(err).toHaveBeenCalledTimes(1);
    const line = String(err.mock.calls[0][0]);
    expect(line).toContain("data.export");
    expect(line).not.toContain("jane@example.com");
    expect(line).not.toContain("\n");
  });

  it("never throws on hostile input or when the console itself fails", async () => {
    createAuditLog.mockRejectedValue(new Error("x"));
    vi.spyOn(console, "error").mockImplementation(() => {
      throw new Error("console broken");
    });
    await expect(recordAudit(null as any)).resolves.toBeUndefined();
    await expect(
      recordAudit({
        actorId: "u",
        actorRole: "r",
        action: "a",
        resource: "r",
        meta: { count: Symbol("x") as any },
      }),
    ).resolves.toBeUndefined();
  });

  it("bounds field sizes", async () => {
    await recordAudit({
      actorId: "u".repeat(500),
      actorRole: "r".repeat(500),
      action: "a".repeat(500),
      resource: "x".repeat(500),
      resourceId: "y".repeat(500),
    });
    const row = createAuditLog.mock.calls[0][0];
    expect(row.actorId.length).toBe(64);
    expect(row.actorRole.length).toBe(32);
    expect(row.action.length).toBe(64);
    expect(row.resource.length).toBe(64);
    expect(row.resourceId.length).toBe(64);
  });

  it("stores only sanitized meta", async () => {
    await recordAudit({
      actorId: "u",
      actorRole: "admin",
      action: "a",
      resource: "r",
      meta: { count: 3, email: "a@b.com", name: "Jane", decision: "approved" },
    });
    const meta = JSON.parse(createAuditLog.mock.calls[0][0].meta);
    expect(meta).toEqual({ count: 3, decision: "approved", _dropped: 2 });
  });
});

describe("sanitizeAuditMeta", () => {
  it("returns null for empty/undefined meta", () => {
    expect(sanitizeAuditMeta(undefined)).toBeNull();
    expect(sanitizeAuditMeta({})).toBeNull();
  });

  it("drops sensitive and unknown keys (allow-list)", () => {
    const out = sanitizeAuditMeta({
      name: "Jane",
      email: "a@b.com",
      phone: "9876543210",
      note: "free text",
      reason: "free text",
      token: "abc",
      password: "x",
      address: "1 Main St",
      count: 2,
    });
    expect(out).toEqual({ count: 2, _dropped: 8 });
  });

  it("masks identifiers inside allowed string values and bounds length", () => {
    const out = sanitizeAuditMeta({
      status: "contact a@b.com 9876543210",
      purpose: "p".repeat(500),
    })!;
    expect(out.status).toBe("contact [email] [number]");
    expect((out.purpose as string).length).toBe(64);
  });

  it("rejects objects, functions and non-finite numbers; limits arrays", () => {
    const out = sanitizeAuditMeta({
      status: { nested: true },
      count: Number.NaN,
      files: Array.from({ length: 50 }, (_, i) => `f${i}`),
    })!;
    expect(out.status).toBeUndefined();
    expect(out.count).toBeUndefined();
    expect((out.files as unknown[]).length).toBe(10);
  });

  it("collapses oversized meta", () => {
    const out = sanitizeAuditMeta({
      files: Array.from({ length: 10 }, () => "x".repeat(64)),
      purpose: "y".repeat(64),
      status: "z".repeat(64),
      decision: "d".repeat(64),
      policyVersion: "v".repeat(64),
      errorCode: "e".repeat(64),
      errorName: "n".repeat(64),
      step: "s".repeat(64),
      actor: "a".repeat(64),
      filterAction: "f".repeat(64),
    });
    expect(out).toEqual({ _truncated: true });
  });
});
