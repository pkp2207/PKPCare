"use client";

import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  type OnChangeFn,
  type RowSelectionState,
  useReactTable,
} from "@tanstack/react-table";
import Link from "next/link";
import { useEffect, useRef } from "react";

import { ui } from "@/components/admin/ui";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export type ServerPagination = {
  page: number;
  pageSize: number;
  totalPages: number;
  totalCount: number;
  /** Singular noun for the count label, e.g. "appointment". */
  noun?: string;
  /** Builds the URL of another page (prev/next are plain links). */
  hrefForPage: (page: number) => string;
};

/** Read by DataTable from `columnDef.meta` to set `aria-sort` on the header cell. */
export type ColumnAriaMeta = {
  ariaSort?: "ascending" | "descending" | "none";
};

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  /** Accessible name of the table (visually hidden caption). */
  caption: string;
  pagination: ServerPagination;
  getRowId?: (row: TData, index: number) => string;
  /** Enables the checkbox column when provided together with the change handler. */
  rowSelection?: RowSelectionState;
  onRowSelectionChange?: OnChangeFn<RowSelectionState>;
  emptyMessage?: string;
}

const checkboxClass =
  "size-4 cursor-pointer accent-green-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-500";

/**
 * Presentational, server-paginated table. Rows and paging come from the
 * server (shareable URLs). Semantics: visually hidden caption, `scope="col"`
 * headers with `aria-sort`, optional row-selection column with labelled
 * checkboxes, horizontal scroll on narrow screens.
 */
export function DataTable<TData, TValue>({
  columns,
  data,
  caption,
  pagination,
  getRowId,
  rowSelection,
  onRowSelectionChange,
  emptyMessage = "No results.",
}: DataTableProps<TData, TValue>) {
  const { page, pageSize, totalPages, totalCount, noun = "row", hrefForPage } =
    pagination;
  const selectable = Boolean(rowSelection && onRowSelectionChange);

  const selectColumn: ColumnDef<TData, TValue> = {
    id: "select",
    header: ({ table }) => (
      <SelectAllCheckbox
        checked={table.getIsAllPageRowsSelected()}
        indeterminate={table.getIsSomePageRowsSelected()}
        onChange={(value) => table.toggleAllPageRowsSelected(value)}
      />
    ),
    cell: ({ row }) => (
      <input
        type="checkbox"
        className={checkboxClass}
        checked={row.getIsSelected()}
        onChange={(event) => row.toggleSelected(event.target.checked)}
        aria-label={`Select row ${row.index + 1 + (page - 1) * pageSize}`}
      />
    ),
  };

  const table = useReactTable({
    data,
    columns: selectable ? [selectColumn, ...columns] : columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId,
    enableRowSelection: selectable,
    state: { rowSelection: rowSelection ?? {} },
    onRowSelectionChange,
    // Lets columns show the absolute row number across pages.
    meta: { rowOffset: (page - 1) * pageSize },
  });

  const lastPage = Math.max(1, totalPages);
  const hasPrevious = page > 1;
  const hasNext = page < lastPage;
  const colCount = columns.length + (selectable ? 1 : 0);

  return (
    <div className="data-table">
      <Table className="shad-table min-w-[720px]">
        <caption className="sr-only">{caption}</caption>
        <TableHeader className="bg-dark-200">
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id} className="shad-table-row-header">
              {headerGroup.headers.map((header) => {
                const meta = header.column.columnDef.meta as
                  | ColumnAriaMeta
                  | undefined;
                return (
                  <TableHead
                    key={header.id}
                    scope="col"
                    aria-sort={meta?.ariaSort}
                    className="text-dark-700"
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows?.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                data-state={row.getIsSelected() ? "selected" : undefined}
                className={cn(
                  "shad-table-row",
                  row.getIsSelected() && "bg-dark-500/30"
                )}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell
                colSpan={colCount}
                className="h-24 text-center text-dark-700"
              >
                {emptyMessage}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <nav aria-label="Pagination" className="table-actions">
        <PageLink
          href={hasPrevious ? hrefForPage(page - 1) : null}
          label="Previous page"
          rel="prev"
        >
          <span aria-hidden="true">&larr;</span>
        </PageLink>

        <p className="text-14-regular text-dark-700" aria-live="polite">
          Page {page} of {lastPage}
          <span className="hidden sm:inline">
            {" "}
            &middot; {totalCount} {totalCount === 1 ? noun : `${noun}s`}
          </span>
        </p>

        <PageLink
          href={hasNext ? hrefForPage(page + 1) : null}
          label="Next page"
          rel="next"
        >
          <span aria-hidden="true">&rarr;</span>
        </PageLink>
      </nav>
    </div>
  );
}

function PageLink({
  href,
  label,
  rel,
  children,
}: {
  href: string | null;
  label: string;
  rel: "prev" | "next";
  children: React.ReactNode;
}) {
  const className = cn(ui.btnSecondary, ui.btnSm, "min-w-11");
  if (!href) {
    return (
      <button type="button" disabled aria-label={label} className={className}>
        {children}
      </button>
    );
  }
  return (
    <Link href={href} aria-label={label} rel={rel} className={className}>
      {children}
    </Link>
  );
}

function SelectAllCheckbox({
  checked,
  indeterminate,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: (value: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate && !checked;
  }, [indeterminate, checked]);

  return (
    <input
      ref={ref}
      type="checkbox"
      className={checkboxClass}
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
      aria-label="Select all rows on this page"
    />
  );
}
