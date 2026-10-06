import Link from "next/link";

import {
  type AppointmentFilters,
  hasActiveFilters,
} from "@/lib/admin/filters";

import { ui } from "./ui";

type DoctorOption = { id: string; name: string };

/**
 * Plain GET form: filters live in the URL (shareable, back-button friendly)
 * and work without client JS. Status is handled by the chips above it, so it
 * is carried as a hidden field.
 */
export function AppointmentFiltersBar({
  filters,
  doctors,
  basePath = "/admin",
  showDoctor = true,
}: {
  filters: AppointmentFilters;
  doctors: DoctorOption[];
  basePath?: string;
  showDoctor?: boolean;
}) {
  return (
    <form
      method="get"
      action={basePath}
      role="search"
      aria-label="Search and filter appointments"
      className={`${ui.card} grid gap-4 sm:grid-cols-2 lg:grid-cols-6`}
    >
      {filters.status && <input type="hidden" name="status" value={filters.status} />}
      {filters.sort !== "created_desc" && (
        <input type="hidden" name="sort" value={filters.sort} />
      )}

      <div className="space-y-1 lg:col-span-2">
        <label htmlFor="f-q" className={ui.label}>
          Search patient, doctor or reason
        </label>
        <input
          id="f-q"
          name="q"
          type="search"
          defaultValue={filters.q ?? ""}
          maxLength={100}
          className={ui.input}
          placeholder="e.g. Maria, Green, check-up"
        />
      </div>

      {showDoctor && (
        <div className="space-y-1">
          <label htmlFor="f-doctor" className={ui.label}>
            Doctor
          </label>
          <select
            id="f-doctor"
            name="doctorId"
            defaultValue={filters.doctorId ?? ""}
            className={ui.input}
          >
            <option value="">All doctors</option>
            {doctors.map((doctor) => (
              <option key={doctor.id} value={doctor.id}>
                {doctor.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="space-y-1">
        <label htmlFor="f-visit" className={ui.label}>
          Visit type
        </label>
        <select
          id="f-visit"
          name="visitType"
          defaultValue={filters.visitType ?? ""}
          className={ui.input}
        >
          <option value="">Any</option>
          <option value="in_person">In person</option>
          <option value="video">Video</option>
        </select>
      </div>

      <div className="space-y-1">
        <label htmlFor="f-from" className={ui.label}>
          From (UTC date)
        </label>
        <input id="f-from" name="from" type="date" defaultValue={filters.from ?? ""} className={ui.input} />
      </div>
      <div className="space-y-1">
        <label htmlFor="f-to" className={ui.label}>
          To (UTC date)
        </label>
        <input id="f-to" name="to" type="date" defaultValue={filters.to ?? ""} className={ui.input} />
      </div>

      <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-6">
        <button type="submit" className={ui.btnPrimary}>
          Apply filters
        </button>
        {hasActiveFilters(filters) && (
          <Link href={basePath} className={ui.btnSecondary}>
            Clear all
          </Link>
        )}
      </div>
    </form>
  );
}
