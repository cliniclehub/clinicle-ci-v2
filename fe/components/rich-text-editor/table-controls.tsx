"use client"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils/cn"
import type { Editor } from "@tiptap/react"
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Copy,
  MoreHorizontal,
  MoreVertical,
  Plus,
  Trash2,
} from "lucide-react"
import { useCallback, useEffect, useRef, useState, type RefObject } from "react"
import {
  alignCurrentTableColumn,
  alignCurrentTableRow,
  colorCurrentTableColumn,
  colorCurrentTableRow,
  duplicateTableColumn,
  duplicateTableRow,
  focusTableCell,
  getTableSelectionMeta,
  moveTableColumn,
  moveTableRow,
  selectCurrentTableColumn,
  selectCurrentTableRow,
  type TableAlign,
} from "./extensions/table-management"

const CELL_COLORS = [
  "#ffffff",
  "#f8fafc",
  "#fee2e2",
  "#ffedd5",
  "#fef9c3",
  "#dcfce7",
  "#dbeafe",
  "#ede9fe",
  "#fce7f3",
  "#e2e8f0",
  "#fca5a5",
  "#fdba74",
  "#fde047",
  "#86efac",
  "#93c5fd",
  "#c4b5fd",
]

/** Space around the table where handles live; keep hover alive while crossing this gap. */
const HANDLE_GUTTER_PX = 40
const HIDE_DELAY_MS = 220

type HandleKind = "row" | "column"

type HoverTarget = {
  kind: HandleKind
  tablePos: number
  rowIndex: number
  colIndex: number
  rowCount: number
  colCount: number
  top: number
  left: number
  width: number
  height: number
}

type TableControlsProps = {
  editor: Editor
  containerRef: RefObject<HTMLElement | null>
  enabled?: boolean
}

function getCellIndices(cell: HTMLTableCellElement): { rowIndex: number; colIndex: number } | null {
  const row = cell.parentElement as HTMLTableRowElement | null
  const table = cell.closest("table")
  if (!row || !table) return null
  const rows = Array.from(table.querySelectorAll("tr"))
  const rowIndex = rows.indexOf(row)
  if (rowIndex < 0) return null
  const cells = Array.from(row.children).filter(
    (child): child is HTMLTableCellElement => child instanceof HTMLTableCellElement
  )
  const colIndex = cells.indexOf(cell)
  if (colIndex < 0) return null
  return { rowIndex, colIndex }
}

function resolveTablePos(editor: Editor, cell: HTMLTableCellElement, table: HTMLTableElement): number {
  try {
    const pos = editor.view.posAtDOM(cell, 0)
    const $pos = editor.state.doc.resolve(pos)
    for (let d = $pos.depth; d > 0; d -= 1) {
      if ($pos.node(d).type.spec.tableRole === "table") {
        return $pos.before(d)
      }
    }
  } catch {
    // Fall through to DOM matching.
  }

  const tableWrapper = table.closest(".tableWrapper") ?? table.parentElement
  let tablePos = -1
  editor.state.doc.descendants((node, pos) => {
    if (tablePos >= 0) return false
    if (node.type.spec.tableRole !== "table") return true
    const dom = editor.view.nodeDOM(pos)
    if (
      dom === table ||
      dom === tableWrapper ||
      (dom instanceof HTMLElement && (dom === table || dom.contains(table)))
    ) {
      tablePos = pos
      return false
    }
    return true
  })
  return tablePos
}

function cellFromTablePoint(
  table: HTMLTableElement,
  clientX: number,
  clientY: number
): HTMLTableCellElement | null {
  const rows = Array.from(table.querySelectorAll("tr"))
  if (rows.length === 0) return null

  let rowIndex = 0
  for (let i = 0; i < rows.length; i += 1) {
    const rowRect = rows[i].getBoundingClientRect()
    if (clientY < rowRect.top) {
      rowIndex = Math.max(0, i - 1)
      break
    }
    rowIndex = i
    if (clientY <= rowRect.bottom) break
  }

  const row = rows[rowIndex]
  const cells = Array.from(row.children).filter(
    (child): child is HTMLTableCellElement => child instanceof HTMLTableCellElement
  )
  if (cells.length === 0) return null

  let colIndex = 0
  for (let i = 0; i < cells.length; i += 1) {
    const cellRect = cells[i].getBoundingClientRect()
    if (clientX < cellRect.left) {
      colIndex = Math.max(0, i - 1)
      break
    }
    colIndex = i
    if (clientX <= cellRect.right) break
  }

  return cells[colIndex] ?? null
}

