import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  exportMyData,
  getMyConsents,
  listAuditLogs,
  listDeletionRequests,
  requestAccountDeletion,
  resolveDeletionRequest,
  withdrawConsent,
} from "@/lib/actions/compliance.actions";

const repo = vi.hoisted(() => ({
  findPendingDeletionRequest: vi.fn(),
  createDeletionRequest: vi.fn(),
  getDeletionRequest: vi.fn(),
  updateDeletionRequest: vi.fn(),
  listDeletionRequestDocuments: vi.fn(),
  listAuditLogDocuments: vi.fn(),
  listAppointmentsForUser: vi.fn(),
  anonymizeAppointment: vi.fn(),
  deletePatientDocument: vi.fn(),
  deleteStoredFile: vi.fn(),
  deleteAuthUser: vi.fn(),
  createConsentRecord: vi.fn(),
  listConsentRecords: vi.fn(),
}));
const patientRepo = vi.hoisted(() => ({
  getUser: vi.fn(),
  getPatientByUserId: vi.fn(),
}));
const auth = vi.hoisted(() => ({
  requireRole: vi.fn(),
  assertPatientOrStaffOwns: vi.fn(),
  getPatientSession: vi.fn(),
}));
const audit = vi.hoisted(() => ({ recordAudit: vi.fn() }));

vi.mock("@/lib/appwrite/compliance.repository", () => repo);
vi.mock("@/lib/appwrite/patient.repository", () => patientRepo);
vi.mock("@/lib/auth/admin", () => ({ requireRole: auth.requireRole }));
vi.mock("@/lib/auth/patient", () => ({
  assertPatientOrStaffOwns: auth.assertPatientOrStaffOwns,
  getPatientSession: auth.getPatientSession,
}));
vi.mock("@/lib/compliance/audit", () => audit);
vi.mock("next/headers", () => ({
  headers: () => {
    throw new Error("outside request");
  },
}));

const ADMIN = { userId: "admin1", email: null, name: null, role: "admin" };
const pending = {
  $id: "req1",
  userId: "user1",
  status: "pending",
  reason: null,
  createdAt: "2026-10-01T00:00:00.000Z",
};
const auditActions = () => audit.recordAudit.mock.calls.map((c) => c[0].action);

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  for (const fn of [
    ...Object.values(repo),
    ...Object.values(patientRepo),
    ...Object.values(auth),
    ...Object.values(audit),
  ]) {
    fn.mockReset();
  }
  audit.recordAudit.mockResolvedValue(undefined);
  auth.requireRole.mockResolvedValue(ADMIN);
  auth.assertPatientOrStaffOwns.mockResolvedValue({ actor: "patient" });
  auth.getPatientSession.mockResolvedValue({ userId: "user1" });
  repo.listAppointmentsForUser.mockResolvedValue([]);
  repo.listConsentRecords.mockResolvedValue([]);
  repo.updateDeletionRequest.mockImplementation(async (id, data) => ({
    ...pending,
    $id: id,
    ...data,
  }));
});

describe("admin-only actions", () => {
  it.each([
    ["listDeletionRequests", () => listDeletionRequests()],
    [
      "resolveDeletionRequest",
      () => resolveDeletionRequest({ id: "req1", decision: "approved" }),
    ],
    ["listAuditLogs", () => listAuditLogs({})],
  ])(
    "%s is denied (and audited) for non-admins without touching data",
    async (_n, call) => {
      auth.requireRole.mockRejectedValue(new Error("Unauthorized"));
      const result = await call();
      expect(result).toEqual({ ok: false, error: expect.any(String) });
      expect(audit.recordAudit).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: "denied", actorId: null }),
      );
      expect(repo.getDeletionRequest).not.toHaveBeenCalled();
      expect(repo.listAuditLogDocuments).not.toHaveBeenCalled();
      expect(repo.listDeletionRequestDocuments).not.toHaveBeenCalled();
      expect(patientRepo.getPatientByUserId).not.toHaveBeenCalled();
      expect(repo.deleteAuthUser).not.toHaveBeenCalled();
    },
  );

  it("requires the admin role specifically", async () => {
    repo.listDeletionRequestDocuments.mockResolvedValue({
      documents: [],
      total: 0,
    });
    await listDeletionRequests();
    expect(auth.requireRole).toHaveBeenCalledWith("admin");
  });
});

