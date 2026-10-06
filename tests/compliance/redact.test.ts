import { describe, expect, it } from "vitest";

import { redactForLogs, safeLogLine } from "@/lib/compliance/redact";

describe("redactForLogs", () => {
  it("masks emails", () => {
    expect(redactForLogs("contact jane.doe+x@example.co.in now")).toBe(
      "contact [email] now",
    );
  });

  it("masks phone numbers in common formats", () => {
    expect(redactForLogs("call +91 98765 43210")).toBe("call [number]");
    expect(redactForLogs("call (415) 555-2671 please")).toBe(
      "call [number] please",
    );
    expect(redactForLogs("+14155552671")).toBe("[number]");
  });

  it("masks long digit strings but keeps short numbers and dates", () => {
    expect(redactForLogs("aadhaar 123456789012")).toBe("aadhaar [number]");
    expect(redactForLogs("page 12 of 40")).toBe("page 12 of 40");
    expect(redactForLogs("2026-10-06")).toBe("2026-10-06");
  });

  it("masks JWTs and bearer tokens", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl";
    expect(redactForLogs(`t=${jwt}`)).toBe("t=[token]");
    expect(redactForLogs("Authorization: Bearer abcdefgh12345")).toContain(
      "Bearer [token]",
    );
  });

  it("redacts nested objects and sensitive keys without mutating input", () => {
    const input = {
      action: "x",
      email: "a@b.com",
      nested: { list: ["call 9876543210"], password: "hunter2" },
    };
    const out = redactForLogs(input) as any;
    expect(out.email).toBe("[REDACTED]");
    expect(out.nested.password).toBe("[REDACTED]");
    expect(out.nested.list[0]).toBe("call [number]");
    expect(out.action).toBe("x");
    expect(input.email).toBe("a@b.com");
  });

  it("handles errors, circular refs, nullish and odd values", () => {
    const circular: any = { a: 1 };
    circular.self = circular;
    expect((redactForLogs(circular) as any).self).toBe("[circular]");
    expect(redactForLogs(new Error("boom for a@b.com"))).toBe(
      "Error: boom for [email]",
    );
    expect(redactForLogs(null)).toBeNull();
    expect(redactForLogs(undefined)).toBeUndefined();
    expect(redactForLogs(42)).toBe(42);
  });

  it("safeLogLine is single-line and bounded", () => {
    const line = safeLogLine("a@b.com\nnext\tline " + "x".repeat(500), 50);
    expect(line).not.toMatch(/[\r\n\t]/);
    expect(line.length).toBeLessThanOrEqual(50);
    expect(line).not.toContain("a@b.com");
  });
});
