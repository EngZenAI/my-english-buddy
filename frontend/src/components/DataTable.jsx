import { useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowUpDown, ChevronLeft, ChevronRight, Search } from "lucide-react";

import { EmptyState, LoadingSpinner } from "./AsyncState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export function SortableHeader({ column, children, align = "left" }) {
  return (
    <button
      type="button"
      onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      className={cn(
        "inline-flex items-center gap-1 font-bold",
        align === "right" && "justify-end"
      )}
    >
      {children}
      <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" />
    </button>
  );
}

export default function DataTable({
  columns,
  data,
  loading = false,
  emptyTitle = "데이터가 없습니다",
  emptyDescription = "",
  searchColumn = "",
  searchPlaceholder = "검색",
  showSearch = false,
  enablePagination = false,
  pageSize = 10,
  minWidth = "",
  rowClassName,
  onRowClick,
}) {
  const [sorting, setSorting] = useState([]);
  const [columnFilters, setColumnFilters] = useState([]);
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize });

  const table = useReactTable({
    data: data || [],
    columns,
    state: {
      sorting,
      columnFilters,
      pagination,
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: enablePagination ? getPaginationRowModel() : undefined,
    manualPagination: !enablePagination,
  });

  const visibleRows = enablePagination
    ? table.getRowModel().rows
    : table.getSortedRowModel().rows;
  const searchValue = searchColumn
    ? table.getColumn(searchColumn)?.getFilterValue() || ""
    : "";

  return (
    <div className="space-y-3">
      {showSearch && searchColumn && (
        <div className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={searchValue}
            onChange={(event) => table.getColumn(searchColumn)?.setFilterValue(event.target.value)}
            placeholder={searchPlaceholder}
            className="h-10 pl-9"
          />
        </div>
      )}

      <div className="overflow-x-auto overflow-y-hidden rounded-md border border-slate-200 bg-white">
        <Table className={minWidth}>
          <TableHeader className="bg-slate-50">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-slate-50">
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} style={{ width: header.column.columnDef.size }}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={columns.length} className="py-6">
                  <LoadingSpinner />
                </TableCell>
              </TableRow>
            )}

            {!loading && visibleRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={columns.length} className="py-10">
                  <EmptyState title={emptyTitle} description={emptyDescription} />
                </TableCell>
              </TableRow>
            )}

            {!loading && visibleRows.map((row) => (
              <TableRow
                key={row.id}
                onClick={() => onRowClick?.(row.original)}
                className={cn(
                  onRowClick && "cursor-pointer",
                  rowClassName?.(row.original)
                )}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {enablePagination && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>
            {table.getFilteredRowModel().rows.length.toLocaleString("ko-KR")}개 중{" "}
            {visibleRows.length.toLocaleString("ko-KR")}개 표시
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              <ChevronLeft className="h-4 w-4" />
              이전
            </Button>
            <span className="text-xs font-bold text-slate-500">
              {table.getState().pagination.pageIndex + 1} / {table.getPageCount() || 1}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              다음
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
