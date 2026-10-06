import Link from "next/link";

import {
  type AppointmentFilters,
  APPOINTMENT_STATUSES,
  buildAppointmentsHref,
  isStatusValue,
} from "@/lib/admin/filters";
import { cn } from "@/lib/utils";

export const STATUS_VALUES: readonly Status[] = APPOINTMENT_STATUSES;

/** Type guard for the `?status=` search param. */
export const isStatus = isStatusValue;

type StatusFilterProps = {
  /** Current filters; the chips keep every other filter and reset paging. */
  filters: Partial<AppointmentFilters>;
  basePath?: string;
  counts?: Partial<Record<Status, number>> & { all?: number };
};

const FILTERS: { label: string; status?: Status }[] = [
  { label: "All" },
  { label: "Scheduled", status: "scheduled" },
  { label: "Pending", status: "pending" },
  { label: "Cancelled", status: "cancelled" },
];

export const StatusFilter = ({
  filters,
  basePath = "/admin",
  counts,
}: StatusFilterProps) => {
  return (
    <nav aria-label="Filter appointments by status">
      <ul className="flex flex-wrap gap-2">
        {FILTERS.map(({ label, status }) => {
          const isActive = status === filters.status;
          const count = status ? counts?.[status] : counts?.all;

          return (
            <li key={label}>
              <Link
                href={buildAppointmentsHref(
                  filters,
                  { status, page: 1 },
                  basePath
                )}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "text-14-medium inline-flex min-h-11 items-center gap-2 rounded-full border px-4 py-2 transition-colors",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-500",
                  isActive
                    ? "border-green-500 bg-dark-400 text-white"
                    : "border-dark-500 text-dark-700 hover:text-white"
                )}
              >
                {label}
                {count !== undefined && (
                  <span className="text-12-regular">({count})</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};
