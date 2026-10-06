import { createHash, timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { recordAudit } from "@/lib/compliance/audit";
import { runReminders } from "@/lib/notifications/reminders";
import { expireStaleWaitlistOffers } from "@/lib/scheduling/offers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Constant-time comparison; hashing first makes lengths equal.
const secretsMatch = (provided: string, expected: string) => {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
};

const isAuthorized = (request: Request) => {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false; // fail closed when not configured

  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer (.+)$/.exec(header);
  if (!match) return false;
  return secretsMatch(match[1], expected);
};

const handle = async (request: Request) => {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";

  try {
    const reminders = await runReminders({ dryRun });
    const offers = await expireStaleWaitlistOffers({ dryRun });

    const sent =
      reminders.windows.reminder_24h.sent + reminders.windows.reminder_1h.sent;
    const failed =
      reminders.windows.reminder_24h.failed +
      reminders.windows.reminder_1h.failed +
      offers.errors;
    await recordAudit({
      actorId: null,
      actorRole: "system",
      action: "reminders.run",
      resource: "reminders",
      outcome: failed > 0 ? "error" : "success",
      meta: { dryRun, count: sent, errors: failed },
    });
    return NextResponse.json({ ok: true, reminders, waitlistOffers: offers });
  } catch {
    await recordAudit({
      actorId: null,
      actorRole: "system",
      action: "reminders.run",
      resource: "reminders",
      outcome: "error",
      meta: { dryRun },
    });
    return NextResponse.json({ error: "Reminder run failed" }, { status: 500 });
  }
};

export const GET = handle;
export const POST = handle;
