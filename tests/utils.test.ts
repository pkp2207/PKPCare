import { describe, expect, it } from "vitest";

import { cn, formatDateTime, parseStringify } from "@/lib/utils";

describe("cn", () => {
  it("joins class names and drops falsy values", () => {
    expect(cn("a", false, null, undefined, "b")).toBe("a b");
  });

  it("supports conditional object syntax", () => {
    expect(cn("a", { b: true, c: false })).toBe("a b");
  });

  it("lets later tailwind classes override conflicting earlier ones", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
  });
});

describe("parseStringify", () => {
  it("deep clones plain data", () => {
    const input = { a: 1, nested: { b: [1, 2, 3] } };
    const output = parseStringify(input);
    expect(output).toEqual(input);
    expect(output).not.toBe(input);
    expect(output.nested).not.toBe(input.nested);
  });

  it("drops undefined and functions and serializes dates to strings", () => {
    const output = parseStringify({
      a: undefined,
      f: () => 1,
      d: new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(output).toEqual({ d: "2026-01-01T00:00:00.000Z" });
  });
});

describe("formatDateTime", () => {
  // Local-time constructor keeps assertions independent of the machine timezone.
  const date = new Date(2026, 2, 5, 14, 30);

  it("formats all parts", () => {
    const result = formatDateTime(date);
    expect(result.dateTime).toBe("Mar 5, 2026, 2:30 PM");
    expect(result.dateDay).toBe("Thu, 03/05/2026");
    expect(result.dateOnly).toBe("Mar 5, 2026");
    expect(result.timeOnly).toBe("2:30 PM");
  });

  it("formats morning times", () => {
    expect(formatDateTime(new Date(2026, 0, 15, 9, 5)).timeOnly).toBe("9:05 AM");
  });

  it("accepts ISO strings", () => {
    const result = formatDateTime("2026-03-05T12:00:00");
    expect(result.dateOnly).toBe("Mar 5, 2026");
    expect(result.timeOnly).toBe("12:00 PM");
  });

  it("returns Invalid Date strings for garbage input without throwing", () => {
    expect(formatDateTime("nope").dateOnly).toBe("Invalid Date");
  });
});
