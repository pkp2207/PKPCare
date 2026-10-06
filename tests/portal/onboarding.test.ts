import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requestPatientOtp: vi.fn(),
  createUser: vi.fn(),
  listUsers: vi.fn(),
  enforced: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: () => ({ get: () => "1.2.3.4" }),
}));
vi.mock("@/lib/actions/auth.actions", () => ({ requestPatientOtp: mocks.requestPatientOtp }));
vi.mock("@/lib/appwrite/patient.repository", () => ({
  createUser: mocks.createUser,
  getUser: vi.fn(),
  getPatientByUserId: vi.fn(),
}));
vi.mock("@/lib/appwrite/client", () => ({
  getClients: () => ({ users: { list: mocks.listUsers } }),
  toUserMessage: (_e: unknown, fallback: string) => fallback,
}));
vi.mock("@/lib/auth/config", () => ({ isPatientAuthEnforced: mocks.enforced }));
vi.mock("@/lib/auth/admin", () => ({ AdminAuthError: class extends Error {} }));
vi.mock("@/lib/auth/patient", () => ({
  PatientAuthError: class extends Error {},
  assertPatientOrStaffOwns: vi.fn(),
}));
vi.mock("@/lib/compliance/consent", () => ({ recordConsentGrants: vi.fn() }));
vi.mock("@/lib/scheduling/audit", () => ({ auditSafe: vi.fn() }));
vi.mock("@/lib/scheduling/doctors", () => ({ resolveDoctorByName: vi.fn() }));

import { startPatientRegistration } from "@/lib/actions/onboarding.actions";
import { createUser } from "@/lib/actions/patient.actions";

const input = { name: "Jane Doe", email: "Jane@Example.com", phone: "+15551234567" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.requestPatientOtp.mockResolvedValue({ ok: true });
  mocks.createUser.mockResolvedValue({ $id: "secret-id", $createdAt: new Date().toISOString() });
  mocks.enforced.mockReturnValue(true);
});

describe("startPatientRegistration", () => {
  it("creates the user, sends the code and returns no id", async () => {
    const result = await startPatientRegistration(input);
    expect(result).toEqual({ ok: true, data: null });
    expect(mocks.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: "jane@example.com" })
    );
    expect(mocks.requestPatientOtp).toHaveBeenCalledWith("jane@example.com");
    expect(JSON.stringify(result)).not.toContain("secret-id");
  });

  it("answers identically when the user already exists or creation fails", async () => {
    const fresh = await startPatientRegistration(input);
    mocks.createUser.mockResolvedValue({ $id: "existing-id", $createdAt: "2020-01-01T00:00:00.000Z" });
    const existing = await startPatientRegistration(input);
    mocks.createUser.mockRejectedValue(new Error("appwrite down"));
    const failing = await startPatientRegistration(input);
    expect(existing).toEqual(fresh);
    expect(failing).toEqual(fresh);
  });

  it("rejects malformed input without touching Appwrite", async () => {
    const result = await startPatientRegistration({ ...input, email: "nope" });
    expect(result.ok).toBe(false);
    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(mocks.requestPatientOtp).not.toHaveBeenCalled();
  });

  it("surfaces the OTP rate limit", async () => {
    mocks.requestPatientOtp.mockResolvedValue({ ok: false, error: "Too many attempts. Please try again later." });
    expect(await startPatientRegistration(input)).toEqual({
      ok: false,
      error: "Too many attempts. Please try again later.",
    });
  });
});

describe("createUser (IDOR guard)", () => {
  it("refuses a duplicate email when patient auth is enforced", async () => {
    mocks.listUsers.mockResolvedValue({ users: [{ $id: "victim" }] });
    const result = await createUser(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/sign in/i);
    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  it("refuses when a race returned a pre-existing user", async () => {
    mocks.listUsers.mockResolvedValue({ users: [] });
    mocks.createUser.mockResolvedValue({ $id: "victim", $createdAt: "2020-01-01T00:00:00.000Z" });
    const result = await createUser(input);
    expect(result.ok).toBe(false);
  });

  it("creates a brand-new user when enforced", async () => {
    mocks.listUsers.mockResolvedValue({ users: [] });
    const result = await createUser(input);
    expect(result.ok).toBe(true);
  });

  it("keeps today's behaviour (returns the existing user) when not enforced", async () => {
    mocks.enforced.mockReturnValue(false);
    mocks.createUser.mockResolvedValue({ $id: "existing", $createdAt: "2020-01-01T00:00:00.000Z" });
    const result = await createUser(input);
    expect(result).toEqual({ ok: true, data: expect.objectContaining({ $id: "existing" }) });
    expect(mocks.listUsers).not.toHaveBeenCalled();
  });
});
