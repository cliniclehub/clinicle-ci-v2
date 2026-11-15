"use client"

import {
  ColumnDef,
  SortingState,
  VisibilityState,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table"
import { Loader2, Search } from "lucide-react"
import * as React from "react"

import { cn } from "@/lib/utils/cn"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

import { DataTableFacetedFilter } from "./data-table-faceted-filter"
import { DataTablePagination } from "./data-table-pagination"
import { DataTableViewOptions } from "./data-table-view-options"

interface DataTableServerSideProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  /** Renders each item as a card on mobile (screens < md). When provided, table is hidden on mobile. */
  renderMobileCard?: (item: TData) => React.ReactNode
  searchKey?: string
  searchPlaceholder?: string
  searchValue?: string
  allowSearchWhileLoading?: boolean
  filterableColumns?: {
    id: string
    title: string
    options: {
      label: string
      value: string
      icon?: React.ComponentType<{ className?: string }>
    }[]
  }[]
  pageSize: number
  pageSizeOptions?: number[]
  showColumnVisibility?: boolean
  enableRowSelection?: boolean
  onRowClick?: (row: TData) => void
  onRowSelectionChange?: (selectedRows: TData[]) => void
  // Server-side props
  totalItems: number
  currentPage: number
  isLoading?: boolean
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
  onSearchChange: (search: string) => void
  onFilterChange: (columnId: string, value: string[]) => void
  onSortChange: (columnId: string, direction: "asc" | "desc" | null) => void
  activeFilters?: Record<string, string[]>
  sortColumn?: string
  sortDirection?: "asc" | "desc"
  toolbarActions?: React.ReactNode
  filterSummary?: string // Optional filter summary text to display
  /** When this changes, row selection is cleared (e.g. when filters/search change) */
  selectionResetKey?: string
  /** Optional class for table header cells (e.g. "font-bold") */
  headerClassName?: string
  /** Optional class applied to the underlying table element */
  tableClassName?: string
  /** Stable row id when data is a single page slice (manual pagination / server pages) */
  getRowId?: (row: TData) => string
  /** Human-readable plural label used in pagination totals. */
  itemLabel?: string
}

