import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/webhooks/payments/route";
import { getOrCreateDepositCheckout } from "@/lib/payments/deposit";
import { createMockProvider } from "@/lib/payments/mock";
import { isDepositRefundEligible, refundDeposit } from "@/lib/payments/refund";

type P = Record<string, any>;
const store = vi.hoisted(() => ({
  payments: new Map<string, Record<string, any>>(),
  appointmentStatus: [] as string[],
}));
const notify = vi.hoisted(() => vi.fn(async () => ({ ok: true })));

vi.mock("@/lib/payments/store", () => ({
  paymentDocId: (a: string, n: number) => `pay-${a}-${n}`,
  createPayment: vi.fn(async (id: string, data: P) => {
    if (store.payments.has(id)) throw Object.assign(new Error("dup"), { code: 409 });
    store.payments.set(id, { ...data, $id: id });
    return store.payments.get(id);
  }),
  getPayment: vi.fn(async (id: string) => store.payments.get(id)),
  updatePayment: vi.fn(async (id: string, patch: P) => Object.assign(store.payments.get(id) as P, patch)),
  listPaymentsForAppointment: vi.fn(async (a: string) =>
    Array.from(store.payments.values()).filter((p) => p.appointmentId === a).reverse()
  ),
  findPaymentBySession: vi.fn(
    async (s: string) => Array.from(store.payments.values()).find((p) => p.providerSessionId === s) ?? null
  ),
  setAppointmentDepositStatus: vi.fn(async (_id: string, s: string) => {
    store.appointmentStatus.push(s);
    return true;
  }),
}));
vi.mock("@/lib/notifications/events", () => ({ notifyAppointment: notify }));
vi.mock("@/lib/notifications/store", () => ({
  getNotificationAppointment: vi.fn(async () => ({ $id: "appt1", userId: "u1", depositStatus: "pending" })),
}));
vi.mock("@/lib/compliance/audit", () => ({ recordAudit: vi.fn(async () => undefined) }));

const SECRET = "mock-webhook-secret";
const env = { PAYMENTS_PROVIDER: "mock", DEPOSIT_AMOUNT_MINOR: "2500", DEPOSIT_CURRENCY: "USD", PAYMENTS_MOCK_SECRET: SECRET };

const hook = (payload: P, signature?: string) => {
  const raw = JSON.stringify(payload);
  const sig = signature ?? createHmac("sha256", SECRET).update(raw).digest("hex");
  return new Request("http://localhost/api/webhooks/payments", {
    method: "POST",
    body: raw,
    headers: { "x-mock-signature": sig },
  });
};

const paid = (id = "evt_1", over: P = {}) => ({
  id,
  type: "payment_succeeded",
  providerSessionId: "sess_1",
  providerPaymentId: "pi_1",
  amountMinor: 2500,
  currency: "USD",
  ...over,
});

const seed = (over: P = {}) =>
  store.payments.set("pay-appt1-0", {
    $id: "pay-appt1-0",
    appointmentId: "appt1",
    userId: "u1",
    provider: "mock",
    providerSessionId: "sess_1",
    amountMinor: 2500,
    currency: "USD",
    status: "pending",
    eventIds: [],
    ...over,
  });

