import { describe, expect, it } from "vitest";

import { dominantTimeZone, doctorCapacity } from "@/lib/analytics/capacity";
import {
  type AnalyticsAppointment,
  cancellationRate,
  formatPercent,
  leadTimeDistribution,
  noShowProxy,
  peakHoursHeatmap,
  ratio,
  statusCounts,
  statusFunnel,
  utilizationPerDoctor,
} from "@/lib/analytics/metrics";
import { buildAnalyticsReport } from "@/lib/analytics/report";
import type { DoctorSchedule } from "@/lib/scheduling/schedule";

const NOW = new Date("2026-03-10T12:00:00Z");

const app = (
  status: Status,
  schedule: string,
  createdAt = "2026-03-01T00:00:00Z",
  doctorId: string | null = "d1"
): AnalyticsAppointment => ({ status, schedule, createdAt, doctorId });

describe("rates", () => {
  it("ratio handles zero", () => {
    expect(ratio(1, 0)).toBeNull();
    expect(ratio(1, 4)).toBe(0.25);
    expect(formatPercent(null)).toBe("n/a");
    expect(formatPercent(0.125)).toBe("12.5%");
  });

  it("cancellation rate and status counts", () => {
    const apps = [
      app("cancelled", "2026-03-11T10:00:00Z"),
      app("scheduled", "2026-03-12T10:00:00Z"),
      app("pending", "2026-03-13T10:00:00Z"),
      app("scheduled", "2026-03-14T10:00:00Z"),
    ];
    expect(cancellationRate(apps)).toEqual({ count: 1, of: 4, rate: 0.25 });
    expect(statusCounts(apps)).toEqual({ total: 4, pending: 1, scheduled: 2, cancelled: 1 });
    expect(cancellationRate([]).rate).toBeNull();
  });

  it("no-show proxy counts only past, unconfirmed, non-cancelled", () => {
    const apps = [
      app("pending", "2026-03-05T10:00:00Z"), // past, unconfirmed
      app("scheduled", "2026-03-06T10:00:00Z"), // past, confirmed
      app("cancelled", "2026-03-07T10:00:00Z"), // ignored
      app("pending", "2026-03-20T10:00:00Z"), // future, ignored
    ];
    expect(noShowProxy(apps, NOW)).toEqual({ count: 1, of: 2, rate: 0.5 });
  });
});

describe("lead time", () => {
  it("buckets by hours between creation and appointment", () => {
    const apps = [
      app("scheduled", "2026-03-01T10:00:00Z", "2026-03-01T06:00:00Z"), // 4h
      app("scheduled", "2026-03-03T06:00:00Z", "2026-03-01T06:00:00Z"), // 48h
      app("scheduled", "2026-03-20T06:00:00Z", "2026-03-01T06:00:00Z"), // 19d
      app("scheduled", "2026-04-20T06:00:00Z", "2026-03-01T06:00:00Z"), // 50d
      app("scheduled", "2026-02-20T06:00:00Z", "2026-03-01T06:00:00Z"), // negative -> 0h
      app("scheduled", "not-a-date"),
    ];
    const result = leadTimeDistribution(apps);
    const counts = Object.fromEntries(result.buckets.map((b) => [b.key, b.count]));
    expect(counts).toEqual({ lt1d: 2, "1to3d": 1, "3to7d": 0, "1to2w": 0, "2to4w": 1, gt4w: 1 });
    expect(result.considered).toBe(5);
    expect(result.medianHours).toBe(48);
  });

  it("empty input has no median", () => {
    expect(leadTimeDistribution([]).medianHours).toBeNull();
  });
});

