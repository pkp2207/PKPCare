// Shared types for the notification layer. No runtime imports.

export const CHANNELS = ["sms", "email", "whatsapp"] as const;
export type Channel = (typeof CHANNELS)[number];

export const isChannel = (value: unknown): value is Channel =>
  typeof value === "string" && (CHANNELS as readonly string[]).includes(value);

export type TemplateId =
  | "booking_received"
  | "confirmed"
  | "cancelled"
  | "rescheduled"
  | "reminder_24h"
  | "reminder_1h"
  | "waitlist_offer"
  | "deposit_received";

export const TEMPLATE_IDS: readonly TemplateId[] = [
  "booking_received",
  "confirmed",
  "cancelled",
  "rescheduled",
  "reminder_24h",
  "reminder_1h",
  "waitlist_offer",
  "deposit_received",
];

/**
 * The ONLY data a template may use. Deliberately has no reason / note /
 * diagnosis / patient name: message text carries doctor name + time only.
 */
export type TemplateData = {
  doctorName?: string | null;
  start?: Date | string | null;
  /** IANA zone of the doctor; times render in it when valid. */
  timezone?: string | null;
  /** Signed action link (absolute URL). Omitted when not configured. */
  link?: string | null;
  /** Pre-formatted, e.g. "USD 25.00". */
  amountText?: string | null;
  /** Waitlist offers: how long the claim window lasts. */
  claimMinutes?: number | null;
};

export type Recipient = {
  /** Appwrite user id: SMS and email target the user's own messaging targets. */
  userId: string;
  /** E.164-ish; only needed for WhatsApp. */
  phone?: string | null;
  email?: string | null;
};

export type SendRequest = {
  channel: Channel;
  to: Recipient;
  template: TemplateId;
  data: TemplateData;
  /**
   * When set, the provider derives a deterministic message id from it so a
   * repeated send is a no-op (Appwrite answers 409 for an existing id). When
   * absent a random id is used (legacy behaviour of the old SMS helper).
   */
  idempotencyKey?: string;
  locale?: string;
};

export type SendResult = {
  ok: boolean;
  providerId?: string;
  /** Short machine code only. Never message text, phone or email. */
  error?: string;
};

export interface NotificationProvider {
  readonly channel: Channel;
  send(request: SendRequest): Promise<SendResult>;
}

export type DeliveryAttempt = { channel: Channel; ok: boolean; error?: string };

export type NotifyResult = {
  ok: boolean;
  delivered: Channel[];
  attempts: DeliveryAttempt[];
};