function findHoverCell(
  root: HTMLElement,
  clientX: number,
  clientY: number
): HTMLTableCellElement | null {
  const el = document.elementFromPoint(clientX, clientY)
  if (el instanceof Element) {
    if (el.closest("[data-table-control-handle], [data-radix-popper-content-wrapper]")) {
      return null
    }
    const direct = el.closest("td, th") as HTMLTableCellElement | null
    if (direct && root.contains(direct)) return direct
  }

  const tables = Array.from(root.querySelectorAll("table"))
  for (const table of tables) {
    const rect = table.getBoundingClientRect()
    const inZone =
      clientX >= rect.left - HANDLE_GUTTER_PX &&
      clientX <= rect.right + 8 &&
      clientY >= rect.top - HANDLE_GUTTER_PX &&
      clientY <= rect.bottom + 8
    if (!inZone) continue
    const cell = cellFromTablePoint(table, clientX, clientY)
    if (cell) return cell
  }
  return null
}

function sameHandle(a: HoverTarget | null, b: HoverTarget): boolean {
  if (!a) return false
  return (
    a.tablePos === b.tablePos &&
    a.rowIndex === b.rowIndex &&
    a.colIndex === b.colIndex &&
    a.rowCount === b.rowCount &&
    a.colCount === b.colCount &&
    Math.abs(a.top - b.top) < 1 &&
    Math.abs(a.left - b.left) < 1
  )
}

