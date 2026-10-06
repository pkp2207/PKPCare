// Assembles the analytics report from already-fetched facts (pure).
import type { DoctorSchedule } from "@/lib/scheduling/schedule";

import { doctorCapacity, dominantTimeZone } from "./capacity";
import {
  type AnalyticsAppointment,
  cancellationRate,
  type DoctorUtilization,
  type Heatmap,
  type LeadTimeDistribution,
  leadTimeDistribution,
  noShowProxy,
  peakHoursHeatmap,
  type RateResult,
  statusCounts,
  type StatusCounts,
  statusFunnel,
  type StatusFunnel,
  utilizationPerDoctor,
} from "./metrics";

export type AnalyticsDoctorInput = { name: string; schedule: DoctorSchedule };

export type AnalyticsReport = {
  range: { from: string; to: string };
  generatedAt: string;
  scanned: number;
  /** True when more matching appointments exist than the scan cap allowed. */
  truncated: boolean;
  scanCap: number;
  counts: StatusCounts;
  cancellation: RateResult;
  noShowProxy: RateResult;
  leadTime: LeadTimeDistribution;
  utilization: { rows: DoctorUtilization[]; unassigned: number };
  heatmap: Heatmap;
  funnel: StatusFunnel;
  waitlist: { waiting: number; offered: number };
};

export const buildAnalyticsReport = ({
  appointments,
  doctors,
  from,
  to,
  now,
  waitlist,
  truncated,
  scanCap,
}: {
  appointments: readonly AnalyticsAppointment[];
  doctors: readonly AnalyticsDoctorInput[];
  from: Date;
  to: Date;
  now: Date;
  waitlist: { waiting: number; offered: number };
  truncated: boolean;
  scanCap: number;
}): AnalyticsReport => {
  const capacities = doctors.map(({ name, schedule }) => ({
    id: schedule.id,
    name,
    capacity: doctorCapacity(schedule, from, to),
  }));
  const timeZone = dominantTimeZone(doctors.map((d) => d.schedule.timezone));

  return {
    range: { from: from.toISOString(), to: to.toISOString() },
    generatedAt: now.toISOString(),
    scanned: appointments.length,
    truncated,
    scanCap,
    counts: statusCounts(appointments),
    cancellation: cancellationRate(appointments),
    noShowProxy: noShowProxy(appointments, now),
    leadTime: leadTimeDistribution(appointments),
    utilization: utilizationPerDoctor(capacities, appointments),
    heatmap: peakHoursHeatmap(appointments, timeZone),
    funnel: statusFunnel(appointments, now),
    waitlist,
  };
};
