import { describe, expect, it } from "vitest";

import { buildSearchBundle, MAX_COUNT, parsePaging } from "@/lib/fhir/bundle";
import {
  isSupportedFormat,
  parseDateParam,
  parseDateRange,
  parseReferenceId,
  unsupportedParams,
  wantsSensitive,
} from "@/lib/fhir/search-params";

const params = (q: string) => new URLSearchParams(q);

describe("parsePaging", () => {
  it("defaults", () => {
    expect(parsePaging(params(""))).toEqual({ ok: true, paging: { count: 20, offset: 0 } });
  });

  it("clamps _count to 50", () => {
    expect(parsePaging(params("_count=500"))).toEqual({
      ok: true,
      paging: { count: MAX_COUNT, offset: 0 },
    });
  });

  it.each(["_count=0", "_count=-1", "_count=abc", "_offset=-1", "_offset=1.5", "_offset=99999"])(
    "rejects %s",
    (q) => {
      expect(parsePaging(params(q)).ok).toBe(false);
    },
  );
});

describe("buildSearchBundle", () => {
  const resource = (id: string) => ({ resourceType: "Patient", id });
  const base = "https://x.test/api/fhir";

  it("first page: self + next, total and fullUrl", () => {
    const bundle = buildSearchBundle({
      baseUrl: base,
      path: "Patient",
      params: params("email=a%40b.c"),
      paging: { count: 2, offset: 0 },
      resources: [resource("1"), resource("2")],
      total: 5,
    });
    expect(bundle.resourceType).toBe("Bundle");
    expect(bundle.type).toBe("searchset");
    expect(bundle.total).toBe(5);
    expect(bundle.link).toEqual([
      { relation: "self", url: `${base}/Patient?email=a%40b.c&_count=2&_offset=0` },
      { relation: "next", url: `${base}/Patient?email=a%40b.c&_count=2&_offset=2` },
    ]);
    expect(bundle.entry[0]).toEqual({
      fullUrl: `${base}/Patient/1`,
      resource: resource("1"),
      search: { mode: "match" },
    });
  });

  it("middle page has previous and next", () => {
    const bundle = buildSearchBundle({
      baseUrl: base,
      path: "Patient",
      params: params("_count=2&_offset=2"),
      paging: { count: 2, offset: 2 },
      resources: [resource("3"), resource("4")],
      total: 6,
    });
    expect(bundle.link.map((l) => l.relation)).toEqual(["self", "previous", "next"]);
    expect(bundle.link[1].url).toBe(`${base}/Patient?_count=2&_offset=0`);
    expect(bundle.link[2].url).toBe(`${base}/Patient?_count=2&_offset=4`);
  });

  it("last page has no next; empty result is total 0", () => {
    const last = buildSearchBundle({
      baseUrl: base,
      path: "Patient",
      params: params(""),
      paging: { count: 2, offset: 4 },
      resources: [resource("5")],
      total: 5,
    });
    expect(last.link.map((l) => l.relation)).toEqual(["self", "previous"]);

    const empty = buildSearchBundle({
      baseUrl: base,
      path: "Patient",
      params: params(""),
      paging: { count: 20, offset: 0 },
      resources: [],
      total: 0,
    });
    expect(empty.total).toBe(0);
    expect(empty.entry).toEqual([]);
    expect(empty.link.map((l) => l.relation)).toEqual(["self"]);
  });
});

describe("search params", () => {
  it("parses references", () => {
    expect(parseReferenceId("Patient/abc", "Patient")).toBe("abc");
    expect(parseReferenceId("abc", "Patient")).toBe("abc");
    expect(parseReferenceId("Practitioner/abc", "Patient")).toBeNull();
    expect(parseReferenceId("../etc", "Patient")).toBeNull();
    expect(parseReferenceId(null, "Patient")).toBeNull();
  });

  it("lists unsupported param names only", () => {
    expect(
      unsupportedParams(params("email=x&foo=1&_count=2&_include=sensitive"), ["email"]),
    ).toEqual(["foo"]);
  });

  it("accepts only JSON formats", () => {
    expect(isSupportedFormat(params(""))).toBe(true);
    expect(isSupportedFormat(params("_format=application/fhir%2Bjson"))).toBe(true);
    expect(isSupportedFormat(params("_format=xml"))).toBe(false);
  });

  it("_include only accepts sensitive", () => {
    expect(wantsSensitive(params(""))).toEqual({ ok: true, sensitive: false });
    expect(wantsSensitive(params("_include=sensitive"))).toEqual({ ok: true, sensitive: true });
    expect(wantsSensitive(params("_include=Patient:x")).ok).toBe(false);
  });

  it("parses date precision", () => {
    expect(parseDateParam("2026-10-08")).toEqual({
      prefix: "eq",
      from: Date.UTC(2026, 9, 8),
      to: Date.UTC(2026, 9, 9),
    });
    expect(parseDateParam("ge2026-10")).toEqual({
      prefix: "ge",
      from: Date.UTC(2026, 9, 1),
      to: Date.UTC(2026, 10, 1),
    });
    expect(parseDateParam("lt2026-10-08T10:00:00Z")?.from).toBe(Date.UTC(2026, 9, 8, 10));
    expect(parseDateParam("2026-10-08T10:00:00 05:30")?.from).toBe(
      Date.parse("2026-10-08T10:00:00+05:30"),
    );
    expect(parseDateParam("2026-02-31")).toBeNull();
    expect(parseDateParam("garbage")).toBeNull();
    expect(parseDateParam("xx2026-01-01")).toBeNull();
  });

  it("combines prefixes into a half-open range", () => {
    expect(parseDateRange(["ge2026-10-01", "lt2026-10-08"])).toEqual({
      gte: Date.UTC(2026, 9, 1),
      lt: Date.UTC(2026, 9, 8),
    });
    expect(parseDateRange(["2026-10-08"])).toEqual({
      gte: Date.UTC(2026, 9, 8),
      lt: Date.UTC(2026, 9, 9),
    });
    expect(parseDateRange(["gt2026-10-08", "le2026-10-10"])).toEqual({
      gte: Date.UTC(2026, 9, 9),
      lt: Date.UTC(2026, 9, 11),
    });
    expect(parseDateRange(["nope"])).toBeNull();
    expect(parseDateRange([])).toEqual({});
  });
});
