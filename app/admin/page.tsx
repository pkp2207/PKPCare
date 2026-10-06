import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ErrorState } from "@/components/ErrorState";
import { StatCard } from "@/components/StatCard";
import { columns } from "@/components/table/columns";
import { DataTable } from "@/components/table/DataTable";
import {
  buildAdminHref,
  isStatus,
  StatusFilter,
} from "@/components/table/StatusFilter";
import { getRecentAppointmentList } from "@/lib/actions/appointment.actions";

const firstValue = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const AdminPage = async ({ searchParams }: SearchParamProps) => {
  const rawPage = Number.parseInt(firstValue(searchParams?.page) ?? "", 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const rawStatus = firstValue(searchParams?.status);
  const status = isStatus(rawStatus) ? rawStatus : undefined;

  const result = await getRecentAppointmentList({ page, status });

  if (!result.ok) {
    if (result.error === "Unauthorized") redirect("/?admin=true");

    return (
      <ErrorState
        title="Couldn't load appointments"
        message={result.error}
        href="/admin"
        linkLabel="Try again"
      />
    );
  }

  const appointments = result.data;

  // Stale/hand-edited ?page= past the end: send the user to the last page.
  if (appointments.totalPages > 0 && page > appointments.totalPages) {
    redirect(buildAdminHref({ page: appointments.totalPages, status }));
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col space-y-14">
      <header className="admin-header">
        <Link href="/" className="cursor-pointer" aria-label="PKPCare home">
          <Image
            src="/assets/icons/logo-full-pkp.png"
            height={32}
            width={162}
            alt="PKPCare"
            className="h-14 w-fit"
          />
        </Link>

        <p className="text-16-semibold">Admin Dashboard</p>
      </header>

      <main className="admin-main">
        <section className="w-full space-y-4">
          <h1 className="header">Welcome 👋</h1>
          <p className="text-dark-700">
            Start the day with managing new appointments
          </p>
        </section>

        <section className="admin-stat">
          <StatCard
            type="appointments"
            count={appointments.scheduledCount}
            label="Scheduled appointments"
            icon={"/assets/icons/appointments.svg"}
          />
          <StatCard
            type="pending"
            count={appointments.pendingCount}
            label="Pending appointments"
            icon={"/assets/icons/pending.svg"}
          />
          <StatCard
            type="cancelled"
            count={appointments.cancelledCount}
            label="Cancelled appointments"
            icon={"/assets/icons/cancelled.svg"}
          />
        </section>

        <StatusFilter
          active={status}
          counts={{
            all: appointments.totalCount,
            scheduled: appointments.scheduledCount,
            pending: appointments.pendingCount,
            cancelled: appointments.cancelledCount,
          }}
        />

        <DataTable
          columns={columns}
          data={appointments.documents}
          pagination={{
            page: appointments.page,
            pageSize: appointments.pageSize,
            totalPages: appointments.totalPages,
            totalCount: status
              ? {
                  scheduled: appointments.scheduledCount,
                  pending: appointments.pendingCount,
                  cancelled: appointments.cancelledCount,
                }[status]
              : appointments.totalCount,
            status,
          }}
        />
      </main>
    </div>
  );
};

export default AdminPage;
