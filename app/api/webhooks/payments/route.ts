import { NextResponse } from "next/server";

import { getPaymentProvider } from "@/lib/payments/config";
import { processPaymentEvent } from "@/lib/payments/webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BAD_REQUEST = () => NextResponse.json({ error: "Bad request" }, { status: 400 });

/**
 * Payment provider webhook. The signature is verified over the RAW body; any
 * verification problem (including a disabled provider) is a bare 400. A
 * verified event is applied idempotently; a processing failure returns 500 so
 * the provider retries (safe: events are deduplicated by id).
 */
export const POST = async (request: Request) => {
  const provider = getPaymentProvider();
  if (!provider) return BAD_REQUEST();

  const rawBody = await request.text();
  let event;
  try {
    event = provider.verifyWebhook(rawBody, request.headers);
  } catch {
    return BAD_REQUEST();
  }

  try {
    await processPaymentEvent(event);
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[payments] webhook processing failed:", (error as Error)?.name);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
};
