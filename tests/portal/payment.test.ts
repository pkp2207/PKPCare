import { describe, expect, it } from "vitest";

import {
  formatMinorAmount,
  isSafeCheckoutUrl,
  resolvePostBooking,
  successHref,
} from "@/components/portal/payment";

describe("resolvePostBooking", () => {
  const success = { kind: "success", href: successHref("u1", "a1") };

  it("goes to checkout when a deposit is required and the url is https", () => {
    expect(
      resolvePostBooking("u1", "a1", {
        ok: true,
        data: { required: true, url: "https://pay.example.com/c/abc" },
      })
    ).toEqual({ kind: "checkout", url: "https://pay.example.com/c/abc" });
  });

  it("goes to success when no deposit is required", () => {
    expect(resolvePostBooking("u1", "a1", { ok: true, data: { required: false } })).toEqual(success);
    expect(
      resolvePostBooking("u1", "a1", { ok: true, data: { required: false, url: "https://x.test" } })
    ).toEqual(success);
  });

  it("treats errors, missing results and missing urls as not required", () => {
    expect(resolvePostBooking("u1", "a1", { ok: false, error: "down" })).toEqual(success);
    expect(resolvePostBooking("u1", "a1", null)).toEqual(success);
    expect(resolvePostBooking("u1", "a1", undefined)).toEqual(success);
    expect(resolvePostBooking("u1", "a1", { ok: true, data: { required: true } })).toEqual(success);
  });

  it("never follows unsafe checkout urls", () => {
    for (const url of ["http://pay.example.com", "javascript:alert(1)", "//evil.com", "data:text/html,x", "/\\evil"]) {
      expect(resolvePostBooking("u1", "a1", { ok: true, data: { required: true, url } })).toEqual(success);
    }
  });

  it("allows same-origin relative checkout paths", () => {
    expect(isSafeCheckoutUrl("/pay/abc")).toBe(true);
    expect(isSafeCheckoutUrl("")).toBe(false);
    expect(isSafeCheckoutUrl(undefined)).toBe(false);
  });

  it("encodes ids in the success url", () => {
    expect(successHref("u 1", "a&1")).toBe(
      "/patients/u%201/new-appointment/success?appointmentId=a%261"
    );
  });
});

describe("formatMinorAmount", () => {
  it("honours the currency's decimals", () => {
    expect(formatMinorAmount(1250, "usd")).toBe("$12.50");
    expect(formatMinorAmount(500, "JPY")).toContain("500");
    expect(formatMinorAmount(1000, "inr")).toContain("10.00");
  });

  it("falls back for an invalid currency", () => {
    expect(formatMinorAmount(1250, "??")).toBe("12.50 ??");
  });
});