beforeEach(() => {
  store.payments.clear();
  store.appointmentStatus.length = 0;
  notify.mockClear();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("payments webhook route", () => {
  it("returns a bare 400 for a bad signature, garbage, or a disabled provider", async () => {
    seed();
    const bad = await POST(hook(paid(), "00".repeat(32)));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "Bad request" });
    expect((await POST(new Request("http://x/api/webhooks/payments", { method: "POST", body: "{}" }))).status).toBe(400);
    expect(store.payments.get("pay-appt1-0")?.status).toBe("pending");

    vi.stubEnv("PAYMENTS_PROVIDER", "none");
    expect((await POST(hook(paid()))).status).toBe(400);
  });

  it("marks paid, mirrors the appointment, and sends deposit received once", async () => {
    seed();
    expect((await POST(hook(paid()))).status).toBe(200);
    expect(store.payments.get("pay-appt1-0")).toMatchObject({ status: "paid", providerPaymentId: "pi_1", eventIds: ["evt_1"] });
    expect(store.appointmentStatus).toEqual(["paid"]);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]).toMatchObject(["deposit_received", expect.anything(), { amountText: "$25.00", idempotencyKey: "deposit:pay-appt1-0" }]);
  });

  it("is idempotent on the provider event id (redelivery does nothing)", async () => {
    seed();
    await POST(hook(paid("evt_1")));
    const again = await POST(hook(paid("evt_1")));
    expect(again.status).toBe(200);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(store.appointmentStatus).toEqual(["paid"]);
    // a different event for an already-paid payment does not re-notify either
    await POST(hook(paid("evt_2")));
    expect(notify).toHaveBeenCalledTimes(1);
    expect(store.payments.get("pay-appt1-0")?.eventIds).toEqual(["evt_1", "evt_2"]);
  });

  it("never marks paid when the amount or currency differs", async () => {
    seed();
    await POST(hook(paid("evt_a", { amountMinor: 100 })));
    await POST(hook(paid("evt_b", { currency: "EUR" })));
    expect(store.payments.get("pay-appt1-0")?.status).toBe("pending");
    expect(notify).not.toHaveBeenCalled();
    expect(store.appointmentStatus).toEqual([]);
  });

  it("handles expiry and failure only for pending payments, and unknown sessions with 200", async () => {
    seed();
    await POST(hook({ id: "e1", type: "checkout_expired", providerSessionId: "sess_1" }));
    expect(store.payments.get("pay-appt1-0")?.status).toBe("expired");
    expect(store.appointmentStatus).toEqual(["expired"]);
    seed({ status: "paid", eventIds: [] });
    await POST(hook({ id: "e2", type: "payment_failed", providerSessionId: "sess_1" }));
    expect(store.payments.get("pay-appt1-0")?.status).toBe("paid");
    expect((await POST(hook(paid("e3", { providerSessionId: "unknown" })))).status).toBe(200);
  });

  it("returns 500 (so the provider retries) when processing fails", async () => {
    seed();
    notify.mockRejectedValueOnce(new Error("x")); // swallowed: still 200
    expect((await POST(hook(paid()))).status).toBe(200);
    const store2 = await import("@/lib/payments/store");
    vi.mocked(store2.findPaymentBySession).mockRejectedValueOnce(new Error("db down"));
    expect((await POST(hook(paid("evt_9")))).status).toBe(500);
  });
});

describe("getOrCreateDepositCheckout", () => {
  const provider = createMockProvider({ secret: SECRET });
  const appt = { $id: "appt1", userId: "u1", depositStatus: null };
  const urls = { successUrl: "http://localhost:3000/patients/u1/new-appointment/success?a=1", cancelUrl: "http://localhost:3000/x" };

  it("is not required when deposits are off or already paid", async () => {
    vi.stubEnv("DEPOSIT_AMOUNT_MINOR", "0");
    expect(await getOrCreateDepositCheckout(appt, urls, { provider })).toEqual({ required: false });
    vi.stubEnv("DEPOSIT_AMOUNT_MINOR", "2500");
    expect(await getOrCreateDepositCheckout({ ...appt, depositStatus: "paid" }, urls, { provider })).toEqual({ required: false });
  });

  it("creates once and reuses the open checkout", async () => {
    const spy = vi.spyOn(provider, "createCheckout");
    const first = await getOrCreateDepositCheckout(appt, urls, { provider });
    const second = await getOrCreateDepositCheckout(appt, urls, { provider });
    expect(first.required).toBe(true);
    expect(first.url).toMatch(/^\/patients\/u1\/new-appointment\/success/);
    expect(second).toEqual(first);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(store.payments.size).toBe(1);
    expect(store.appointmentStatus).toEqual(["pending"]);
  });

  it("creates a fresh attempt once the open one is about to expire", async () => {
    await getOrCreateDepositCheckout(appt, urls, { provider });
    const later = () => new Date(Date.now() + 22.5 * 3600_000);
    const next = await getOrCreateDepositCheckout(appt, urls, { provider, now: later });
    expect(next.required).toBe(true);
    expect(store.payments.size).toBe(2);
  });

  it("refund stub is not implemented and the policy hook is pure", async () => {
    expect((await refundDeposit("appt1")).ok).toBe(false);
    const start = new Date("2026-10-10T10:00:00Z");
    expect(isDepositRefundEligible({ appointmentStart: start, cancelledAt: new Date("2026-10-08T09:00:00Z"), hoursBefore: 24 })).toBe(true);
    expect(isDepositRefundEligible({ appointmentStart: start, cancelledAt: new Date("2026-10-10T00:00:00Z"), hoursBefore: 24 })).toBe(false);
  });
});
