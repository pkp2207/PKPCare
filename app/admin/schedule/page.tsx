import { AppointmentsView } from "@/components/admin/AppointmentsView";
import { AutoRefresh } from "@/components/admin/AutoRefresh";
import { toAppointmentRow } from "@/components/admin/rows";
import { ScheduleEditor } from "@/components/admin/ScheduleEditor";
import { ErrorState } from "@/components/ErrorState";
import { getOwnDoctor, searchAppointments } from "@/lib/actions/admin.actions";
import { normalizeAppointmentFilters } from "@/lib/admin/filters";
import { requireStaffPage } from "@/lib/auth/guards";

export const metadata = { title: "My schedule | PKPCare admin" };

const dayStart = (offsetDays: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

export default async function SchedulePage({ searchParams }: SearchParamProps) {
  const session = await requireStaffPage();
  const isDoctor = session.role === "doctor";

  // Upcoming appointments: today (UTC date) onward, soonest first. Doctor
  // scoping is enforced inside searchAppointments.
  const filters = normalizeAppointmentFilters({
    ...searchParams,
    from: dayStart(0),
    to: undefined,
    sort: "schedule_asc",
    pageSize: 25,
  });
  const [list, own] = await Promise.all([
    searchAppointments(filters),
    isDoctor ? getOwnDoctor() : Promise.resolve(null),
  ]);

  if (!list.ok) {
    return (
      <ErrorState
        title="Couldn't load your schedule"
        message={list.error}
        href="/admin/schedule"
        linkLabel="Try again"
      />
    );
  }

  const today = dayStart(0);
  const rows = list.data.documents.map(toAppointmentRow);
  const todays = rows.filter((row) => row.schedule.slice(0, 10) === today);

  return (
    <>
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <h1 className="header">My schedule</h1>
          <p className="text-dark-700">
            {todays.length} appointment{todays.length === 1 ? "" : "s"} today
            (UTC date); upcoming appointments below.
          </p>
        </div>
        <AutoRefresh />
      </section>

      {isDoctor && own && own.ok && own.data === null && (
        <p role="status" className="text-14-regular text-blue-500">
          Your login is not linked to a doctor profile yet, so no appointments
          or hours are shown. Ask an admin to link it on the Doctors page.
        </p>
      )}

      <AppointmentsView
        rows={rows}
        filters={filters}
        basePath="/admin/schedule"
        caption="Upcoming appointments"
        canExport={false}
        emptyMessage="No upcoming appointments."
        pagination={{
          page: list.data.page,
          pageSize: list.data.pageSize,
          totalPages: list.data.totalPages,
          matchCount: list.data.matchCount,
        }}
      />

      {isDoctor && own && own.ok && own.data && <ScheduleEditor doctor={own.data} />}
      {isDoctor && own && !own.ok && (
        <p role="alert" className="text-red-400">{own.error}</p>
      )}
    </>
  );
}
