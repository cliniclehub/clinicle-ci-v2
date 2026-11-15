"use client"

import {
    ChevronLeftIcon,
    ChevronRightIcon,
    DoubleArrowLeftIcon,
    DoubleArrowRightIcon,
} from "@radix-ui/react-icons"
import { Table } from "@tanstack/react-table"

import { Button } from "@/components/ui/button"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"

interface DataTablePaginationProps<TData> {
  table: Table<TData>
  pageSizeOptions?: number[]
  enableRowSelection?: boolean
  // Server-side props
  onPageChange?: (page: number) => void
  onPageSizeChange?: (pageSize: number) => void
  currentPage?: number
  totalItems?: number
  pageSize?: number
  itemLabel?: string
}

export function DataTablePagination<TData>({
  table,
  pageSizeOptions = [10, 20, 30, 40, 50],
  enableRowSelection = true,
  onPageChange,
  onPageSizeChange,
  currentPage,
  totalItems,
  pageSize,
  itemLabel = "rows",
}: DataTablePaginationProps<TData>) {
  // Use server-side values if provided, otherwise fall back to table state
  const isServerSide = onPageChange !== undefined
  const currentPageIndex = isServerSide && currentPage !== undefined ? currentPage - 1 : table.getState().pagination.pageIndex
  const currentPageSize = isServerSide && pageSize !== undefined ? pageSize : table.getState().pagination.pageSize
  const totalPages = isServerSide && totalItems !== undefined ? Math.ceil(totalItems / currentPageSize) : table.getPageCount()
  return (
    <div className="flex max-w-full min-w-0 flex-wrap items-center justify-between gap-3 overflow-hidden px-0 py-2">
      <div className="min-w-0 flex-1 text-sm text-muted-foreground">
        {enableRowSelection ? (
          <>
            {table.getFilteredSelectedRowModel().rows.length} of{" "}
            {isServerSide && totalItems !== undefined ? totalItems : table.getFilteredRowModel().rows.length} {itemLabel} selected.
          </>
        ) : (
          <>
            {isServerSide && totalItems !== undefined ? totalItems : table.getFilteredRowModel().rows.length} {itemLabel} total
          </>
        )}
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 sm:gap-6 lg:gap-8">
        <div className="flex items-center gap-2">
          <p className="hidden shrink-0 text-sm font-medium sm:block">Rows per page</p>
          <Select
            value={`${currentPageSize}`}
            onValueChange={(value) => {
              if (isServerSide && onPageSizeChange) {
                onPageSizeChange(Number(value))
              } else {
                table.setPageSize(Number(value))
              }
            }}
          >
            <SelectTrigger className="h-9 w-16 shrink-0 sm:w-[70px]">
              <SelectValue placeholder={table.getState().pagination.pageSize} />
            </SelectTrigger>
            <SelectContent side="top">
              {pageSizeOptions.map((pageSize) => (
                <SelectItem key={pageSize} value={`${pageSize}`}>
                  {pageSize}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex min-w-0 shrink-0 items-center text-sm font-medium">
          <span className="whitespace-nowrap">Page {currentPageIndex + 1} of {totalPages}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <Button
            variant="outline"
            className="hidden h-8 w-8 p-0 lg:flex"
            onClick={() => {
              if (isServerSide && onPageChange) {
                onPageChange(1)
              } else {
                table.setPageIndex(0)
              }
            }}
            disabled={currentPageIndex === 0}
          >
            <span className="sr-only">Go to first page</span>
            <DoubleArrowLeftIcon className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            className="h-8 w-8 p-0"
            onClick={() => {
              if (isServerSide && onPageChange) {
                onPageChange(currentPageIndex)
              } else {
                table.previousPage()
              }
            }}
            disabled={currentPageIndex === 0}
          >
            <span className="sr-only">Go to previous page</span>
            <ChevronLeftIcon className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            className="h-8 w-8 p-0"
            onClick={() => {
              if (isServerSide && onPageChange) {
                onPageChange(currentPageIndex + 2)
              } else {
                table.nextPage()
              }
            }}
            disabled={currentPageIndex >= totalPages - 1}
          >
            <span className="sr-only">Go to next page</span>
            <ChevronRightIcon className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            className="hidden h-8 w-8 p-0 lg:flex"
            onClick={() => {
              if (isServerSide && onPageChange) {
                onPageChange(totalPages)
              } else {
                table.setPageIndex(table.getPageCount() - 1)
              }
            }}
            disabled={currentPageIndex >= totalPages - 1}
          >
            <span className="sr-only">Go to last page</span>
            <DoubleArrowRightIcon className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}