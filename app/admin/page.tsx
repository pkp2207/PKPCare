import { redirect } from "next/navigation";

import { AppointmentFiltersBar } from "@/components/admin/AppointmentFiltersBar";
import { AppointmentsView } from "@/components/admin/AppointmentsView";
import { AutoRefresh } from "@/components/admin/AutoRefresh";
import { homeForRole } from "@/components/admin/nav";
import { toAppointmentRow } from "@/components/admin/rows";
import { ErrorState } from "@/components/ErrorState";
import { StatCard } from "@/components/StatCard";
import { StatusFilter } from "@/components/table/StatusFilter";
import { searchAppointments } from "@/lib/actions/admin.actions";
import { listDoctors } from "@/lib/actions/doctor.actions";
import {
  buildAppointmentsHref,
  parseAppointmentFilters,
} from "@/lib/admin/filters";
import { requireStaffPage } from "@/lib/auth/guards";

const AdminPage = async ({ searchParams }: SearchParamProps) => {
  const session = await requireStaffPage();
  // Doctors work from their own schedule page.
  if (session.role === "doctor") redirect(homeForRole("doctor"));

  const filters = parseAppointmentFilters(searchParams);
  const [result, doctors] = await Promise.all([
    searchAppointments(filters),
    listDoctors(),
  ]);

  if (!result.ok) {
    if (result.error === "Unauthorized") redirect("/login/staff");

    return (
      <ErrorState
        title="Couldn't load appointments"
        message={result.error}
        href="/admin"
        linkLabel="Try again"
      />
    );
  }

  const data = result.data;

  // Stale/hand-edited ?page= past the end: send the user to the last page.
  if (data.totalPages > 0 && filters.page > data.totalPages) {
    redirect(buildAppointmentsHref(filters, { page: data.totalPages }));
  }

  const statusLink = (status: Status) =>
    buildAppointmentsHref({}, { status, sort: "created_desc", page: 1, pageSize: filters.pageSize });

  return (
    <>
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <h1 className="header">Appointments</h1>
          <p className="text-dark-700">
            Search, filter and manage appointments. Filters are part of the URL,
            so you can share a view.
          </p>
        </div>
        <AutoRefresh />
      </section>

      <section aria-label="Appointment counts" className="admin-stat">
        <StatCard
          type="appointments"
          count={data.scheduledCount}
          label="Scheduled appointments"
          icon="/assets/icons/appointments.svg"
          href={statusLink("scheduled")}
        />
        <StatCard
          type="pending"
          count={data.pendingCount}
          label="Pending appointments"
          icon="/assets/icons/pending.svg"
          href={statusLink("pending")}
        />
        <StatCard
          type="cancelled"
          count={data.cancelledCount}
          label="Cancelled appointments"
          icon="/assets/icons/cancelled.svg"
          href={statusLink("cancelled")}
        />
      </section>

      <StatusFilter
        filters={filters}
        counts={{
          all: data.totalCount,
          scheduled: data.scheduledCount,
          pending: data.pendingCount,
          cancelled: data.cancelledCount,
        }}
      />

      <AppointmentFiltersBar
        filters={filters}
        doctors={doctors.ok ? doctors.data.map((d) => ({ id: d.id, name: d.name })) : []}
      />

      {data.truncated && (
        <p role="status" className="text-14-regular text-blue-500">
          Text and visit-type search looks at the {data.scanCap} most recent
          matches of the other filters. Narrow the date range or status to
          search everything.
        </p>
      )}

      <AppointmentsView
        rows={data.documents.map(toAppointmentRow)}
        filters={filters}
        basePath="/admin"
        caption="Appointments"
        canExport={session.role === "admin" || session.role === "frontdesk"}
        pagination={{
          page: data.page,
          pageSize: data.pageSize,
          totalPages: data.totalPages,
          matchCount: data.matchCount,
        }}
      />
    </>
  );
};

export default AdminPage;