export function DataTableServerSide<TData, TValue>({
  columns,
  data,
  renderMobileCard,
  searchKey,
  searchPlaceholder = "Search...",
  searchValue,
  allowSearchWhileLoading = false,
  filterableColumns = [],
  pageSize,
  pageSizeOptions = [10, 20, 30, 40, 50],
  showColumnVisibility = true,
  enableRowSelection = true,
  onRowClick,
  onRowSelectionChange,
  totalItems,
  currentPage,
  isLoading = false,
  onPageChange,
  onPageSizeChange,
  onSearchChange,
  onFilterChange,
  onSortChange,
  activeFilters = {},
  sortColumn,
  sortDirection,
  toolbarActions,
  filterSummary,
  selectionResetKey,
  headerClassName,
  tableClassName,
  getRowId,
  itemLabel,
}: DataTableServerSideProps<TData, TValue>) {
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({})
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [internalSearchValue, setInternalSearchValue] = React.useState(searchValue || "")
  const [hasSearched, setHasSearched] = React.useState(false)
  const [rowSelection, setRowSelection] = React.useState({})
  const prevRowSelectionRef = React.useRef({})
  const searchControlsDisabled = isLoading && !allowSearchWhileLoading

  // Reset selection when filters/search change (selectionResetKey changes)
  React.useEffect(() => {
    if (selectionResetKey !== undefined) {
      setRowSelection({})
      onRowSelectionChange?.([])
    }
  }, [selectionResetKey])

  // Sync external searchValue with internal state
  React.useEffect(() => {
    setInternalSearchValue(searchValue || "")
    setHasSearched(!!searchValue)
  }, [searchValue])

  // Initialize sorting state from props
  React.useEffect(() => {
    if (sortColumn && sortDirection) {
      setSorting([{ id: sortColumn, desc: sortDirection === "desc" }])
    } else {
      setSorting([])
    }
  }, [sortColumn, sortDirection])

  const table = useReactTable({
    data,
    columns,
    ...(getRowId ? { getRowId: (row: TData) => getRowId(row) } : {}),
    state: {
      sorting,
      columnVisibility,
      rowSelection,
    },
    enableRowSelection,
    onSortingChange: (updater) => {
      const newSorting = typeof updater === "function" ? updater(sorting) : updater
      setSorting(newSorting)
      
      if (newSorting.length > 0) {
        const sort = newSorting[0]
        onSortChange(sort.id, sort.desc ? "desc" : "asc")
      } else {
        onSortChange("", null)
      }
    },
    onRowSelectionChange: setRowSelection,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    pageCount: Math.ceil(totalItems / pageSize),
  })

  // Notify parent component when row selection changes
  React.useEffect(() => {
    if (onRowSelectionChange && enableRowSelection) {
      const selectedRows = table.getFilteredSelectedRowModel().rows.map(row => row.original)
      
      // Only call callback if selection actually changed
      const currentSelection = JSON.stringify(rowSelection)
      const prevSelection = JSON.stringify(prevRowSelectionRef.current)
      
      if (currentSelection !== prevSelection) {
        prevRowSelectionRef.current = rowSelection
        onRowSelectionChange(selectedRows)
      }
    }
  }, [rowSelection, enableRowSelection, onRowSelectionChange])

  const handleSearch = React.useCallback(() => {
    onSearchChange(internalSearchValue.trim())
    setHasSearched(true)
  }, [internalSearchValue, onSearchChange])

  const handleSearchInputChange = (value: string) => {
    setInternalSearchValue(value)
    // Don't trigger search automatically - only on button click or Enter key
  }

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (internalSearchValue.trim() || hasSearched)) {
      handleSearch()
    }
  }

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        {searchKey && (
          <Input
            placeholder={searchPlaceholder}
            value={internalSearchValue}
            onChange={(e) => handleSearchInputChange(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            className="h-10 min-w-0 flex-1 sm:max-w-sm"
            disabled={searchControlsDisabled}
          />
        )}
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {searchKey && (
            <>
              <Button
                onClick={handleSearch}
                size="sm"
                className="h-10"
                disabled={searchControlsDisabled || (!internalSearchValue.trim() && !hasSearched)}
              >
                <Search className="h-4 w-4" />
                Search
              </Button>
              {hasSearched && (
                <Button
                  onClick={() => {
                    setInternalSearchValue("")
                    onSearchChange("")
                    setHasSearched(false)
                  }}
                  size="sm"
                  variant="ghost"
                  className="h-10"
                  disabled={searchControlsDisabled}
                >
                  Clear
                </Button>
              )}
            </>
          )}
          {filterableColumns.map((column) => (
            <DataTableFacetedFilter
              key={column.id}
              column={table.getColumn(column.id)}
              title={column.title}
              options={column.options}
              selectedValues={new Set(activeFilters[column.id] || [])}
              onSelectedChange={(values) => {
                onFilterChange(column.id, Array.from(values))
              }}
            />
          ))}
        </div>
        <div className="flex items-center gap-2 sm:ml-auto">
          {toolbarActions && (
            <div className="flex items-center gap-2">
              {toolbarActions}
            </div>
          )}
          {showColumnVisibility && <DataTableViewOptions table={table} />}
        </div>
      </div>

      {/* Filter Summary */}
      {filterSummary && (
        <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 rounded-md border text-sm text-muted-foreground">
          <span className="font-medium">Active filters:</span>
          <span className="text-foreground">{filterSummary}</span>
        </div>
      )}

      {/* Mobile card layout - no horizontal scroll */}
      {renderMobileCard && (
        <div className="min-w-0 space-y-3 pb-20 md:hidden md:pb-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : data.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              {filterSummary ? "No results match your filters." : "No data."}
            </div>
          ) : (
            <div className="space-y-3">{data.map((item, index) => (
              <React.Fragment
                key={getRowId?.(item) ?? (item as any)?.id ?? index}
              >
                {renderMobileCard(item)}
              </React.Fragment>
            ))}</div>
          )}
        </div>
      )}

      {/* Desktop table - hidden on mobile when cards are used */}
      <div className={`relative min-w-0 overflow-x-auto rounded-md border ${renderMobileCard ? "hidden md:block" : ""}`}>
        {isLoading && (
          <div className="absolute inset-0 bg-background/50 backdrop-blur-sm z-10 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        )}
        
        <Table className={cn("min-w-[600px]", tableClassName)}>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const headerMetaClassName = (
                    header.column.columnDef.meta as { headerClassName?: string } | undefined
                  )?.headerClassName
                  return (
                    <TableHead
                      key={header.id}
                      colSpan={header.colSpan}
                      className={cn(headerClassName, headerMetaClassName)}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                  onClick={() => onRowClick?.(row.original)}
                  className={onRowClick ? "cursor-pointer" : ""}
                >
                  {row.getVisibleCells().map((cell) => {
                    const cellMetaClassName = (
                      cell.column.columnDef.meta as { cellClassName?: string } | undefined
                    )?.cellClassName
                    return (
                    <TableCell key={cell.id} className={cellMetaClassName}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                    )
                  })}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  {isLoading ? "Loading..." : "No results."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      
      <div className="sticky bottom-0 z-10 mt-4 min-w-0 overflow-hidden border-t bg-background px-2 py-3 shadow-[0_-2px_10px_rgba(0,0,0,0.05)] md:border-t-0 md:px-0 md:shadow-none">
        <DataTablePagination
        table={table}
        pageSizeOptions={pageSizeOptions}
        enableRowSelection={enableRowSelection}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
        currentPage={currentPage}
        totalItems={totalItems}
        pageSize={pageSize}
        itemLabel={itemLabel}
        />
      </div>
    </div>
  )
}