describe("requestAccountDeletion", () => {
  it("creates a pending request and does not delete anything", async () => {
    repo.findPendingDeletionRequest.mockResolvedValue(null);
    repo.createDeletionRequest.mockResolvedValue(pending);
    const result = await requestAccountDeletion({
      userId: "user1",
      reason: "leaving",
    });
    expect(result).toEqual({
      ok: true,
      data: { id: "req1", status: "pending", createdAt: pending.createdAt },
    });
    expect(repo.createDeletionRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user1",
        status: "pending",
        reason: "leaving",
      }),
    );
    expect(repo.deleteAuthUser).not.toHaveBeenCalled();
    expect(repo.deletePatientDocument).not.toHaveBeenCalled();
    expect(auditActions()).toContain("deletion.request");
  });

  it("is idempotent while a request is already pending", async () => {
    repo.findPendingDeletionRequest.mockResolvedValue(pending);
    const result = await requestAccountDeletion({ userId: "user1" });
    expect(result.ok).toBe(true);
    expect(repo.createDeletionRequest).not.toHaveBeenCalled();
  });

  it("denies callers who do not own the data", async () => {
    auth.assertPatientOrStaffOwns.mockRejectedValue(new Error("nope"));
    const result = await requestAccountDeletion({ userId: "someone-else" });
    expect(result.ok).toBe(false);
    expect(repo.createDeletionRequest).not.toHaveBeenCalled();
    expect(audit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "deletion.request",
        outcome: "denied",
      }),
    );
  });

  it("validates input and hides internal errors", async () => {
    expect((await requestAccountDeletion({ userId: "bad id!" })).ok).toBe(
      false,
    );
    repo.findPendingDeletionRequest.mockRejectedValue(
      new Error("secret internals"),
    );
    const result = await requestAccountDeletion({ userId: "user1" });
    expect(result).toEqual({
      ok: false,
      error: expect.not.stringContaining("secret"),
    });
  });
});

describe("resolveDeletionRequest", () => {
  it("approve: erases file, anonymizes appointments, deletes patient and user, then closes", async () => {
    repo.getDeletionRequest.mockResolvedValue(pending);
    patientRepo.getPatientByUserId.mockResolvedValue({
      $id: "pat1",
      identificationDocumentId: "file1",
    });
    repo.listAppointmentsForUser.mockResolvedValue([
      { $id: "a1" },
      { $id: "a2" },
    ]);

    const result = await resolveDeletionRequest({
      id: "req1",
      decision: "approved",
      note: "ok",
    });

    expect(result.ok).toBe(true);
    expect(repo.deleteStoredFile).toHaveBeenCalledWith("file1");
    expect(repo.anonymizeAppointment).toHaveBeenCalledTimes(2);
    expect(repo.deletePatientDocument).toHaveBeenCalledWith("pat1");
    expect(repo.deleteAuthUser).toHaveBeenCalledWith("user1");
    expect(repo.updateDeletionRequest).toHaveBeenCalledWith(
      "req1",
      expect.objectContaining({
        status: "approved",
        resolvedBy: "admin1",
        note: "ok",
      }),
    );
    expect(auditActions()).toEqual(
      expect.arrayContaining(["deletion.erase", "deletion.resolve"]),
    );
  });

  it("approve works when the patient never registered", async () => {
    repo.getDeletionRequest.mockResolvedValue(pending);
    patientRepo.getPatientByUserId.mockResolvedValue(null);
    const result = await resolveDeletionRequest({
      id: "req1",
      decision: "approved",
    });
    expect(result.ok).toBe(true);
    expect(repo.deletePatientDocument).not.toHaveBeenCalled();
    expect(repo.deleteAuthUser).toHaveBeenCalledWith("user1");
  });

  it("reject: deletes nothing", async () => {
    repo.getDeletionRequest.mockResolvedValue(pending);
    const result = await resolveDeletionRequest({
      id: "req1",
      decision: "rejected",
    });
    expect(result.ok).toBe(true);
    expect(repo.deleteAuthUser).not.toHaveBeenCalled();
    expect(repo.deletePatientDocument).not.toHaveBeenCalled();
    expect(patientRepo.getPatientByUserId).not.toHaveBeenCalled();
    expect(repo.updateDeletionRequest).toHaveBeenCalledWith(
      "req1",
      expect.objectContaining({ status: "rejected" }),
    );
  });

  it("is idempotent: an already-approved request is not erased again", async () => {
    repo.getDeletionRequest.mockResolvedValue({
      ...pending,
      status: "approved",
    });
    const result = await resolveDeletionRequest({
      id: "req1",
      decision: "approved",
    });
    expect(result.ok).toBe(true);
    expect(repo.deleteAuthUser).not.toHaveBeenCalled();
    expect(repo.updateDeletionRequest).not.toHaveBeenCalled();
  });

  it("refuses to flip a resolved request to the opposite decision", async () => {
    repo.getDeletionRequest.mockResolvedValue({
      ...pending,
      status: "rejected",
    });
    const result = await resolveDeletionRequest({
      id: "req1",
      decision: "approved",
    });
    expect(result.ok).toBe(false);
    expect(repo.deleteAuthUser).not.toHaveBeenCalled();
  });

  it("leaves the request pending (retryable) when erasure fails midway", async () => {
    repo.getDeletionRequest.mockResolvedValue(pending);
    patientRepo.getPatientByUserId.mockResolvedValue({ $id: "pat1" });
    repo.deleteAuthUser.mockRejectedValue(new Error("appwrite 500 secret"));
    const result = await resolveDeletionRequest({
      id: "req1",
      decision: "approved",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).not.toContain("secret");
    expect(repo.updateDeletionRequest).not.toHaveBeenCalled();
    expect(audit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "deletion.erase", outcome: "error" }),
    );
  });

  it("validates input and reports unknown requests", async () => {
    expect(
      (await resolveDeletionRequest({ id: "req1", decision: "maybe" as any }))
        .ok,
    ).toBe(false);
    repo.getDeletionRequest.mockResolvedValue(null);
    expect(
      await resolveDeletionRequest({ id: "nope", decision: "approved" }),
    ).toEqual({
      ok: false,
      error: "Request not found",
    });
  });
});

