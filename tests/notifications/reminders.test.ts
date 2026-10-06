import { describe, expect, it, vi } from "vitest";

import { reminderWindow, runReminders } from "@/lib/notifications/reminders";

vi.mock("@/lib/appwrite/client", () => ({ getClients: vi.fn() }));
vi.mock("@/lib/appwrite/appointment.repository", () => ({ sendSms: vi.fn() }));
vi.mock("@/lib/appwrite/patient.repository", () => ({ getPatientByUserId: vi.fn() }));
vi.mock("@/lib/appwrite/doctor.repository", () => ({ getDoctor: vi.fn() }));

const NOW = new Date("2026-10-07T08:00:00.000Z");
const MIN = 60_000;

type Doc = Record<string, unknown> & { $id: string; schedule: string };
const doc = (id: string, minsAhead: number, over: Record<string, unknown> = {}): Doc => ({
  $id: id,
  userId: "u1",
  status: "scheduled",
  primaryPhysician: "Jane",
  schedule: new Date(NOW.getTime() + minsAhead * MIN).toISOString(),
  reminder24hSentAt: null,
  reminder1hSentAt: null,
  ...over,
});

const harness = (docs: Doc[], notifyOk = true) => {
  const list = vi.fn(async (from: Date, to: Date) =>
    docs.filter((d) => {
      const t = Date.parse(d.schedule);
      return t >= from.getTime() && t <= to.getTime();
    })
  );
  const patch = vi.fn(async (id: string, flags: Record<string, string>) => {
    Object.assign(docs.find((d) => d.$id === id) as Doc, flags);
  });
  const notify = vi.fn(async () => (notifyOk ? { ok: true, delivered: ["sms"], attempts: [] } : null));
  return { list, patch, notify, deps: { list, patch, notify } as never };
};

describe("reminder windows", () => {
  it("is +/- tolerance around the lead time", () => {
    const w = reminderWindow(NOW, 60, 10);
    expect(w.from.getTime() - NOW.getTime()).toBe(50 * MIN);
    expect(w.to.getTime() - NOW.getTime()).toBe(70 * MIN);
  });
});

describe("runReminders", () => {
  it("sends 24h and 1h reminders only inside their windows and sets flags after success", async () => {
    const docs = [doc("a24", 24 * 60 + 5), doc("a1", 58), doc("far", 5 * 60), doc("soon", 20)];
    const h = harness(docs);
    const summary = await runReminders({ now: NOW }, h.deps);
    expect(summary.windows.reminder_24h).toMatchObject({ found: 1, sent: 1, failed: 0 });
    expect(summary.windows.reminder_1h).toMatchObject({ found: 1, sent: 1, failed: 0 });
    expect(docs[0].reminder24hSentAt).toBeTruthy();
    expect(docs[1].reminder1hSentAt).toBeTruthy();
    expect(docs[2].reminder24hSentAt).toBeNull();
    expect(docs[3].reminder1hSentAt).toBeNull();
    expect(h.notify).toHaveBeenCalledTimes(2);
  });

  it("is idempotent across repeated runs", async () => {
    const docs = [doc("a1", 60)];
    const h = harness(docs);
    await runReminders({ now: NOW }, h.deps);
    const again = await runReminders({ now: new Date(NOW.getTime() + 5 * MIN) }, h.deps);
    expect(h.notify).toHaveBeenCalledTimes(1);
    expect(again.windows.reminder_1h.sent).toBe(0);
  });

  it("does not set the flag when the send fails, so the next run retries", async () => {
    const docs = [doc("a1", 60)];
    const h = harness(docs, false);
    const summary = await runReminders({ now: NOW }, h.deps);
    expect(summary.windows.reminder_1h.failed).toBe(1);
    expect(h.patch).not.toHaveBeenCalled();
    expect(docs[0].reminder1hSentAt).toBeNull();
  });

  it("isolates per-item errors", async () => {
    const docs = [doc("bad", 60), doc("good", 62)];
    const h = harness(docs);
    h.notify.mockImplementationOnce(async () => {
      throw new Error("x");
    });
    const summary = await runReminders({ now: NOW }, h.deps);
    expect(summary.windows.reminder_1h).toMatchObject({ sent: 1, failed: 1 });
    expect(docs[1].reminder1hSentAt).toBeTruthy();
  });

  it("dry run sends and writes nothing but reports what is due", async () => {
    const docs = [doc("a1", 60), doc("a24", 24 * 60)];
    const h = harness(docs);
    const summary = await runReminders({ now: NOW, dryRun: true }, h.deps);
    expect(summary).toMatchObject({ dryRun: true });
    expect(summary.windows.reminder_1h.due).toBe(1);
    expect(summary.windows.reminder_24h.due).toBe(1);
    expect(h.notify).not.toHaveBeenCalled();
    expect(h.patch).not.toHaveBeenCalled();
  });

  it("skips appointments whose collection lacks the flag attribute", async () => {
    const legacy = doc("old", 60);
    delete legacy.reminder1hSentAt;
    const h = harness([legacy]);
    const summary = await runReminders({ now: NOW }, h.deps);
    expect(summary.skippedNoSchema).toBe(1);
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("passes a stable idempotency key", async () => {
    const h = harness([doc("a1", 60)]);
    await runReminders({ now: NOW }, h.deps);
    const call = h.notify.mock.calls[0] as unknown as [string, unknown, { idempotencyKey: string }];
    expect(call[2].idempotencyKey).toMatch(/^reminder_1h:a1:\d+$/);
  });
});
