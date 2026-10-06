import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cancelViaLink, confirmAttendance } from "@/lib/actions/notification.actions";
import { signLinkToken } from "@/lib/notifications/links";
import { getNotificationAppointment, patchAppointmentFlags } from "@/lib/notifications/store";
import { cancelAppointmentByAuthority } from "@/lib/scheduling/cancel";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/compliance/audit", () => ({ recordAudit: vi.fn(async () => undefined) }));
vi.mock("@/lib/notifications/store", () => ({
  getNotificationAppointment: vi.fn(),
  patchAppointmentFlags: vi.fn(async () => undefined),
}));
vi.mock("@/lib/notifications/events", () => ({ notifyAppointment: vi.fn(async () => null) }));
vi.mock("@/lib/scheduling/cancel", () => ({ cancelAppointmentByAuthority: vi.fn() }));

const SECRET = "link-secret-for-tests";
const future = new Date(Date.now() + 2 * 86400_000);
const exp = Math.floor(future.getTime() / 1000);
const token = (purpose: "confirm" | "cancel" | "reschedule", userId = "u1", e = exp) =>
  signLinkToken({ appointmentId: "a1", userId, purpose, exp: e }) as string;

const appt = (over: Record<string, unknown> = {}) => ({
  $id: "a1",
  userId: "u1",
  status: "scheduled",
  schedule: future.toISOString(),
  confirmedByPatientAt: null,
  ...over,
});

beforeEach(() => {
  vi.stubEnv("NOTIFICATION_LINK_SECRET", SECRET);
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("confirmAttendance", () => {
  it("records the confirmation once and is idempotent afterwards", async () => {
    vi.mocked(getNotificationAppointment).mockResolvedValueOnce(appt() as never);
    const first = await confirmAttendance(token("confirm"));
    expect(first).toMatchObject({ ok: true, data: { alreadyConfirmed: false } });
    expect(patchAppointmentFlags).toHaveBeenCalledWith("a1", { confirmedByPatientAt: expect.any(String) });

    vi.mocked(getNotificationAppointment).mockResolvedValueOnce(
      appt({ confirmedByPatientAt: "2026-10-06T00:00:00.000Z" }) as never
    );
    const second = await confirmAttendance(token("confirm"));
    expect(second).toMatchObject({ ok: true, data: { alreadyConfirmed: true } });
    expect(patchAppointmentFlags).toHaveBeenCalledTimes(1);
  });

  it("rejects wrong purpose, expired, tampered and other users' tokens generically", async () => {
    vi.mocked(getNotificationAppointment).mockResolvedValue(appt() as never);
    const bad = [
      token("cancel"),
      token("confirm", "u1", Math.floor(Date.now() / 1000) - 10),
      `${token("confirm")}x`,
      "garbage",
    ];
    for (const t of bad) {
      expect(await confirmAttendance(t)).toEqual({ ok: false, error: "This link is invalid or has expired." });
    }
    // valid token but appointment belongs to someone else
    vi.mocked(getNotificationAppointment).mockResolvedValue(appt({ userId: "other" }) as never);
    expect((await confirmAttendance(token("confirm"))).ok).toBe(false);
    expect(patchAppointmentFlags).not.toHaveBeenCalled();
  });

  it("refuses cancelled appointments and a missing attribute", async () => {
    vi.mocked(getNotificationAppointment).mockResolvedValueOnce(appt({ status: "cancelled" }) as never);
    expect((await confirmAttendance(token("confirm"))).ok).toBe(false);
    const legacy = appt();
    delete (legacy as Record<string, unknown>).confirmedByPatientAt;
    vi.mocked(getNotificationAppointment).mockResolvedValueOnce(legacy as never);
    expect((await confirmAttendance(token("confirm"))).ok).toBe(false);
    expect(patchAppointmentFlags).not.toHaveBeenCalled();
  });
});

describe("cancelViaLink", () => {
  it("cancels through the shared helper using the token's identity", async () => {
    vi.mocked(cancelAppointmentByAuthority).mockResolvedValueOnce({
      ok: true,
      existing: appt(),
      updated: appt({ status: "cancelled" }),
    } as never);
    const result = await cancelViaLink({ token: token("cancel"), reason: "Cannot make it" });
    expect(result).toEqual({ ok: true, data: { cancelled: true } });
    expect(cancelAppointmentByAuthority).toHaveBeenCalledWith({
      appointmentId: "a1",
      userId: "u1",
      reason: "Cannot make it",
    });
  });

  it("requires the cancel purpose and a reason", async () => {
    expect((await cancelViaLink({ token: token("confirm"), reason: "Cannot make it" })).ok).toBe(false);
    expect((await cancelViaLink({ token: token("cancel"), reason: "x" })).ok).toBe(false);
    expect(cancelAppointmentByAuthority).not.toHaveBeenCalled();
  });

  it("maps 'not found' to the generic link error and passes other errors through", async () => {
    vi.mocked(cancelAppointmentByAuthority).mockResolvedValueOnce({ ok: false, error: "Appointment not found" });
    expect(await cancelViaLink({ token: token("cancel"), reason: "Cannot make it" })).toEqual({
      ok: false,
      error: "This link is invalid or has expired.",
    });
    vi.mocked(cancelAppointmentByAuthority).mockResolvedValueOnce({ ok: false, error: "This appointment is already cancelled" });
    expect((await cancelViaLink({ token: token("cancel"), reason: "Cannot make it" }))).toEqual({
      ok: false,
      error: "This appointment is already cancelled",
    });
  });
});
