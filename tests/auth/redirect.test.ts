import { describe, expect, it } from "vitest";

import { safeNextPath } from "@/lib/auth/redirect";

describe("safeNextPath", () => {
  it("keeps same-origin relative paths, query and hash", () => {
    expect(safeNextPath("/patients/abc/new-appointment")).toBe("/patients/abc/new-appointment");
    expect(safeNextPath("/admin?tab=1#x")).toBe("/admin?tab=1#x");
    expect(safeNextPath("/")).toBe("/");
  });

  it.each([
    "//evil.com",
    "///evil.com",
    "/\\evil.com",
    "\\\\evil.com",
    "/\\/evil.com",
    "https://evil.com",
    "http://evil.com/x",
    "javascript:alert(1)",
    "evil.com",
    "patients/abc",
    "/.//evil.com",
    "/a\nb",
    "/a\rb",
    "/a\u0000b",
    "/a\tb",
    "",
    " /admin",
  ])("rejects %j", (value) => {
    expect(safeNextPath(value, "/fallback")).toBe("/fallback");
  });

  it("falls back for non-strings and oversized values", () => {
    expect(safeNextPath(undefined, "/f")).toBe("/f");
    expect(safeNextPath(null, "/f")).toBe("/f");
    expect(safeNextPath("/" + "a".repeat(3000), "/f")).toBe("/f");
  });

  it("uses the first value of an array param", () => {
    expect(safeNextPath(["/admin", "//evil.com"], "/f")).toBe("/admin");
    expect(safeNextPath(["//evil.com", "/admin"], "/f")).toBe("/f");
  });

  it("defaults the fallback to /", () => {
    expect(safeNextPath("//evil.com")).toBe("/");
  });

  it("keeps percent-encoded slashes as plain path data", () => {
    expect(safeNextPath("/%2F%2Fevil.com")).toBe("/%2F%2Fevil.com");
  });
});
