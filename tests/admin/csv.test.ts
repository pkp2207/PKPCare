import { describe, expect, it } from "vitest";

import { csvCell, neutralizeFormula, toCsv } from "@/lib/admin/csv";

describe("csv", () => {
  it("prefixes formula triggers with a single quote", () => {
    for (const bad of ["=1+1", "+1", "-1", "@SUM(A1)", "\tx", "\rx"]) {
      expect(neutralizeFormula(bad)).toBe(`'${bad}`);
    }
    expect(neutralizeFormula("Maria")).toBe("Maria");
  });

  it("quotes commas, quotes and newlines", () => {
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });

  it("neutralises before quoting", () => {
    expect(csvCell('=HYPERLINK("x","y")')).toBe('"\'=HYPERLINK(""x"",""y"")"');
  });

  it("handles empty, numbers, booleans and dates", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell(true)).toBe("true");
    expect(csvCell(new Date("2026-01-02T03:04:05Z"))).toBe("2026-01-02T03:04:05.000Z");
  });

  it("builds CRLF rows with a header", () => {
    const csv = toCsv(
      [
        { header: "Name", value: (r: { n: string }) => r.n },
        { header: "N", value: () => 1 },
      ],
      [{ n: "=cmd" }, { n: "ok" }]
    );
    expect(csv).toBe("Name,N\r\n'=cmd,1\r\nok,1\r\n");
  });
});
