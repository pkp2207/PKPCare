"use client";

import type { ColumnDef } from "@tanstack/react-table";
import Image from "next/image";
import Link from "next/link";

import { LocalTime } from "@/components/admin/LocalTime";
import type { AppointmentRow } from "@/components/admin/rows";
import { rowToFormAppointment } from "@/components/admin/rows";
import { ui } from "@/components/admin/ui";
import { Doctors } from "@/constants";
import {
  ariaSortForSort,
  type AppointmentFilters,
  buildAppointmentsHref,
  nextScheduleSort,
} from "@/lib/admin/filters";
import { cn } from "@/lib/utils";

import { AppointmentModal } from "../AppointmentModal";
import { StatusBadge } from "../StatusBadge";

import type { ColumnAriaMeta } from "./DataTable";

type ColumnOptions = {
  filters: Partial<AppointmentFilters>;
  basePath?: string;
  onOpenDetails: (row: AppointmentRow) => void;
};

export const createAppointmentColumns = ({
  filters,
  basePath = "/admin",
  onOpenDetails,
}: ColumnOptions): ColumnDef<AppointmentRow>[] => [
  {
    id: "index",
    header: "#",
    cell: ({ row, table }) => {
      // DataTable supplies the page offset so numbering continues across pages.
      const { rowOffset = 0 } = (table.options.meta ?? {}) as {
        rowOffset?: number;
      };
      return <span className="text-14-medium">{rowOffset + row.index + 1}</span>;
    },
  },
  {
    id: "patient",
    header: "Patient",
    cell: ({ row }) => (
      <span className="text-14-medium">{row.original.patientName}</span>
    ),
  },
  {
    id: "status",
    header: "Status",
    cell: ({ row }) => (
      <div className="min-w-[115px]">
        <StatusBadge status={row.original.status} />
      </div>
    ),
  },
  {
    id: "schedule",
    meta: { ariaSort: ariaSortForSort(filters.sort) } satisfies ColumnAriaMeta,
    header: () => {
      const next = nextScheduleSort(filters.sort);
      const arrow =
        filters.sort === "schedule_asc"
          ? "↑"
          : filters.sort === "schedule_desc"
            ? "↓"
            : "↕";
      return (
        <Link
          href={buildAppointmentsHref(filters, { sort: next, page: 1 }, basePath)}
          className={cn(
            "inline-flex min-h-11 items-center gap-1 rounded text-dark-700 hover:text-white",
            ui.focus
          )}
          title={
            next === "schedule_asc"
              ? "Sort by date, earliest first"
              : next === "schedule_desc"
                ? "Sort by date, latest first"
                : "Remove date sorting"
          }
        >
          Appointment
          <span aria-hidden="true">{arrow}</span>
        </Link>
      );
    },
    cell: ({ row }) => (
      <LocalTime
        iso={row.original.schedule}
        className="text-14-regular inline-block min-w-[100px]"
      />
    ),
  },
  {
    id: "doctor",
    header: "Doctor",
    cell: ({ row }) => {
      const appointment = row.original;
      const doctor = Doctors.find(
        (candidate) => candidate.name === appointment.physician
      );

      return (
        <div className="flex items-center gap-3">
          <Image
            src={doctor?.image ?? "/assets/images/dr-green.png"}
            alt=""
            aria-hidden="true"
            width={100}
            height={100}
            className="size-8"
          />
          <div>
            <p className="whitespace-nowrap">Dr. {appointment.physician}</p>
            {appointment.visitType === "video" && (
              <p className="text-12-regular text-blue-500">Video visit</p>
            )}
          </div>
        </div>
      );
    },
  },
  {
    id: "actions",
    header: () => <div className="pl-4">Actions</div>,
    cell: ({ row }) => {
      const appointment = row.original;
      const form = rowToFormAppointment(appointment);

      return (
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => onOpenDetails(appointment)}
            className={cn(ui.btnGhost, ui.btnSm, "text-blue-500")}
            aria-label={`Details for ${appointment.patientName}`}
          >
            Details
          </button>
          {/* Without a linked patient there is nothing to schedule or cancel for. */}
          {appointment.patientId && (
            <>
              <AppointmentModal
                patientId={appointment.patientId}
                userId={appointment.userId}
                appointment={form}
                patientName={appointment.patientName}
                type="schedule"
              />
              <AppointmentModal
                patientId={appointment.patientId}
                userId={appointment.userId}
                appointment={form}
                patientName={appointment.patientName}
                type="cancel"
              />
            </>
          )}
        </div>
      );
    },
  },
];
