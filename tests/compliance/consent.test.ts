import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CONSENT_PURPOSES,
  CURRENT_POLICY_VERSION,
  deriveConsentState,
  getConsentState,
  hasActiveConsent,
  recordConsentChange,
  recordConsentGrants,
} from "@/lib/compliance/consent";

const createConsentRecord = vi.fn();
const listConsentRecords = vi.fn();

vi.mock("@/lib/appwrite/compliance.repository", () => ({
  createConsentRecord: (...a: unknown[]) => createConsentRecord(...a),
  listConsentRecords: (...a: unknown[]) => listConsentRecords(...a),
}));
vi.mock("next/headers", () => ({
  headers: () => {
    throw new Error("outside request");
  },
}));

const row = (
  purpose: string,
  granted: boolean,
  createdAt: string,
  policyVersion = "v1",
) => ({
  userId: "u1",
  purpose,
  granted,
  policyVersion,
  createdAt,
});

describe("recordConsentGrants", () => {
  beforeEach(() => {
    createConsentRecord.mockReset().mockResolvedValue({ $id: "c" });
    listConsentRecords.mockReset();
  });

  it("writes one row per purpose with version, ip and timestamp", async () => {
    await recordConsentGrants({
      userId: "u1",
      grants: { treatment: true, disclosure: false, privacy: true },
      ip: "203.0.113.1",
    });
    expect(createConsentRecord).toHaveBeenCalledTimes(3);
    const rows = createConsentRecord.mock.calls.map((c) => c[0]);
    expect(rows.map((r) => r.purpose).sort()).toEqual(
      [...CONSENT_PURPOSES].sort(),
    );
    expect(rows.find((r) => r.purpose === "disclosure").granted).toBe(false);
    for (const r of rows) {
      expect(r).toMatchObject({
        userId: "u1",
        policyVersion: CURRENT_POLICY_VERSION,
        ip: "203.0.113.1",
        source: "registration",
      });
      expect(Date.parse(r.createdAt)).not.toBeNaN();
    }
  });

  it("THROWS when persistence fails", async () => {
    createConsentRecord.mockRejectedValueOnce(new Error("db"));
    await expect(
      recordConsentGrants({
        userId: "u1",
        grants: { treatment: true, disclosure: true, privacy: true },
      }),
    ).rejects.toThrow();
  });

  it("throws on missing userId or unknown purpose", async () => {
    await expect(
      recordConsentGrants({
        userId: "",
        grants: { treatment: true, disclosure: true, privacy: true },
      }),
    ).rejects.toThrow();
    await expect(
      recordConsentChange({
        userId: "u1",
        purpose: "marketing" as any,
        granted: true,
      }),
    ).rejects.toThrow();
    expect(createConsentRecord).not.toHaveBeenCalled();
  });
});

describe("deriveConsentState (append-only history, latest wins)", () => {
  it("reports every purpose, not granted when no rows exist", () => {
    const state = deriveConsentState([]);
    expect(state.map((s) => s.purpose)).toEqual([...CONSENT_PURPOSES]);
    expect(state.every((s) => !s.granted && s.updatedAt === null)).toBe(true);
  });

  it("latest row per purpose wins regardless of input order", () => {
    const rows = [
      row("treatment", true, "2026-01-01T00:00:00.000Z"),
      row("treatment", false, "2026-02-01T00:00:00.000Z"),
      row("privacy", false, "2026-01-01T00:00:00.000Z"),
      row("privacy", true, "2026-03-01T00:00:00.000Z", "v2"),
    ];
    for (const input of [rows, [...rows].reverse()]) {
      const state = deriveConsentState(input);
      const by = Object.fromEntries(state.map((s) => [s.purpose, s]));
      expect(by.treatment.granted).toBe(false);
      expect(by.treatment.updatedAt).toBe("2026-02-01T00:00:00.000Z");
      expect(by.privacy.granted).toBe(true);
      expect(by.privacy.policyVersion).toBe("v2");
      expect(by.disclosure.granted).toBe(false);
    }
  });

  it("re-grant after withdrawal makes the purpose granted again", () => {
    const state = deriveConsentState([
      row("disclosure", true, "2026-01-01T00:00:00.000Z"),
      row("disclosure", false, "2026-02-01T00:00:00.000Z"),
      row("disclosure", true, "2026-03-01T00:00:00.000Z"),
    ]);
    expect(state.find((s) => s.purpose === "disclosure")!.granted).toBe(true);
  });

  it("ties resolve to the first (newest-first) row", () => {
    const t = "2026-01-01T00:00:00.000Z";
    const state = deriveConsentState([
      row("treatment", false, t),
      row("treatment", true, t),
    ]);
    expect(state.find((s) => s.purpose === "treatment")!.granted).toBe(false);
  });
});

describe("getConsentState / hasActiveConsent", () => {
  it("maps repository documents and answers active-consent checks", async () => {
    listConsentRecords.mockResolvedValue([
      {
        userId: "u1",
        purpose: "treatment",
        granted: false,
        policyVersion: "v1",
        createdAt: "2026-02-01T00:00:00.000Z",
      },
      {
        userId: "u1",
        purpose: "treatment",
        granted: true,
        policyVersion: "v1",
        $createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        userId: "u1",
        purpose: "privacy",
        granted: true,
        policyVersion: "v1",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    const state = await getConsentState("u1");
    expect(state.find((s) => s.purpose === "treatment")!.granted).toBe(false);
    expect(await hasActiveConsent("u1", "privacy")).toBe(true);
    expect(await hasActiveConsent("u1", "treatment")).toBe(false);
  });
});
