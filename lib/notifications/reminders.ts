// Reminder sweep run by app/api/cron/reminders. Idempotent via per-appointment
// flags that are written only AFTER a successful send.
import { MINUTE_MS } from "@/lib/scheduling/time";

import { reminderBatchSize, reminderIntervalMinutes } from "./config";
import { notifyAppointment } from "./events";
import {
  listScheduledInWindow,
  patchAppointmentFlags,
  type NotificationAppointment,
} from "./store";

export type ReminderKind = "reminder_24h" | "reminder_1h";

const KINDS: { kind: ReminderKind; leadMinutes: number; flag: "reminder24hSentAt" | "reminder1hSentAt" }[] = [
  { kind: "reminder_24h", leadMinutes: 24 * 60, flag: "reminder24hSentAt" },
  { kind: "reminder_1h", leadMinutes: 60, flag: "reminder1hSentAt" },
];

/** [now + lead - tolerance, now + lead + tolerance]. Pure. */
export const reminderWindow = (now: Date, leadMinutes: number, toleranceMinutes: number) => ({
  from: new Date(now.getTime() + (leadMinutes - toleranceMinutes) * MINUTE_MS),
  to: new Date(now.getTime() + (leadMinutes + toleranceMinutes) * MINUTE_MS),
});

export type ReminderDeps = {
  list?: typeof listScheduledInWindow;
  patch?: typeof patchAppointmentFlags;
  notify?: typeof notifyAppointment;
};

export type ReminderSummary = {
  dryRun: boolean;
  windows: Record<ReminderKind, { found: number; due: number; sent: number; failed: number }>;
  skippedNoSchema: number;
};

export const runReminders = async (
  options: { dryRun?: boolean; now?: Date } = {},
  deps: ReminderDeps = {}
): Promise<ReminderSummary> => {
  const now = options.now ?? new Date();
  const dryRun = Boolean(options.dryRun);
  const list = deps.list ?? listScheduledInWindow;
  const patch = deps.patch ?? patchAppointmentFlags;
  const notify = deps.notify ?? notifyAppointment;
  const tolerance = reminderIntervalMinutes();
  const batch = reminderBatchSize();

  const summary: ReminderSummary = {
    dryRun,
    windows: {
      reminder_24h: { found: 0, due: 0, sent: 0, failed: 0 },
      reminder_1h: { found: 0, due: 0, sent: 0, failed: 0 },
    },
    skippedNoSchema: 0,
  };

  for (const { kind, leadMinutes, flag } of KINDS) {
    const stats = summary.windows[kind];
    const { from, to } = reminderWindow(now, leadMinutes, tolerance);
    let appointments: NotificationAppointment[];
    try {
      appointments = await list(from, to, batch);
    } catch (error) {
      console.error(`[reminders] ${kind} query failed:`, (error as Error)?.name);
      stats.failed += 1;
      continue;
    }
    stats.found = appointments.length;

    for (const appointment of appointments) {
      // Attribute absent => schema not migrated: cannot be idempotent, so skip.
      if (!(flag in appointment)) {
        summary.skippedNoSchema += 1;
        continue;
      }
      if (appointment[flag]) continue; // already sent
      stats.due += 1;
      if (dryRun) continue;

      try {
        const startMs = new Date(appointment.schedule as unknown as string).getTime();
        const result = await notify(kind, appointment, {
          idempotencyKey: `${kind}:${appointment.$id}:${startMs}`,
        });
        if (!result?.ok) {
          stats.failed += 1;
          continue;
        }
        await patch(appointment.$id, { [flag]: new Date().toISOString() });
        stats.sent += 1;
      } catch (error) {
        stats.failed += 1;
        console.error(`[reminders] ${kind} item failed:`, (error as Error)?.name);
      }
    }
  }
  return summary;
};
