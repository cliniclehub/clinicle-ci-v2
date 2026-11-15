import type { Editor } from "@tiptap/core"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { Fragment } from "@tiptap/pm/model"
import { TextSelection, type Transaction } from "@tiptap/pm/state"
import { CellSelection, TableMap } from "@tiptap/pm/tables"

export type TableAlign = "left" | "center" | "right" | "justify"

export type TableContext = {
  table: ProseMirrorNode
  tablePos: number
  map: TableMap
  rowIndex: number
  colIndex: number
  cellPos: number
}

export function findTableContext(editor: Editor): TableContext | null {
  const { selection } = editor.state
  const $from = selection.$from

  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth)
    if (node.type.spec.tableRole === "table") {
      const tablePos = $from.before(depth)
      const map = TableMap.get(node)
      let cellPos: number | null =
        selection instanceof CellSelection ? selection.$anchorCell.pos : null

      if (cellPos == null) {
        for (let d = $from.depth; d > 0; d -= 1) {
          const role = $from.node(d).type.spec.tableRole
          if (role === "cell" || role === "header_cell") {
            cellPos = $from.before(d)
            break
          }
        }
      }

      if (cellPos == null) return null

      const cellOffset = cellPos - tablePos - 1
      const rect = map.findCell(cellOffset)
      return {
        table: node,
        tablePos,
        map,
        rowIndex: rect.top,
        colIndex: rect.left,
        cellPos,
      }
    }
  }

  return null
}

function selectRow(editor: Editor, ctx: TableContext): boolean {
  const start = ctx.map.positionAt(ctx.rowIndex, 0, ctx.table)
  const end = ctx.map.positionAt(ctx.rowIndex, ctx.map.width - 1, ctx.table)
  return editor.commands.setCellSelection({
    anchorCell: ctx.tablePos + 1 + start,
    headCell: ctx.tablePos + 1 + end,
  })
}

function selectColumn(editor: Editor, ctx: TableContext): boolean {
  const start = ctx.map.positionAt(0, ctx.colIndex, ctx.table)
  const end = ctx.map.positionAt(ctx.map.height - 1, ctx.colIndex, ctx.table)
  return editor.commands.setCellSelection({
    anchorCell: ctx.tablePos + 1 + start,
    headCell: ctx.tablePos + 1 + end,
  })
}

function getRowNodes(table: ProseMirrorNode): ProseMirrorNode[] {
  const rows: ProseMirrorNode[] = []
  table.forEach((row) => rows.push(row))
  return rows
}

function getCellNodes(row: ProseMirrorNode): ProseMirrorNode[] {
  const cells: ProseMirrorNode[] = []
  row.forEach((cell) => cells.push(cell))
  return cells
}

function replaceTableRows(
  tr: Transaction,
  tablePos: number,
  table: ProseMirrorNode,
  rows: ProseMirrorNode[]
) {
  tr.replaceWith(tablePos, tablePos + table.nodeSize, table.copy(Fragment.fromArray(rows)))
}

function withBackgroundColor(style: string | null | undefined, color: string | null): string {
  const cleaned = String(style || "")
    .replace(/background-color\s*:\s*[^;]+;?/gi, "")
    .replace(/;;+/g, ";")
    .trim()
    .replace(/^;|;$/g, "")

  if (!color) return cleaned
  return cleaned ? `${cleaned}; background-color: ${color}` : `background-color: ${color}`
}

function applyAlignmentToCell(
  tr: Transaction,
  cellPos: number,
  cell: ProseMirrorNode,
  align: TableAlign
) {
  cell.forEach((child, childOffset) => {
    if (child.type.name === "paragraph" || child.type.name === "heading") {
      tr.setNodeMarkup(cellPos + 1 + childOffset, undefined, {
        ...child.attrs,
        textAlign: align,
      })
    }
  })
}

function forEachSelectedCell(
  editor: Editor,
  fn: (cell: ProseMirrorNode, pos: number, tr: Transaction) => void
): boolean {
  const { selection } = editor.state
  if (!(selection instanceof CellSelection)) return false

  const tr = editor.state.tr
  selection.forEachCell((cell, pos) => {
    fn(cell, pos, tr)
  })
  if (tr.docChanged) {
    editor.view.dispatch(tr)
  }
  return true
}

export function selectCurrentTableRow(editor: Editor): boolean {
  const ctx = findTableContext(editor)
  if (!ctx) return false
  return selectRow(editor, ctx)
}

export function selectCurrentTableColumn(editor: Editor): boolean {
  const ctx = findTableContext(editor)
  if (!ctx) return false
  return selectColumn(editor, ctx)
}

export function focusTableCell(editor: Editor, tablePos: number, row: number, col: number): boolean {
  const table = editor.state.doc.nodeAt(tablePos)
  if (!table || table.type.spec.tableRole !== "table") return false
  const map = TableMap.get(table)
  if (row < 0 || col < 0 || row >= map.height || col >= map.width) return false
  const cellPos = tablePos + 1 + map.positionAt(row, col, table)
  const tr = editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(cellPos + 1)))
  editor.view.dispatch(tr.scrollIntoView())
  return true
}

