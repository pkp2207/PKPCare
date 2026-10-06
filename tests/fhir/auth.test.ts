import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getStaffSession } from "@/lib/auth/admin";
import {
  authenticateFhirRequest,
  consumeRateLimit,
  isFhirEnabled,
  matchToken,
  parseFhirTokens,
  resetFhirRateLimiter,
} from "@/lib/fhir/auth";

vi.mock("@/lib/auth/admin", () => ({ getStaffSession: vi.fn() }));

const T1 = "a".repeat(40);
const T2 = "b".repeat(40);

const req = (authorization?: string) =>
  new Request("https://x.test/api/fhir/metadata", {
    headers: authorization ? { authorization } : {},
  });

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.mocked(getStaffSession).mockResolvedValue(null);
  resetFhirRateLimiter();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("parseFhirTokens", () => {
  it("parses name:scopes:token entries, scopes separated by + | or space", () => {
    const entries = parseFhirTokens(
      `alpha:read:patient+read:appointment:${T1},beta:read:slot|read:consent:${T2}`,
    );
    expect(entries.map((e) => e.name)).toEqual(["alpha", "beta"]);
    expect(Array.from(entries[0].scopes)).toEqual(["read:patient", "read:appointment"]);
    expect(Array.from(entries[1].scopes)).toEqual(["read:slot", "read:consent"]);
  });

  it("drops malformed entries: short token, no valid scope, bad name", () => {
    expect(parseFhirTokens(`a:read:patient:short`)).toEqual([]);
    expect(parseFhirTokens(`a:read:nothing:${T1}`)).toEqual([]);
    expect(parseFhirTokens(`bad name:read:patient:${T1}`)).toEqual([]);
    expect(parseFhirTokens(`${T1}`)).toEqual([]);
    expect(parseFhirTokens(undefined)).toEqual([]);
  });

  it("does not store the token itself", () => {
    const [entry] = parseFhirTokens(`a:read:patient:${T1}`);
    expect(JSON.stringify(entry)).not.toContain(T1);
  });
});

describe("matchToken", () => {
  const entries = parseFhirTokens(`a:read:patient:${T1},b:read:slot:${T2}`);

  it("matches the right entry", () => {
    expect(matchToken(T2, entries)?.name).toBe("b");
    expect(matchToken(T1, entries)?.name).toBe("a");
  });

  it("rejects unknown, prefix and different-length tokens", () => {
    expect(matchToken("c".repeat(40), entries)).toBeNull();
    expect(matchToken(T1.slice(0, 39), entries)).toBeNull();
    expect(matchToken(`${T1}x`, entries)).toBeNull();
    expect(matchToken("", entries)).toBeNull();
  });
});

describe("authenticateFhirRequest", () => {
  beforeEach(() => {
    vi.stubEnv("FHIR_API_TOKENS", `alpha:read:patient+read:sensitive:${T1}`);
  });

  it("accepts a valid bearer token with its scopes", async () => {
    const result = await authenticateFhirRequest(req(`Bearer ${T1}`));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.principal.name).toBe("alpha");
      expect(result.principal.scopes.has("read:patient")).toBe(true);
      expect(result.principal.scopes.has("read:appointment")).toBe(false);
    }
  });

  it("rejects an invalid token and never falls back to the session", async () => {
    vi.mocked(getStaffSession).mockResolvedValue({
      userId: "u",
      email: null,
      name: null,
      role: "admin",
    });
    expect(await authenticateFhirRequest(req(`Bearer ${T2}`))).toEqual({
      ok: false,
      attempted: true,
    });
    expect(await authenticateFhirRequest(req("Basic abc"))).toEqual({
      ok: false,
      attempted: true,
    });
  });

  it("no credentials: unauthenticated and not an attempt", async () => {
    expect(await authenticateFhirRequest(req())).toEqual({ ok: false, attempted: false });
  });

  it("admin staff session gets non-sensitive scopes only", async () => {
    vi.mocked(getStaffSession).mockResolvedValue({
      userId: "u1",
      email: null,
      name: null,
      role: "admin",
    });
    const result = await authenticateFhirRequest(req());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.principal.kind).toBe("session");
      expect(result.principal.scopes.has("read:patient")).toBe(true);
      expect(result.principal.scopes.has("read:sensitive")).toBe(false);
    }
  });

  it("non-admin staff is rejected", async () => {
    vi.mocked(getStaffSession).mockResolvedValue({
      userId: "u1",
      email: null,
      name: null,
      role: "frontdesk",
    });
    expect((await authenticateFhirRequest(req())).ok).toBe(false);
  });
});

describe("feature flag and rate limit", () => {
  it("is disabled unless FHIR_API_ENABLED is exactly true", () => {
    expect(isFhirEnabled()).toBe(false);
    vi.stubEnv("FHIR_API_ENABLED", "1");
    expect(isFhirEnabled()).toBe(false);
    vi.stubEnv("FHIR_API_ENABLED", "true");
    expect(isFhirEnabled()).toBe(true);
  });

  it("limits per principal", () => {
    vi.stubEnv("FHIR_RATE_LIMIT_PER_MINUTE", "3");
    expect([1, 2, 3, 4].map(() => consumeRateLimit("a"))).toEqual([true, true, true, false]);
    expect(consumeRateLimit("b")).toBe(true);
  });
});
