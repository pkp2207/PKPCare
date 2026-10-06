// Message templates. Keyed by locale with an English fallback so adding a
// language is a new entry in TEMPLATES, not a code change.
//
// PHI rule: text may contain the doctor's name, the time, an amount and a link
// only. There is deliberately no field for the visit reason, notes or
// diagnosis, and no patient name (TemplateData cannot carry them).
import { formatTimeOnly, formatWhen } from "./format";
import type { TemplateData, TemplateId } from "./types";

export type Rendered = {
  /** Single SMS body. */
  sms: string;
  /** Email subject + plain text body. */
  subject: string;
  text: string;
  /**
   * WhatsApp template message: approved template `name` (see
   * docs/notifications.md) with ordered body parameters {{1}}..{{n}}.
   */
  whatsapp: { name: string; language: string; params: string[] };
};

type Prepared = {
  doctor: string; // "Dr. Jane Doe" or "your doctor"
  when: string;
  time: string;
  link: string | null;
  amount: string;
  minutes: number;
};

type Def = {
  sms: (d: Prepared) => string;
  subject: string;
  email: (d: Prepared) => string;
  whatsappParams: (d: Prepared) => string[];
};

const DEFAULT_LOCALE = "en";
const SIGNOFF = "PKPCare";

const prepare = (data: TemplateData): Prepared => {
  const name = (data.doctorName ?? "").replace(/^\s*dr\.?\s+/i, "").trim();
  return {
    doctor: name ? `Dr. ${name}` : "your doctor",
    when: data.start ? formatWhen(data.start, data.timezone) : "the scheduled time",
    time: data.start ? formatTimeOnly(data.start, data.timezone) : "the scheduled time",
    link: data.link ? data.link : null,
    amount: data.amountText ?? "",
    minutes: data.claimMinutes && data.claimMinutes > 0 ? data.claimMinutes : 30,
  };
};

const withLink = (text: string, label: string, link: string | null) =>
  link ? `${text} ${label}: ${link}` : text;

const linkParam = (d: Prepared) => d.link ?? "-";

const EN: Record<TemplateId, Def> = {
  booking_received: {
    sms: (d) =>
      withLink(
        `Greetings from PKPCare. We received your appointment request for ${d.when} with ${d.doctor}. We will confirm it shortly.`,
        "Manage",
        d.link
      ),
    subject: "We received your appointment request",
    email: (d) =>
      withLink(
        `We received your appointment request for ${d.when} with ${d.doctor}. We will confirm it shortly.`,
        "Manage your appointment",
        d.link
      ),
    whatsappParams: (d) => [d.doctor, d.when, linkParam(d)],
  },
  confirmed: {
    // Text kept identical to the pre-existing SMS when no link is available.
    sms: (d) =>
      withLink(
        `Greetings from PKPCare. Your appointment is confirmed for ${d.when} with ${d.doctor}.`,
        "Manage",
        d.link
      ),
    subject: "Your appointment is confirmed",
    email: (d) =>
      withLink(
        `Your appointment is confirmed for ${d.when} with ${d.doctor}.`,
        "Confirm attendance, cancel or reschedule",
        d.link
      ),
    whatsappParams: (d) => [d.doctor, d.when, linkParam(d)],
  },
  cancelled: {
    // No reason is included (free text can hold clinical detail) and no link:
    // there is nothing left to act on.
    sms: (d) =>
      `Greetings from PKPCare. Your appointment for ${d.when} has been cancelled.`,
    subject: "Your appointment was cancelled",
    email: (d) => `Your appointment for ${d.when} has been cancelled.`,
    whatsappParams: (d) => [d.when],
  },
  rescheduled: {
    sms: (d) =>
      withLink(
        `Greetings from PKPCare. Your appointment has been moved to ${d.when} with ${d.doctor}.`,
        "Manage",
        d.link
      ),
    subject: "Your appointment was rescheduled",
    email: (d) =>
      withLink(
        `Your appointment has been moved to ${d.when} with ${d.doctor}.`,
        "Confirm attendance, cancel or reschedule",
        d.link
      ),
    whatsappParams: (d) => [d.doctor, d.when, linkParam(d)],
  },
  reminder_24h: {
    sms: (d) =>
      withLink(
        `PKPCare reminder: you have an appointment on ${d.when} with ${d.doctor}.`,
        "Confirm or change",
        d.link
      ),
    subject: "Appointment reminder for tomorrow",
    email: (d) =>
      withLink(
        `This is a reminder of your appointment on ${d.when} with ${d.doctor}.`,
        "Confirm attendance, cancel or reschedule",
        d.link
      ),
    whatsappParams: (d) => [d.doctor, d.when, linkParam(d)],
  },
  reminder_1h: {
    sms: (d) =>
      withLink(
        `PKPCare reminder: your appointment with ${d.doctor} starts at ${d.time}.`,
        "Details",
        d.link
      ),
    subject: "Your appointment starts in about an hour",
    email: (d) =>
      withLink(
        `Your appointment with ${d.doctor} starts at ${d.time}.`,
        "Details",
        d.link
      ),
    whatsappParams: (d) => [d.doctor, d.time, linkParam(d)],
  },
  waitlist_offer: {
    sms: (d) =>
      withLink(
        `PKPCare: a slot opened with ${d.doctor} on ${d.when}. It is held for you for ${d.minutes} minutes.`,
        "Book it",
        d.link
      ),
    subject: "An appointment slot opened up",
    email: (d) =>
      withLink(
        `A slot opened with ${d.doctor} on ${d.when}. It is held for you for ${d.minutes} minutes.`,
        "Book this slot",
        d.link
      ),
    whatsappParams: (d) => [d.doctor, d.when, linkParam(d), String(d.minutes)],
  },
  deposit_received: {
    sms: (d) =>
      withLink(
        `PKPCare: we received your deposit${d.amount ? ` of ${d.amount}` : ""} for your appointment on ${d.when}. Thank you.`,
        "Manage",
        d.link
      ),
    subject: "Deposit received",
    email: (d) =>
      withLink(
        `We received your deposit${d.amount ? ` of ${d.amount}` : ""} for your appointment on ${d.when}. Thank you.`,
        "Manage your appointment",
        d.link
      ),
    whatsappParams: (d) => [d.amount || "-", d.when, linkParam(d)],
  },
};

/** Add further locales here (same shape). Missing keys fall back to English. */
export const TEMPLATES: Record<string, Partial<Record<TemplateId, Def>>> = {
  en: EN,
};

const pickLocale = (locale?: string): string => {
  const base = (locale ?? DEFAULT_LOCALE).toLowerCase().split(/[-_]/)[0];
  return TEMPLATES[base] ? base : DEFAULT_LOCALE;
};

export const whatsappTemplateName = (
  template: TemplateId,
  env: Record<string, string | undefined> = process.env
) => `${env.WHATSAPP_TEMPLATE_PREFIX?.trim() || "pkpcare_"}${template}`;

export const renderTemplate = (
  template: TemplateId,
  data: TemplateData,
  locale?: string
): Rendered => {
  const def = TEMPLATES[pickLocale(locale)]?.[template] ?? EN[template];
  const prepared = prepare(data);
  const body = def.email(prepared);
  return {
    sms: def.sms(prepared),
    subject: def.subject,
    text: `${body}\n\n${SIGNOFF}`,
    whatsapp: {
      name: whatsappTemplateName(template),
      language: pickLocale(locale) === DEFAULT_LOCALE ? "en" : pickLocale(locale),
      params: def.whatsappParams(prepared),
    },
  };
};