describe("listAuditLogs", () => {
  beforeEach(() => {
    repo.listAuditLogDocuments.mockResolvedValue({
      total: 1,
      documents: [
        {
          $id: "l1",
          createdAt: "2026-10-01T00:00:00.000Z",
          actorId: "u",
          actorRole: "admin",
          action: "x",
          resource: "r",
          outcome: "success",
          meta: '{"count":2}',
        },
      ],
    });
  });

  it("paginates, parses meta and audits the read", async () => {
    const result = await listAuditLogs({ page: 3, pageSize: 10, action: "x" });
    expect(repo.listAuditLogDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10, offset: 20, action: "x" }),
    );
    expect(result.ok && result.data.logs[0].meta).toEqual({ count: 2 });
    expect(auditActions()).toContain("audit.list");
  });

  it("rejects pageSize over 100 and bad dates", async () => {
    expect((await listAuditLogs({ pageSize: 101 })).ok).toBe(false);
    expect((await listAuditLogs({ from: "not a date" })).ok).toBe(false);
    expect(repo.listAuditLogDocuments).not.toHaveBeenCalled();
  });
});

describe("consent + export actions", () => {
  it("withdrawConsent appends a granted=false row and returns the derived state", async () => {
    repo.createConsentRecord.mockResolvedValue({ $id: "c" });
    repo.listConsentRecords.mockResolvedValue([
      {
        userId: "user1",
        purpose: "disclosure",
        granted: false,
        policyVersion: "v",
        createdAt: "2026-10-02T00:00:00.000Z",
      },
      {
        userId: "user1",
        purpose: "disclosure",
        granted: true,
        policyVersion: "v",
        createdAt: "2026-10-01T00:00:00.000Z",
      },
    ]);
    const result = await withdrawConsent({
      userId: "user1",
      purpose: "disclosure",
    });
    expect(repo.createConsentRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: "disclosure",
        granted: false,
        source: "withdrawal",
      }),
    );
    expect(
      result.ok && result.data.find((s) => s.purpose === "disclosure")!.granted,
    ).toBe(false);
    expect(
      (await withdrawConsent({ userId: "user1", purpose: "marketing" })).ok,
    ).toBe(false);
  });

  it("getMyConsents denies non-owners", async () => {
    auth.assertPatientOrStaffOwns.mockRejectedValue(new Error("nope"));
    expect((await getMyConsents("user2")).ok).toBe(false);
    expect(repo.listConsentRecords).not.toHaveBeenCalled();
  });

  it("exportMyData returns decrypted, JSON-serializable data and audits it", async () => {
    const { encryptField, resetCryptoStateForTests } = await import(
      "@/lib/compliance/crypto"
    );
    vi.stubEnv("FIELD_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    resetCryptoStateForTests();

    patientRepo.getUser.mockResolvedValue({
      $id: "user1",
      name: "Jane",
      email: "j@example.com",
      phone: "+911234567890",
      $createdAt: "2026-01-01",
    });
    patientRepo.getPatientByUserId.mockResolvedValue({
      $id: "pat1",
      $permissions: ["x"],
      $databaseId: "db",
      name: "Jane",
      allergies: encryptField("peanuts"),
      identificationNumber: "legacy-plain",
    });
    repo.listAppointmentsForUser.mockResolvedValue([
      { $id: "a1", status: "pending", $collectionId: "c" },
    ]);

    const result = await exportMyData("user1");
    vi.unstubAllEnvs();
    resetCryptoStateForTests();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.patient).toMatchObject({
      allergies: "peanuts",
      identificationNumber: "legacy-plain",
    });
    expect(result.data.patient).not.toHaveProperty("$permissions");
    expect(result.data.appointments[0]).toEqual({
      $id: "a1",
      status: "pending",
    });
    expect(() => JSON.stringify(result.data)).not.toThrow();
    expect(result.data.consents.current).toHaveLength(3);
    expect(audit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "data.export", resourceId: "user1" }),
    );
  });

  it("exportMyData fails safely for non-owners", async () => {
    auth.assertPatientOrStaffOwns.mockRejectedValue(new Error("nope"));
    expect((await exportMyData("user2")).ok).toBe(false);
    expect(patientRepo.getUser).not.toHaveBeenCalled();
  });
});
