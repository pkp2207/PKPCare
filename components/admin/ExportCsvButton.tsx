"use client";

import { useState, useTransition } from "react";

import { exportAppointmentsCsv } from "@/lib/actions/admin.actions";
import type { AppointmentFilters } from "@/lib/admin/filters";

import { ui } from "./ui";

/** Exports with the current filters (not the page). Admin and front desk only. */
export function ExportCsvButton({ filters }: { filters: Partial<AppointmentFilters> }) {
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [pending, startTransition] = useTransition();

  const run = () =>
    startTransition(async () => {
      setMessage(null);
      const result = await exportAppointmentsCsv(filters);
      if (!result.ok) {
        setIsError(true);
        setMessage(result.error);
        return;
      }
      const { csv, filename, rowCount, truncated, cap } = result.data;
      // BOM so Excel reads UTF-8 names correctly.
      const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setIsError(false);
      setMessage(
        `Exported ${rowCount} row${rowCount === 1 ? "" : "s"}${truncated ? ` (limited to the first ${cap}; narrow the filters for the rest)` : ""}.`
      );
    });

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className={`${ui.btnSecondary} ${ui.btnSm}`}
      >
        {pending ? "Exporting..." : "Export CSV"}
      </button>
      <p
        role={isError ? "alert" : "status"}
        aria-live="polite"
        className={isError ? ui.error : ui.hint}
      >
        {message}
      </p>
    </div>
  );
}
