import { createHash, timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { recordAudit } from "@/lib/compliance/audit";
import { purgeExpiredRecords } from "@/lib/compliance/retention";

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
    const result = await purgeExpiredRecords({ dryRun });
    return NextResponse.json({ ok: true, ...result });
  } catch {
    await recordAudit({
      actorId: null,
      actorRole: "system",
      action: "retention.purge",
      resource: "retention",
      outcome: "error",
      meta: { dryRun },
    });
    return NextResponse.json(
      { error: "Retention run failed" },
      { status: 500 },
    );
  }
};

export const GET = handle;
export const POST = handle;
