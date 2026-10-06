import { afterEach, describe, expect, it, vi } from "vitest";

import { getDepositCheckout, getPaymentConfig } from "@/lib/actions/payment.actions";
import * as appointmentRepo from "@/lib/appwrite/appointment.repository";

vi.mock("@/lib/appwrite/appointment.repository", () => ({ getAppointmentDocument: vi.fn() }));
vi.mock("@/lib/compliance/audit", () => ({ recordAudit: vi.fn(async () => undefined) }));
vi.mock("@/lib/auth/admin", () => ({ AdminAuthError: class extends Error {} }));
vi.mock("@/lib/auth/patient", () => ({
  PatientAuthError: class extends Error {},
  assertPatientOrStaffOwns: vi.fn(async () => ({ actor: "patient" })),
}));

afterEach(() => vi.unstubAllEnvs());

describe("payment actions", () => {
  it("deposit config is off by default and exposes no secrets", async () => {
    vi.stubEnv("PAYMENTS_PROVIDER", "");
    vi.stubEnv("DEPOSIT_AMOUNT_MINOR", "");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_never");
    const result = await getPaymentConfig();
    expect(result).toEqual({ ok: true, data: { depositRequired: false, currency: "USD", amountMinor: 0 } });
    expect(JSON.stringify(result)).not.toContain("sk_live");
  });

  it("getDepositCheckout returns required:false without touching the DB when off", async () => {
    vi.stubEnv("PAYMENTS_PROVIDER", "none");
    expect(await getDepositCheckout("appt1", "u1")).toEqual({ ok: true, data: { required: false } });
    expect(appointmentRepo.getAppointmentDocument).not.toHaveBeenCalled();
  });

  it("validates ids and hides other users' appointments", async () => {
    expect((await getDepositCheckout("bad id!", "u1")).ok).toBe(false);
    vi.stubEnv("PAYMENTS_PROVIDER", "mock");
    vi.stubEnv("DEPOSIT_AMOUNT_MINOR", "2500");
    vi.mocked(appointmentRepo.getAppointmentDocument).mockResolvedValueOnce({ $id: "appt1", userId: "someone-else" } as never);
    expect(await getDepositCheckout("appt1", "u1")).toEqual({ ok: false, error: "Appointment not found" });
  });
});
