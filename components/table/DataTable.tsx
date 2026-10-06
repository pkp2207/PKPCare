"use client";

import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import Image from "next/image";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { buildAdminHref } from "./StatusFilter";

export type ServerPagination = {
  page: number;
  pageSize: number;
  totalPages: number;
  totalCount: number;
  status?: Status;
};

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  pagination: ServerPagination;
}

/**
 * Presentational table: rows and paging come from the server, so there is no
 * client-side pagination model. Prev/next are plain links (shareable, back
 * button friendly) that preserve the active status filter.
 */
export function DataTable<TData, TValue>({
  columns,
  data,
  pagination,
}: DataTableProps<TData, TValue>) {
  const { page, pageSize, totalPages, totalCount, status } = pagination;

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    // Lets columns show the absolute row number across pages.
    meta: { rowOffset: (page - 1) * pageSize },
  });

  const lastPage = Math.max(1, totalPages);
  const hasPrevious = page > 1;
  const hasNext = page < lastPage;

  const previousIcon = (
    <Image
      src="/assets/icons/arrow.svg"
      width={24}
      height={24}
      alt=""
      aria-hidden="true"
    />
  );
  const nextIcon = (
    <Image
      src="/assets/icons/arrow.svg"
      width={24}
      height={24}
      alt=""
      aria-hidden="true"
      className="rotate-180"
    />
  );

  return (
    <div className="data-table">
      <Table className="shad-table">
        <TableHeader className=" bg-dark-200">
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id} className="shad-table-row-header">
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id}>
                  {header.isPlaceholder
                    ? null
                    : flexRender(
                        header.column.columnDef.header,
                        header.getContext()
                      )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows?.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                data-state={row.getIsSelected() && "selected"}
                className="shad-table-row"
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
              <TableCell colSpan={columns.length} className="h-24 text-center">
                No results.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <nav aria-label="Pagination" className="table-actions">
        {hasPrevious ? (
          <Button asChild variant="outline" size="sm" className="shad-gray-btn">
            <Link
              href={buildAdminHref({ page: page - 1, status })}
              aria-label="Previous page"
              rel="prev"
            >
              {previousIcon}
            </Link>
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled
            aria-label="Previous page"
            className="shad-gray-btn"
          >
            {previousIcon}
          </Button>
        )}

        <p className="text-14-regular text-dark-700" aria-live="polite">
          Page {page} of {lastPage}
          <span className="hidden sm:inline">
            {" "}
            &middot; {totalCount}{" "}
            {totalCount === 1 ? "appointment" : "appointments"}
          </span>
        </p>

        {hasNext ? (
          <Button asChild variant="outline" size="sm" className="shad-gray-btn">
            <Link
              href={buildAdminHref({ page: page + 1, status })}
              aria-label="Next page"
              rel="next"
            >
              {nextIcon}
            </Link>
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled
            aria-label="Next page"
            className="shad-gray-btn"
          >
            {nextIcon}
          </Button>
        )}
      </nav>
    </div>
  );
}
