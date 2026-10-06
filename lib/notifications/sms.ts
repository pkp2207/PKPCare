// SMS via Appwrite Messaging, targeting the Appwrite user's own SMS target.
// Requires an SMS provider (Twilio, MSG91, Vonage, ...) enabled in the project
// and the user to have a phone target.
import * as appointmentRepo from "@/lib/appwrite/appointment.repository";
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

export const smsProvider: NotificationProvider = {
  channel: "sms",
  async send(request: SendRequest): Promise<SendResult> {
    const content = renderTemplate(
      request.template,
      request.data,
      request.locale
    ).sms;
    try {
      if (!request.idempotencyKey) {
        // Legacy path (same call the old notifyBySms made): random message id.
        await appointmentRepo.sendSms(request.to.userId, content);
        return { ok: true };
      }
      const id = deterministicMessageId("sms", request.idempotencyKey);
      try {
        await getClients().messaging.createSms(id, content, [], [request.to.userId]);
      } catch (error) {
        if (isConflict(error)) return { ok: true, providerId: id }; // already sent
        throw error;
      }
      return { ok: true, providerId: id };
    } catch (error) {
      return { ok: false, error: errorCode(error) };
    }
  },
};
