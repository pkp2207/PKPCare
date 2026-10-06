// Email via Appwrite Messaging, targeting the Appwrite user's email target.
// Requires an email provider (SMTP, Mailgun, SendGrid, ...) enabled in the
// project. Plain text only: no tracking, no HTML, no PHI beyond the template.
import { ID } from "node-appwrite";

import { getClients } from "@/lib/appwrite/client";

import { deterministicMessageId } from "./message-id";
import { renderTemplate } from "./templates";
import type { NotificationProvider, SendRequest, SendResult } from "./types";

const isConflict = (error: unknown) =>
  (error as { code?: number } | null)?.code === 409;

const errorCode = (error: unknown) => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "number" ? `appwrite_${code}` : "appwrite_error";
};

export const emailProvider: NotificationProvider = {
  channel: "email",
  async send(request: SendRequest): Promise<SendResult> {
    const { subject, text } = renderTemplate(
      request.template,
      request.data,
      request.locale
    );
    const id = request.idempotencyKey
      ? deterministicMessageId("email", request.idempotencyKey)
      : ID.unique();
    try {
      await getClients().messaging.createEmail(
        id,
        subject,
        text,
        [],
        [request.to.userId],
        [],
        [],
        [],
        [],
        false, // draft
        false // html
      );
      return { ok: true, providerId: id };
    } catch (error) {
      if (request.idempotencyKey && isConflict(error)) {
        return { ok: true, providerId: id }; // already sent
      }
      return { ok: false, error: errorCode(error) };
    }
  },
};