describe("utilization", () => {
  it("counts non-cancelled bookings per doctor against capacity", () => {
    const { rows, unassigned } = utilizationPerDoctor(
      [
        { id: "d1", name: "B", capacity: 10 },
        { id: "d2", name: "A", capacity: 0 },
      ],
      [
        app("scheduled", "2026-03-11T10:00:00Z", undefined, "d1"),
        app("pending", "2026-03-11T11:00:00Z", undefined, "d1"),
        app("cancelled", "2026-03-11T12:00:00Z", undefined, "d1"),
        app("scheduled", "2026-03-11T13:00:00Z", undefined, null),
      ]
    );
    expect(rows.map((r) => r.name)).toEqual(["A", "B"]);
    expect(rows[1]).toMatchObject({ booked: 2, rate: 0.2 });
    expect(rows[0].rate).toBeNull();
    expect(unassigned).toBe(1);
  });

  it("computes capacity from weekly hours minus time off", () => {
    const schedule: DoctorSchedule = {
      id: "d1",
      slotMinutes: 60,
      timezone: "UTC",
      weeklyHours: { wed: [["09:00", "12:00"]] },
      timeOff: [{ start: "2026-03-11T10:00:00Z", end: "2026-03-11T11:00:00Z" }],
    };
    // Wed 2026-03-11: 3 one-hour slots, one removed by time off.
    expect(
      doctorCapacity(schedule, new Date("2026-03-11T00:00:00Z"), new Date("2026-03-12T00:00:00Z"))
    ).toBe(2);
  });
});

describe("heatmap", () => {
  it("buckets by weekday and hour in the given timezone, skipping cancelled", () => {
    // 2026-03-09 is a Monday.
    const apps = [
      app("scheduled", "2026-03-09T09:15:00Z"),
      app("pending", "2026-03-09T09:45:00Z"),
      app("cancelled", "2026-03-09T09:50:00Z"),
      app("scheduled", "2026-03-15T22:00:00Z"), // Sunday 22:00 UTC
    ];
    const utc = peakHoursHeatmap(apps, "UTC");
    expect(utc.matrix[0][9]).toBe(2);
    expect(utc.matrix[6][22]).toBe(1);
    expect(utc.max).toBe(2);
    expect(utc.total).toBe(3);

    const kolkata = peakHoursHeatmap(apps, "Asia/Kolkata"); // +5:30
    expect(kolkata.matrix[0][14]).toBe(1); // 09:15Z -> 14:45
    expect(kolkata.matrix[0][15]).toBe(1); // 09:45Z -> 15:15
  });
});

describe("funnel and report", () => {
  it("funnel stages", () => {
    const apps = [
      app("scheduled", "2026-03-05T10:00:00Z"),
      app("scheduled", "2026-03-20T10:00:00Z"),
      app("pending", "2026-03-21T10:00:00Z"),
      app("cancelled", "2026-03-22T10:00:00Z"),
    ];
    const funnel = statusFunnel(apps, NOW);
    expect(funnel.stages.map((s) => s.count)).toEqual([4, 2, 1]);
    expect(funnel.stages[1].share).toBe(0.5);
    expect(funnel.pending).toBe(1);
    expect(funnel.cancelled).toBe(1);
  });

  it("dominantTimeZone picks the most common, UTC when empty", () => {
    expect(dominantTimeZone(["Asia/Kolkata", "UTC", "Asia/Kolkata"])).toBe("Asia/Kolkata");
    expect(dominantTimeZone([])).toBe("UTC");
  });

  it("buildAnalyticsReport assembles everything and carries no identifying fields", () => {
    const report = buildAnalyticsReport({
      appointments: [app("scheduled", "2026-03-11T10:00:00Z")],
      doctors: [
        {
          name: "Dr A",
          schedule: { id: "d1", slotMinutes: 60, timezone: "UTC", weeklyHours: { wed: [["09:00", "12:00"]] }, timeOff: [] },
        },
      ],
      from: new Date("2026-03-11T00:00:00Z"),
      to: new Date("2026-03-12T00:00:00Z"),
      now: NOW,
      waitlist: { waiting: 2, offered: 1 },
      truncated: false,
      scanCap: 5000,
    });
    expect(report.counts.total).toBe(1);
    expect(report.utilization.rows[0]).toMatchObject({ booked: 1, capacity: 3 });
    expect(report.waitlist).toEqual({ waiting: 2, offered: 1 });
    expect(JSON.stringify(report)).not.toMatch(/patient|email|phone/i);
  });
});