export function moveTableRow(editor: Editor, direction: -1 | 1): boolean {
  const ctx = findTableContext(editor)
  if (!ctx) return false
  const target = ctx.rowIndex + direction
  if (target < 0 || target >= ctx.map.height) return false

  const rows = getRowNodes(ctx.table)
  const tmp = rows[ctx.rowIndex]
  rows[ctx.rowIndex] = rows[target]
  rows[target] = tmp

  const tr = editor.state.tr
  replaceTableRows(tr, ctx.tablePos, ctx.table, rows)
  editor.view.dispatch(tr.scrollIntoView())
  focusTableCell(editor, ctx.tablePos, target, ctx.colIndex)
  return true
}

export function moveTableColumn(editor: Editor, direction: -1 | 1): boolean {
  const ctx = findTableContext(editor)
  if (!ctx) return false
  const target = ctx.colIndex + direction
  if (target < 0 || target >= ctx.map.width) return false

  const nextRows: ProseMirrorNode[] = []
  for (const row of getRowNodes(ctx.table)) {
    const cells = getCellNodes(row)
    if (cells.length !== ctx.map.width) return false
    const tmp = cells[ctx.colIndex]
    cells[ctx.colIndex] = cells[target]
    cells[target] = tmp
    nextRows.push(row.copy(Fragment.fromArray(cells)))
  }

  const tr = editor.state.tr
  replaceTableRows(tr, ctx.tablePos, ctx.table, nextRows)
  editor.view.dispatch(tr.scrollIntoView())
  focusTableCell(editor, ctx.tablePos, ctx.rowIndex, target)
  return true
}

export function duplicateTableRow(editor: Editor): boolean {
  const ctx = findTableContext(editor)
  if (!ctx) return false
  const rows = getRowNodes(ctx.table)
  const source = rows[ctx.rowIndex]
  if (!source) return false

  const copy = source.copy(source.content)
  const nextRows = [...rows.slice(0, ctx.rowIndex + 1), copy, ...rows.slice(ctx.rowIndex + 1)]
  const tr = editor.state.tr
  replaceTableRows(tr, ctx.tablePos, ctx.table, nextRows)
  editor.view.dispatch(tr.scrollIntoView())
  focusTableCell(editor, ctx.tablePos, ctx.rowIndex + 1, ctx.colIndex)
  return true
}

export function duplicateTableColumn(editor: Editor): boolean {
  const ctx = findTableContext(editor)
  if (!ctx) return false

  const nextRows: ProseMirrorNode[] = []
  for (const row of getRowNodes(ctx.table)) {
    const cells = getCellNodes(row)
    if (cells.length !== ctx.map.width) return false
    const source = cells[ctx.colIndex]
    const copy = source.copy(source.content)
    nextRows.push(
      row.copy(Fragment.fromArray([...cells.slice(0, ctx.colIndex + 1), copy, ...cells.slice(ctx.colIndex + 1)]))
    )
  }

  const tr = editor.state.tr
  replaceTableRows(tr, ctx.tablePos, ctx.table, nextRows)
  editor.view.dispatch(tr.scrollIntoView())
  focusTableCell(editor, ctx.tablePos, ctx.rowIndex, ctx.colIndex + 1)
  return true
}

export function setSelectedCellsBackground(editor: Editor, color: string | null): boolean {
  return forEachSelectedCell(editor, (cell, pos, tr) => {
    tr.setNodeMarkup(pos, undefined, {
      ...cell.attrs,
      style: withBackgroundColor(cell.attrs.style, color),
    })
  })
}

export function setSelectedCellsAlignment(editor: Editor, align: TableAlign): boolean {
  return forEachSelectedCell(editor, (cell, pos, tr) => {
    applyAlignmentToCell(tr, pos, cell, align)
  })
}

export function colorCurrentTableRow(editor: Editor, color: string | null): boolean {
  const ctx = findTableContext(editor)
  if (!ctx || !selectRow(editor, ctx)) return false
  return setSelectedCellsBackground(editor, color)
}

export function colorCurrentTableColumn(editor: Editor, color: string | null): boolean {
  const ctx = findTableContext(editor)
  if (!ctx || !selectColumn(editor, ctx)) return false
  return setSelectedCellsBackground(editor, color)
}

export function alignCurrentTableRow(editor: Editor, align: TableAlign): boolean {
  const ctx = findTableContext(editor)
  if (!ctx || !selectRow(editor, ctx)) return false
  return setSelectedCellsAlignment(editor, align)
}

export function alignCurrentTableColumn(editor: Editor, align: TableAlign): boolean {
  const ctx = findTableContext(editor)
  if (!ctx || !selectColumn(editor, ctx)) return false
  return setSelectedCellsAlignment(editor, align)
}

export function getTableSelectionMeta(editor: Editor) {
  const ctx = findTableContext(editor)
  if (!ctx) return null
  return {
    rowIndex: ctx.rowIndex,
    colIndex: ctx.colIndex,
    rowCount: ctx.map.height,
    colCount: ctx.map.width,
    canMoveRowUp: ctx.rowIndex > 0,
    canMoveRowDown: ctx.rowIndex < ctx.map.height - 1,
    canMoveColumnLeft: ctx.colIndex > 0,
    canMoveColumnRight: ctx.colIndex < ctx.map.width - 1,
    canDeleteRow: ctx.map.height > 1,
    canDeleteColumn: ctx.map.width > 1,
  }
}
