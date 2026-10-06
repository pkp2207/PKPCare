import { describe, expect, it } from "vitest";

import { renderTemplate, TEMPLATES } from "@/lib/notifications/templates";
import { TEMPLATE_IDS } from "@/lib/notifications/types";

const data = {
  doctorName: "Jane Doe",
  start: new Date("2026-10-08T10:00:00.000Z"),
  timezone: "UTC",
  link: "https://app.example/a/tok",
  amountText: "USD 25.00",
  claimMinutes: 30,
};

describe("templates", () => {
  it("renders every template for every channel", () => {
    for (const id of TEMPLATE_IDS) {
      const r = renderTemplate(id, data);
      expect(r.sms.length).toBeGreaterThan(10);
      expect(r.subject.length).toBeGreaterThan(3);
      expect(r.text).toContain("PKPCare");
      expect(r.whatsapp.name).toBe(`pkpcare_${id}`);
      expect(r.whatsapp.params.every((p) => p.length > 0)).toBe(true);
    }
  });

  it("keeps the legacy confirmed/cancelled/rescheduled SMS text without a link", () => {
    const d = { doctorName: "Jane Doe", start: data.start };
    const r = (id: Parameters<typeof renderTemplate>[0]) => renderTemplate(id, d).sms;
    expect(r("confirmed")).toMatch(/^Greetings from PKPCare\. Your appointment is confirmed for .+ with Dr\. Jane Doe\.$/);
    expect(r("cancelled")).toMatch(/^Greetings from PKPCare\. Your appointment for .+ has been cancelled\.$/);
    expect(r("rescheduled")).toMatch(/^Greetings from PKPCare\. Your appointment has been moved to .+ with Dr\. Jane Doe\.$/);
  });

  it("includes the signed link where an action exists, not on cancellations", () => {
    expect(renderTemplate("reminder_24h", data).sms).toContain(data.link);
    expect(renderTemplate("waitlist_offer", data).text).toContain(data.link);
    expect(renderTemplate("cancelled", data).sms).not.toContain(data.link);
  });

  it("never leaks PHI-ish fields passed alongside the allowed data", () => {
    const polluted = {
      ...data,
      reason: "chemotherapy follow-up",
      note: "HIV positive",
      diagnosis: "melanoma",
      patientName: "Pat Ient",
      email: "pat@example.com",
      phone: "+14155550123",
    } as never;
    for (const id of TEMPLATE_IDS) {
      const r = renderTemplate(id, polluted);
      const all = JSON.stringify(r);
      expect(all).not.toMatch(/chemo|HIV|melanoma|Pat Ient|pat@example|415555/i);
    }
  });

  it("does not double the Dr. prefix and tolerates missing data", () => {
    expect(renderTemplate("confirmed", { doctorName: "Dr. Who", start: data.start }).sms).toContain("Dr. Who");
    expect(renderTemplate("confirmed", { doctorName: "Dr. Who", start: data.start }).sms).not.toContain("Dr. Dr.");
    expect(renderTemplate("confirmed", {}).sms).toContain("your doctor");
  });

  it("formats in the doctor's timezone when given", () => {
    const r = renderTemplate("rescheduled", { ...data, timezone: "Asia/Kolkata" });
    expect(r.sms).toContain("3:30 PM");
  });

  it("falls back to English for unknown locales", () => {
    expect(TEMPLATES.en).toBeDefined();
    expect(renderTemplate("confirmed", data, "fr-FR").sms).toBe(renderTemplate("confirmed", data, "en").sms);
  });
});
