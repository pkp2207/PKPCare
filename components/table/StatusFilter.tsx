import Link from "next/link";

import { cn } from "@/lib/utils";

export const STATUS_VALUES: readonly Status[] = [
  "scheduled",
  "pending",
  "cancelled",
];

/** Type guard for the `?status=` search param. */
export const isStatus = (value: unknown): value is Status =>
  typeof value === "string" &&
  (STATUS_VALUES as readonly string[]).includes(value);

/** Builds an /admin URL; page 1 and "all" are left out of the query string. */
export const buildAdminHref = ({
  page,
  status,
}: {
  page?: number;
  status?: Status;
}) => {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (page && page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/admin?${query}` : "/admin";
};

type StatusFilterProps = {
  active?: Status;
  counts?: Partial<Record<Status, number>> & { all?: number };
};

const FILTERS: { label: string; status?: Status }[] = [
  { label: "All" },
  { label: "Scheduled", status: "scheduled" },
  { label: "Pending", status: "pending" },
  { label: "Cancelled", status: "cancelled" },
];

export const StatusFilter = ({ active, counts }: StatusFilterProps) => {
  return (
    <nav aria-label="Filter appointments by status">
      <ul className="flex flex-wrap gap-2">
        {FILTERS.map(({ label, status }) => {
          const isActive = status === active;
          const count = status ? counts?.[status] : counts?.all;

          return (
            <li key={label}>
              <Link
                href={buildAdminHref({ status })}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "text-14-medium inline-flex items-center gap-2 rounded-full border px-4 py-2 transition-colors",
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