export function TableControls({ editor, containerRef, enabled = true }: TableControlsProps) {
  const [rowHandle, setRowHandle] = useState<HoverTarget | null>(null)
  const [colHandle, setColHandle] = useState<HoverTarget | null>(null)
  const [menuOpen, setMenuOpen] = useState<HandleKind | null>(null)
  const menuOpenRef = useRef<HandleKind | null>(null)
  const hideTimerRef = useRef<number | null>(null)
  const lastCellRef = useRef<HTMLTableCellElement | null>(null)

  useEffect(() => {
    menuOpenRef.current = menuOpen
  }, [menuOpen])

  const cancelHide = useCallback(() => {
    if (hideTimerRef.current != null) {
      window.clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }, [])

  const scheduleHide = useCallback(() => {
    if (menuOpenRef.current) return
    cancelHide()
    hideTimerRef.current = window.setTimeout(() => {
      if (menuOpenRef.current) return
      lastCellRef.current = null
      setRowHandle(null)
      setColHandle(null)
    }, HIDE_DELAY_MS)
  }, [cancelHide])

  const updateFromCell = useCallback(
    (cell: HTMLTableCellElement, container: HTMLElement) => {
      const table = cell.closest("table")
      if (!table || !editor.view.dom.contains(table)) {
        scheduleHide()
        return
      }

      const indices = getCellIndices(cell)
      if (!indices) {
        scheduleHide()
        return
      }

      const tablePos = resolveTablePos(editor, cell, table)
      if (tablePos < 0) {
        scheduleHide()
        return
      }

      cancelHide()
      lastCellRef.current = cell

      const containerRect = container.getBoundingClientRect()
      const row = cell.parentElement as HTMLTableRowElement
      const rowRect = row.getBoundingClientRect()
      const tableRect = table.getBoundingClientRect()
      const rows = table.querySelectorAll("tr")
      const firstRow = rows[0] as HTMLTableRowElement | undefined
      const colCount = firstRow
        ? Array.from(firstRow.children).filter((c) => c instanceof HTMLTableCellElement).length
        : 0
      const colCell = firstRow
        ? (Array.from(firstRow.children).filter(
            (child) => child instanceof HTMLTableCellElement
          )[indices.colIndex] as HTMLTableCellElement | undefined)
        : undefined
      const colRect = (colCell ?? cell).getBoundingClientRect()

      const nextRow: HoverTarget = {
        kind: "row",
        tablePos,
        rowIndex: indices.rowIndex,
        colIndex: indices.colIndex,
        rowCount: rows.length,
        colCount,
        top: rowRect.top - containerRect.top + container.scrollTop + rowRect.height / 2 - 12,
        left: Math.max(4, tableRect.left - containerRect.left + container.scrollLeft - 30),
        width: 24,
        height: 24,
      }

      const nextCol: HoverTarget = {
        kind: "column",
        tablePos,
        rowIndex: indices.rowIndex,
        colIndex: indices.colIndex,
        rowCount: rows.length,
        colCount,
        top: Math.max(4, tableRect.top - containerRect.top + container.scrollTop - 30),
        left: colRect.left - containerRect.left + container.scrollLeft + colRect.width / 2 - 12,
        width: 24,
        height: 24,
      }

      setRowHandle((prev) => (sameHandle(prev, nextRow) ? prev : nextRow))
      setColHandle((prev) => (sameHandle(prev, nextCol) ? prev : nextCol))
    },
    [cancelHide, editor, scheduleHide]
  )

  useEffect(() => {
    if (!enabled || !editor || editor.isDestroyed) return
    const container = containerRef.current
    if (!container) return
    const prose = editor.view.dom

    const onPointerMove = (event: PointerEvent) => {
      if (menuOpenRef.current) return

      const target = event.target
      if (target instanceof Element) {
        if (target.closest("[data-table-control-handle], [data-radix-popper-content-wrapper]")) {
          cancelHide()
          return
        }
      }

      const cell = findHoverCell(prose, event.clientX, event.clientY)
      if (!cell) {
        scheduleHide()
        return
      }
      updateFromCell(cell, container)
    }

    const onPointerLeave = (event: PointerEvent) => {
      if (menuOpenRef.current) return
      const next = event.relatedTarget
      if (next instanceof Element) {
        if (
          container.contains(next) ||
          next.closest("[data-table-control-handle], [data-radix-popper-content-wrapper]")
        ) {
          return
        }
      }
      scheduleHide()
    }

    const refreshFromLastCell = () => {
      if (menuOpenRef.current || !lastCellRef.current) return
      if (!prose.contains(lastCellRef.current)) {
        lastCellRef.current = null
        setRowHandle(null)
        setColHandle(null)
        return
      }
      updateFromCell(lastCellRef.current, container)
    }

    container.addEventListener("pointermove", onPointerMove)
    container.addEventListener("pointerleave", onPointerLeave)
    container.addEventListener("scroll", refreshFromLastCell, { passive: true })
    editor.on("selectionUpdate", refreshFromLastCell)

    return () => {
      cancelHide()
      container.removeEventListener("pointermove", onPointerMove)
      container.removeEventListener("pointerleave", onPointerLeave)
      container.removeEventListener("scroll", refreshFromLastCell)
      editor.off("selectionUpdate", refreshFromLastCell)
    }
  }, [cancelHide, containerRef, editor, enabled, scheduleHide, updateFromCell])

  const prepareSelection = (target: HoverTarget) => {
    focusTableCell(editor, target.tablePos, target.rowIndex, target.colIndex)
    if (target.kind === "row") {
      selectCurrentTableRow(editor)
    } else {
      selectCurrentTableColumn(editor)
    }
  }

  const runRowAction = (target: HoverTarget, action: () => void) => {
    prepareSelection(target)
    action()
    setMenuOpen(null)
  }

  const runColumnAction = (target: HoverTarget, action: () => void) => {
    prepareSelection(target)
    action()
    setMenuOpen(null)
  }

  if (!enabled) return null

  const meta = getTableSelectionMeta(editor)

  const renderColorMenu = (onPick: (color: string | null) => void) => (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>Color</DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="tiptap-popover-content w-52 p-2">
        <button
          type="button"
          className="mb-2 w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
          onClick={() => onPick(null)}
        >
          Clear color
        </button>
        <div className="grid grid-cols-8 gap-1">
          {CELL_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              className="h-5 w-5 rounded border border-border"
              style={{ backgroundColor: color }}
              title={color}
              onClick={() => onPick(color)}
            />
          ))}
        </div>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )

  const renderAlignMenu = (onPick: (align: TableAlign) => void) => (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>Alignment</DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="tiptap-popover-content">
        <DropdownMenuItem onClick={() => onPick("left")}>
          <AlignLeft className="h-4 w-4" /> Left
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onPick("center")}>
          <AlignCenter className="h-4 w-4" /> Center
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onPick("right")}>
          <AlignRight className="h-4 w-4" /> Right
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onPick("justify")}>
          <AlignJustify className="h-4 w-4" /> Justify
        </DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )

  return (
    <>
      {rowHandle && (
        <div
          data-table-control-handle="row"
          className="pointer-events-auto absolute z-20 flex items-center justify-center"
          style={{
            top: rowHandle.top - 8,
            left: rowHandle.left - 8,
            width: 40,
            height: 40,
          }}
          onPointerEnter={cancelHide}
        >
          <DropdownMenu
            open={menuOpen === "row"}
            onOpenChange={(open) => {
              setMenuOpen(open ? "row" : null)
              if (open) prepareSelection(rowHandle)
            }}
          >
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="outline"
                className={cn(
                  "h-6 w-6 rounded-md border bg-background/95 text-muted-foreground shadow-sm",
                  "opacity-90 hover:opacity-100 hover:bg-muted"
                )}
                title="Row options"
                aria-label="Row options"
              >
                <MoreVertical className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="tiptap-popover-content w-52">
              <DropdownMenuLabel>Row</DropdownMenuLabel>
              <DropdownMenuItem
                disabled={!(meta?.canMoveRowUp ?? rowHandle.rowIndex > 0)}
                onClick={() => runRowAction(rowHandle, () => moveTableRow(editor, -1))}
              >
                <ArrowUp className="h-4 w-4" /> Move up
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!(meta?.canMoveRowDown ?? rowHandle.rowIndex < rowHandle.rowCount - 1)}
                onClick={() => runRowAction(rowHandle, () => moveTableRow(editor, 1))}
              >
                <ArrowDown className="h-4 w-4" /> Move down
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() =>
                  runRowAction(rowHandle, () => {
                    selectCurrentTableRow(editor)
                    editor.chain().focus().addRowBefore().run()
                  })
                }
              >
                <Plus className="h-4 w-4" /> Insert above
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  runRowAction(rowHandle, () => {
                    selectCurrentTableRow(editor)
                    editor.chain().focus().addRowAfter().run()
                  })
                }
              >
                <Plus className="h-4 w-4" /> Insert below
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => runRowAction(rowHandle, () => duplicateTableRow(editor))}>
                <Copy className="h-4 w-4" /> Duplicate
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!(meta?.canDeleteRow ?? rowHandle.rowCount > 1)}
                className="text-destructive focus:text-destructive"
                onClick={() =>
                  runRowAction(rowHandle, () => {
                    selectCurrentTableRow(editor)
                    editor.chain().focus().deleteRow().run()
                  })
                }
              >
                <Trash2 className="h-4 w-4" /> Delete
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {renderAlignMenu((align) =>
                runRowAction(rowHandle, () => alignCurrentTableRow(editor, align))
              )}
              {renderColorMenu((color) =>
                runRowAction(rowHandle, () => colorCurrentTableRow(editor, color))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {colHandle && (
        <div
          data-table-control-handle="column"
          className="pointer-events-auto absolute z-20 flex items-center justify-center"
          style={{
            top: colHandle.top - 8,
            left: colHandle.left - 8,
            width: 40,
            height: 40,
          }}
          onPointerEnter={cancelHide}
        >
          <DropdownMenu
            open={menuOpen === "column"}
            onOpenChange={(open) => {
              setMenuOpen(open ? "column" : null)
              if (open) prepareSelection(colHandle)
            }}
          >
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="outline"
                className={cn(
                  "h-6 w-6 rounded-md border bg-background/95 text-muted-foreground shadow-sm",
                  "opacity-90 hover:opacity-100 hover:bg-muted"
                )}
                title="Column options"
                aria-label="Column options"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="tiptap-popover-content w-52">
              <DropdownMenuLabel>Column</DropdownMenuLabel>
              <DropdownMenuItem
                disabled={!(meta?.canMoveColumnLeft ?? colHandle.colIndex > 0)}
                onClick={() => runColumnAction(colHandle, () => moveTableColumn(editor, -1))}
              >
                <ArrowLeft className="h-4 w-4" /> Move left
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!(meta?.canMoveColumnRight ?? colHandle.colIndex < colHandle.colCount - 1)}
                onClick={() => runColumnAction(colHandle, () => moveTableColumn(editor, 1))}
              >
                <ArrowRight className="h-4 w-4" /> Move right
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() =>
                  runColumnAction(colHandle, () => {
                    selectCurrentTableColumn(editor)
                    editor.chain().focus().addColumnBefore().run()
                  })
                }
              >
                <Plus className="h-4 w-4" /> Insert left
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  runColumnAction(colHandle, () => {
                    selectCurrentTableColumn(editor)
                    editor.chain().focus().addColumnAfter().run()
                  })
                }
              >
                <Plus className="h-4 w-4" /> Insert right
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => runColumnAction(colHandle, () => duplicateTableColumn(editor))}
              >
                <Copy className="h-4 w-4" /> Duplicate
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!(meta?.canDeleteColumn ?? colHandle.colCount > 1)}
                className="text-destructive focus:text-destructive"
                onClick={() =>
                  runColumnAction(colHandle, () => {
                    selectCurrentTableColumn(editor)
                    editor.chain().focus().deleteColumn().run()
                  })
                }
              >
                <Trash2 className="h-4 w-4" /> Delete
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {renderAlignMenu((align) =>
                runColumnAction(colHandle, () => alignCurrentTableColumn(editor, align))
              )}
              {renderColorMenu((color) =>
                runColumnAction(colHandle, () => colorCurrentTableColumn(editor, color))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </>
  )
}
