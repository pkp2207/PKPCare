import { describe, expect, it } from "vitest";

import {
  ariaSortForSort,
  buildAppointmentsHref,
  dateRangeBounds,
  hasActiveFilters,
  matchesQuery,
  nextScheduleSort,
  normalizeAppointmentFilters,
  parseAppointmentFilters,
  parseDateParam,
} from "@/lib/admin/filters";

describe("parseAppointmentFilters", () => {
  it("returns defaults for empty input", () => {
    expect(parseAppointmentFilters({})).toEqual({
      sort: "created_desc",
      page: 1,
      pageSize: 25,
    });
  });

  it("parses valid params and takes the first of arrays", () => {
    const f = parseAppointmentFilters({
      q: ["  Maria   Lopez ", "x"],
      status: "pending",
      doctorId: "doc_1",
      visitType: "video",
      from: "2026-03-01",
      to: "2026-03-31",
      sort: "schedule_asc",
      page: "3",
      pageSize: "10",
    });
    expect(f).toMatchObject({
      q: "Maria Lopez",
      status: "pending",
      doctorId: "doc_1",
      visitType: "video",
      from: "2026-03-01",
      to: "2026-03-31",
      sort: "schedule_asc",
      page: 3,
      pageSize: 10,
    });
  });

  it("drops invalid values instead of throwing", () => {
    const f = normalizeAppointmentFilters({
      status: "bogus",
      doctorId: "../x",
      visitType: "phone",
      from: "2026-02-31",
      sort: "name",
      page: "-4",
      pageSize: "9999",
    });
    expect(f.status).toBeUndefined();
    expect(f.doctorId).toBeUndefined();
    expect(f.visitType).toBeUndefined();
    expect(f.from).toBeUndefined();
    expect(f.sort).toBe("created_desc");
    expect(f.page).toBe(1);
    expect(f.pageSize).toBe(50);
  });

  it("swaps a reversed date range and caps q length", () => {
    const f = normalizeAppointmentFilters({
      from: "2026-05-10",
      to: "2026-05-01",
      q: "a".repeat(500),
    });
    expect(f.from).toBe("2026-05-01");
    expect(f.to).toBe("2026-05-10");
    expect(f.q).toHaveLength(100);
  });
});

describe("dates and hrefs", () => {
  it("parseDateParam is strict", () => {
    expect(parseDateParam("2026-02-28")).toBe("2026-02-28");
    expect(parseDateParam("2026-2-8")).toBeUndefined();
    expect(parseDateParam("2026-13-01")).toBeUndefined();
  });

  it("dateRangeBounds is [from, to+1d) in UTC", () => {
    expect(dateRangeBounds({ from: "2026-03-01", to: "2026-03-01" })).toEqual({
      fromIso: "2026-03-01T00:00:00.000Z",
      toIso: "2026-03-02T00:00:00.000Z",
    });
    expect(dateRangeBounds({})).toEqual({});
  });

  it("buildAppointmentsHref omits defaults and round-trips", () => {
    expect(buildAppointmentsHref({ sort: "created_desc", page: 1, pageSize: 25 })).toBe("/admin");
    const f = normalizeAppointmentFilters({ q: "lee", status: "pending", sort: "schedule_desc", page: "2" });
    const href = buildAppointmentsHref(f, {}, "/admin");
    const params = Object.fromEntries(new URL(href, "http://x").searchParams);
    expect(normalizeAppointmentFilters(params)).toEqual(f);
    expect(buildAppointmentsHref(f, { status: undefined, page: 1 })).not.toContain("status");
  });

  it("hasActiveFilters ignores sort and paging", () => {
    expect(hasActiveFilters({ sort: "schedule_asc", page: 4 })).toBe(false);
    expect(hasActiveFilters({ q: "x" })).toBe(true);
  });
});

describe("sorting helpers", () => {
  it("cycles asc -> desc -> default", () => {
    expect(nextScheduleSort("created_desc")).toBe("schedule_asc");
    expect(nextScheduleSort("schedule_asc")).toBe("schedule_desc");
    expect(nextScheduleSort("schedule_desc")).toBe("created_desc");
  });
  it("maps to aria-sort", () => {
    expect(ariaSortForSort("schedule_asc")).toBe("ascending");
    expect(ariaSortForSort("schedule_desc")).toBe("descending");
    expect(ariaSortForSort("created_desc")).toBe("none");
  });
});

describe("matchesQuery", () => {
  const row = { patientName: "Maria Lopez", primaryPhysician: "John Green", reason: "Annual check-up" };
  it("matches any field, case-insensitively, all tokens", () => {
    expect(matchesQuery(row, "maria")).toBe(true);
    expect(matchesQuery(row, "green CHECK")).toBe(true);
    expect(matchesQuery(row, "maria dentist")).toBe(false);
  });
  it("empty query matches everything", () => {
    expect(matchesQuery(row, undefined)).toBe(true);
    expect(matchesQuery({}, "x")).toBe(false);
  });
});
