"use client";

import type { RowSelectionState } from "@tanstack/react-table";
import { useMemo, useState } from "react";

import { createAppointmentColumns } from "@/components/table/columns";
import { DataTable } from "@/components/table/DataTable";
import {
  type AppointmentFilters,
  buildAppointmentsHref,
} from "@/lib/admin/filters";

import { AppointmentDetailDrawer } from "./AppointmentDetailDrawer";
import { BulkActions } from "./BulkActions";
import { ExportCsvButton } from "./ExportCsvButton";
import type { AppointmentRow } from "./rows";

type Props = {
  rows: AppointmentRow[];
  filters: AppointmentFilters;
  basePath: string;
  caption: string;
  pagination: {
    page: number;
    pageSize: number;
    totalPages: number;
    matchCount: number;
  };
  canExport: boolean;
  emptyMessage?: string;
};

/** Table + selection + bulk actions + detail drawer for an appointment list. */
export function AppointmentsView({
  rows,
  filters,
  basePath,
  caption,
  pagination,
  canExport,
  emptyMessage,
}: Props) {
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [detail, setDetail] = useState<AppointmentRow | null>(null);

  const columns = useMemo(
    () => createAppointmentColumns({ filters, basePath, onOpenDetails: setDetail }),
    [filters, basePath]
  );

  // Only ids still on this page count (filters / paging change the row set).
  const selectedIds = rows.filter((row) => selection[row.id]).map((row) => row.id);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-[260px] flex-1">
          <BulkActions selectedIds={selectedIds} onDone={() => setSelection({})} />
        </div>
        {canExport && <ExportCsvButton filters={filters} />}
      </div>

      <DataTable
        columns={columns}
        data={rows}
        caption={caption}
        getRowId={(row) => row.id}
        rowSelection={selection}
        onRowSelectionChange={setSelection}
        emptyMessage={emptyMessage ?? "No appointments match these filters."}
        pagination={{
          page: pagination.page,
          pageSize: pagination.pageSize,
          totalPages: pagination.totalPages,
          totalCount: pagination.matchCount,
          noun: "appointment",
          hrefForPage: (page) => buildAppointmentsHref(filters, { page }, basePath),
        }}
      />

      <AppointmentDetailDrawer
        row={detail}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
      />
    </div>
  );
}
