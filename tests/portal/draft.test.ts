import { describe, expect, it } from "vitest";

import {
  clearAllDrafts,
  clearDraft,
  DRAFT_KEY_PREFIX,
  DRAFT_NEVER_STORED,
  DRAFT_SAFE_FIELDS,
  DRAFT_TTL_MS,
  draftKey,
  loadDraft,
  parseDraft,
  sanitizeDraft,
  saveDraft,
  serializeDraft,
} from "@/components/portal/draft";

const memoryStorage = () => {
  const map = new Map<string, string>();
  return {
    map,
    get length() {
      return map.size;
    },
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
};

const everything: Record<string, unknown> = {
  name: "Jane Doe",
  email: "jane@example.com",
  phone: "+15551234567",
  gender: "Female",
  address: "12 Main Street",
  occupation: "Engineer",
  emergencyContactName: "John Doe",
  emergencyContactNumber: "+15557654321",
  primaryPhysician: "John Green",
  insuranceProvider: "Acme",
  identificationType: "Passport",
  // Must never be persisted:
  birthDate: new Date("1990-05-20"),
  allergies: "penicillin",
  currentMedication: "insulin",
  familyMedicalHistory: "x",
  pastMedicalHistory: "y",
  insurancePolicyNumber: "POLICY-1",
  identificationNumber: "PASS-9",
  identificationDocument: [{ name: "id.png" }],
  treatmentConsent: true,
  disclosureConsent: true,
  privacyConsent: true,
};

describe("sanitizeDraft", () => {
  it("keeps only allow-listed fields", () => {
    const out = sanitizeDraft(everything);
    expect(Object.keys(out).sort()).toEqual([...DRAFT_SAFE_FIELDS].sort());
  });

  it("never lets sensitive fields through", () => {
    const out = sanitizeDraft(everything) as Record<string, unknown>;
    for (const field of DRAFT_NEVER_STORED) expect(field in out).toBe(false);
  });

  it("drops non-strings and empty strings, and bounds length", () => {
    const out = sanitizeDraft({ name: 42, email: "", address: "a".repeat(5000) });
    expect(out.name).toBeUndefined();
    expect(out.email).toBeUndefined();
    expect(out.address).toHaveLength(500);
  });

  it("tolerates null", () => {
    expect(sanitizeDraft(null)).toEqual({});
  });
});

describe("serialize / parse", () => {
  const now = 1_000_000;

  it("round-trips and never contains sensitive text", () => {
    const raw = serializeDraft("u1", everything, 2, now);
    for (const secret of ["penicillin", "insulin", "POLICY-1", "PASS-9", "1990"]) {
      expect(raw).not.toContain(secret);
    }
    const draft = parseDraft(raw, "u1", now + 1000);
    expect(draft?.step).toBe(2);
    expect(draft?.values.name).toBe("Jane Doe");
  });

  it("rejects another user's, expired, future-dated and tampered drafts", () => {
    const raw = serializeDraft("u1", everything, 0, now);
    expect(parseDraft(raw, "u2", now)).toBeNull();
    expect(parseDraft(raw, "u1", now + DRAFT_TTL_MS + 1)).toBeNull();
    expect(parseDraft(raw, "u1", now - 10 * 60_000)).toBeNull();
    expect(parseDraft("{not json", "u1", now)).toBeNull();
    expect(parseDraft(null, "u1", now)).toBeNull();
    expect(parseDraft(JSON.stringify({ v: 99 }), "u1", now)).toBeNull();
  });

  it("re-sanitises on read so injected fields are ignored", () => {
    const tampered = JSON.stringify({
      v: 1,
      userId: "u1",
      savedAt: now,
      step: 1,
      values: { name: "Jane", allergies: "injected" },
    });
    expect(parseDraft(tampered, "u1", now)?.values).toEqual({ name: "Jane" });
  });
});

describe("storage helpers", () => {
  it("saves, loads and clears via the storage given", () => {
    const store = memoryStorage();
    saveDraft(store, "u1", everything, 1, 5000);
    expect(store.getItem(draftKey("u1"))).toBeTruthy();
    expect(loadDraft(store, "u1", 6000)?.values.email).toBe("jane@example.com");
    clearDraft(store, "u1");
    expect(loadDraft(store, "u1", 6000)).toBeNull();
  });

  it("removes an expired draft when loading it", () => {
    const store = memoryStorage();
    saveDraft(store, "u1", everything, 0, 0);
    expect(loadDraft(store, "u1", DRAFT_TTL_MS + 10)).toBeNull();
    expect(store.getItem(draftKey("u1"))).toBeNull();
  });

  it("clearAllDrafts removes only draft keys", () => {
    const store = memoryStorage();
    saveDraft(store, "u1", everything, 0);
    saveDraft(store, "u2", everything, 0);
    store.setItem("other", "keep");
    clearAllDrafts(store);
    expect(Array.from(store.map.keys())).toEqual(["other"]);
    expect(DRAFT_KEY_PREFIX).toContain("register-draft");
  });

  it("is silent when storage is unavailable or throws", () => {
    expect(() => saveDraft(null, "u1", everything, 0)).not.toThrow();
    expect(loadDraft(null, "u1")).toBeNull();
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    expect(() => saveDraft(broken, "u1", everything, 0)).not.toThrow();
    expect(loadDraft(broken, "u1")).toBeNull();
  });
});
