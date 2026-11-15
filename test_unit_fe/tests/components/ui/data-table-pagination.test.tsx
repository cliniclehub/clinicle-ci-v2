import { DataTablePagination } from "@/components/ui/data-table-pagination"
import { render, screen } from "@/test-utils/render"
import type { Table } from "@tanstack/react-table"
import { describe, expect, it, vi } from "vitest"

describe("DataTablePagination", () => {
  it("shows the full server-side total when row selection is external", () => {
    const table = {
      getState: () => ({ pagination: { pageIndex: 0, pageSize: 10 } }),
      getPageCount: () => 5,
      setPageSize: vi.fn(),
      setPageIndex: vi.fn(),
      previousPage: vi.fn(),
      nextPage: vi.fn(),
    } as unknown as Table<unknown>

    render(
      <DataTablePagination
        table={table}
        enableRowSelection={false}
        currentPage={1}
        pageSize={10}
        totalItems={47}
        itemLabel="users"
        onPageChange={vi.fn()}
        onPageSizeChange={vi.fn()}
      />
    )

    expect(screen.getByText("47 users total")).toBeInTheDocument()
    expect(screen.getByText("Page 1 of 5")).toBeInTheDocument()
  })
})
