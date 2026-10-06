import { beforeEach, describe, expect, it, vi } from "vitest";

import { purgeExpiredRecords, RETENTION } from "@/lib/compliance/retention";

const repo = vi.hoisted(() => ({
  listOlderThan: vi.fn(),
  deleteDocumentById: vi.fn(),
  deleteStoredFile: vi.fn(),
  clearPatientIdentificationDocument: vi.fn(),
}));
vi.mock("@/lib/appwrite/compliance.repository", () => repo);
vi.mock("@/lib/compliance/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/env", () => ({
  getEnv: () => ({ PATIENT_COLLECTION_ID: "patients" }),
}));

describe("purgeExpiredRecords", () => {
  beforeEach(() => {
    for (const fn of Object.values(repo)) fn.mockReset();
  });

  it("keeps ID document purge disabled by default", () => {
    expect(RETENTION.idDocumentDaysAfterVerification).toBeNull();
  });

  it("dry run only counts and deletes nothing", async () => {
    repo.listOlderThan.mockResolvedValue({
      total: 7,
      documents: [{ $id: "x" }],
    });
    const result = await purgeExpiredRecords({ dryRun: true });
    expect(result).toMatchObject({
      dryRun: true,
      auditLogs: 7,
      deletionRequests: 7,
      idDocuments: 0,
    });
    expect(repo.deleteDocumentById).not.toHaveBeenCalled();
  });

  it("real run deletes expired rows until none remain", async () => {
    repo.listOlderThan
      .mockResolvedValueOnce({
        total: 2,
        documents: [{ $id: "a" }, { $id: "b" }],
      })
      .mockResolvedValueOnce({ total: 0, documents: [] })
      .mockResolvedValueOnce({ total: 0, documents: [] });
    const result = await purgeExpiredRecords({ dryRun: false });
    expect(result.auditLogs).toBe(2);
    expect(repo.deleteDocumentById).toHaveBeenCalledWith("audit_logs", "a");
    expect(result.errors).toBe(0);
  });

  it("counts errors instead of throwing and stops on no progress", async () => {
    repo.listOlderThan.mockResolvedValue({
      total: 1,
      documents: [{ $id: "a" }],
    });
    repo.deleteDocumentById.mockRejectedValue(new Error("x"));
    const result = await purgeExpiredRecords({ dryRun: false });
    expect(result.errors).toBeGreaterThan(0);
    expect(result.auditLogs).toBe(0);
  });
});
