import Link from "next/link";

import { BarChart, HeatmapChart } from "@/components/admin/charts";
import { ui } from "@/components/admin/ui";
import { ErrorState } from "@/components/ErrorState";
import { getAnalytics } from "@/lib/actions/admin.actions";
import { listDoctors } from "@/lib/actions/doctor.actions";
import { parseDateParam } from "@/lib/admin/filters";
import { formatPercent } from "@/lib/analytics/metrics";
import type { AnalyticsReport } from "@/lib/analytics/report";
import { requireStaffPage } from "@/lib/auth/guards";

export const metadata = { title: "Analytics | PKPCare admin" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const isoDate = (offsetDays: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className={ui.card}>
      <p className="text-14-regular text-dark-700">{label}</p>
      <p className="text-32-bold mt-1">{value}</p>
      {hint && <p className={`${ui.hint} mt-1`}>{hint}</p>}
    </div>
  );
}

export default async function AnalyticsPage({ searchParams }: SearchParamProps) {
  await requireStaffPage("admin", "frontdesk");

  const from = parseDateParam(one(searchParams.from)) ?? isoDate(-29);
  const to = parseDateParam(one(searchParams.to)) ?? isoDate(0);
  const doctorId = one(searchParams.doctorId) || undefined;

  const [result, doctors] = await Promise.all([
    getAnalytics({ from, to, doctorId }),
    listDoctors(),
  ]);

  return (
    <>
      <section className="space-y-2">
        <h1 className="header">Analytics</h1>
        <p className="text-dark-700">
          Aggregated appointment statistics. No patient details are included.
          Dates are UTC days.
        </p>
      </section>

      <form method="get" action="/admin/analytics" role="search" aria-label="Analytics range" className={`${ui.card} grid gap-4 sm:grid-cols-4`}>
        <div className="space-y-1">
          <label htmlFor="an-from" className={ui.label}>From</label>
          <input id="an-from" name="from" type="date" defaultValue={from} className={ui.input} />
        </div>
        <div className="space-y-1">
          <label htmlFor="an-to" className={ui.label}>To</label>
          <input id="an-to" name="to" type="date" defaultValue={to} className={ui.input} />
        </div>
        <div className="space-y-1">
          <label htmlFor="an-doc" className={ui.label}>Doctor</label>
          <select id="an-doc" name="doctorId" defaultValue={doctorId ?? ""} className={ui.input}>
            <option value="">All doctors</option>
            {doctors.ok && doctors.data.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
        <div className="flex items-end gap-2">
          <button type="submit" className={ui.btnPrimary}>Update</button>
          <Link href="/admin/analytics" className={ui.btnSecondary}>Last 30 days</Link>
        </div>
      </form>

      {!result.ok ? (
        <ErrorState title="Couldn't load analytics" message={result.error} href="/admin/analytics" linkLabel="Reset" />
      ) : (
        <Report report={result.data} />
      )}
    </>
  );
}

function Report({ report }: { report: AnalyticsReport }) {
  const { counts, cancellation, noShowProxy, leadTime, utilization, heatmap, funnel, waitlist } = report;
  const median =
    leadTime.medianHours === null
      ? "n/a"
      : leadTime.medianHours < 48
        ? `${leadTime.medianHours.toFixed(0)} h`
        : `${(leadTime.medianHours / 24).toFixed(1)} days`;

  return (
    <>
      {report.truncated && (
        <p role="status" className="text-14-regular text-blue-500">
          Only the first {report.scanCap} appointments in this range were analysed,
          so figures are partial. Choose a shorter range or one doctor for complete numbers.
        </p>
      )}

      <section aria-label="Key figures" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Appointments analysed" value={String(counts.total)} hint={`${counts.scheduled} scheduled, ${counts.pending} pending, ${counts.cancelled} cancelled`} />
        <Kpi label="Cancellation rate" value={formatPercent(cancellation.rate)} hint={`${cancellation.count} of ${cancellation.of}`} />
        <Kpi label="No-show proxy" value={formatPercent(noShowProxy.rate)} hint={`${noShowProxy.count} of ${noShowProxy.of} past appointments never confirmed. Attendance is not recorded, so true no-shows cannot be measured.`} />
        <Kpi label="Waitlist now" value={String(waitlist.waiting)} hint={`${waitlist.offered} offered a slot`} />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <BarChart
          title="Status funnel"
          valueHeader="Appointments"
          data={[
            ...funnel.stages.map((s) => ({
              label: s.label,
              value: s.count,
              display: `${s.count} (${formatPercent(s.share, 0)})`,
            })),
            { label: "Still pending", value: funnel.pending },
            { label: "Cancelled", value: funnel.cancelled },
          ]}
          max={Math.max(1, counts.total)}
        />
        <BarChart
          title={`Booking lead time (median ${median})`}
          valueHeader="Appointments"
          data={leadTime.buckets.map((b) => ({ label: b.label, value: b.count }))}
        />
      </section>

      <BarChart
        title="Utilization per doctor (booked slots / available slots)"
        valueHeader="Booked / available"
        max={1}
        data={utilization.rows.map((r) => ({
          label: r.name,
          value: r.rate ?? 0,
          display: r.rate === null ? "no hours" : `${formatPercent(r.rate, 0)} (${r.booked}/${r.capacity})`,
        }))}
      />
      {utilization.unassigned > 0 && (
        <p className={ui.hint}>
          {utilization.unassigned} appointment(s) could not be matched to a doctor profile and are excluded above.
        </p>
      )}

      <HeatmapChart title="Peak hours" heatmap={heatmap} />
    </>
  );
}
