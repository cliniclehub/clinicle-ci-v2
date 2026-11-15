"use client"

import MediaManager from "@/components/media-manager/media-manager-form"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils/cn"
import { normalizeExternalHref } from "@/components/rich-text-editor/extensions/resizable-image"
import type { Editor } from "@tiptap/react"
import {
    AlignCenter,
    AlignJustify,
    AlignLeft,
    AlignRight,
    Bold,
    Code,
    FolderOpen,
    Highlighter,
    Image as ImageIcon,
    Italic,
    Link2,
    List,
    ListOrdered,
    Maximize,
    Minimize,
    Minus,
    Palette,
    Quote,
    Redo,
    Table,
    Underline,
    Undo
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

interface TiptapToolbarProps {
  editor: Editor
  onToggleCodeView?: () => void
  showCodeView?: boolean
  onToggleFullscreen?: () => void
  isFullscreen?: boolean
  minimalFeatures?: boolean
}

const colors = [
  "#000000",
  "#e60000",
  "#ff9900",
  "#ffff00",
  "#008a00",
  "#0066cc",
  "#9933ff",
  "#ffffff",
  "#facccc",
  "#ffebcc",
  "#ffffcc",
  "#cce8cc",
  "#cce0f5",
  "#ebd6ff",
  "#bbbbbb",
  "#f06666",
  "#ffc266",
  "#ffff66",
  "#66b266",
  "#66a3e0",
  "#c285ff",
  "#888888",
  "#a10000",
  "#b26b00",
  "#b2b200",
  "#006100",
  "#0047b2",
  "#6b24b2",
  "#444444",
  "#5c0000",
  "#663d00",
  "#666600",
  "#003700",
  "#002966",
  "#3d1466",
]

// Helper functions for heading management
const getActiveHeading = (editor: Editor) => {
  if (editor.isActive("heading", { level: 1 })) return "heading1"
  if (editor.isActive("heading", { level: 2 })) return "heading2"
  if (editor.isActive("heading", { level: 3 })) return "heading3"
  if (editor.isActive("heading", { level: 4 })) return "heading4"
  return "paragraph"
}

const handleHeadingChange = (editor: Editor, value: string) => {
  switch (value) {
    case "paragraph":
      editor.chain().focus().setParagraph().run()
      break
    case "heading1":
      editor.chain().focus().toggleHeading({ level: 1 }).run()
      break
    case "heading2":
      editor.chain().focus().toggleHeading({ level: 2 }).run()
      break
    case "heading3":
      editor.chain().focus().toggleHeading({ level: 3 }).run()
      break
    case "heading4":
      editor.chain().focus().toggleHeading({ level: 4 }).run()
      break
  }
}

// Helper functions for font management
const getCurrentFontFamily = (editor: Editor) => {
  try {
    // Check if FontFamily extension is loaded
    const hasFontFamilyExtension = editor.extensionManager.extensions.some(
      ext => ext.name === 'fontFamily'
    )
    if (!hasFontFamilyExtension) {
      return "Arial" // Default font
    }
    const { fontFamily } = editor.getAttributes("textStyle")
    return fontFamily || "Arial" // Default to Arial
  } catch (error) {
    console.warn('Error getting font family:', error)
    return "Arial" // Default font
  }
}

const getCurrentFontSize = (editor: Editor) => {
  try {
    // Check if FontSize extension is loaded
    const hasFontSizeExtension = editor.extensionManager.extensions.some(
      ext => ext.name === 'fontSize'
    )
    if (!hasFontSizeExtension) {
      return "16" // Default size
    }
    const { fontSize } = editor.getAttributes("textStyle")
    return fontSize?.replace("px", "") || "16"
  } catch (error) {
    console.warn('Error getting font size:', error)
    return "16" // Default size
  }
}

const getCurrentTextColor = (editor: Editor) => {
  try {
    const { color } = editor.getAttributes("textStyle")
    return color || null
  } catch (error) {
    console.warn('Error getting text color:', error)
    return null
  }
}

const handleFontFamilyChange = (editor: Editor, fontFamily: string) => {
  try {
    // Check if the FontFamily extension is loaded by checking the extension manager
    const hasFontFamilyExtension = editor.extensionManager.extensions.some(
      ext => ext.name === 'fontFamily'
    )
    
    if (!hasFontFamilyExtension) {
      console.warn('FontFamily extension not loaded - command unavailable')
      return
    }
    
    if (fontFamily === "default") {
      editor.chain().focus().setFontFamily("Arial").run() // Set to Arial instead of unsetting
    } else {
      editor.chain().focus().setFontFamily(fontFamily).run()
    }
  } catch (error) {
    console.warn('Font family command failed:', error)
  }
}

const handleFontSizeChange = (editor: Editor, fontSize: string) => {
  try {
    // Check if the FontSize extension is loaded by checking the extension manager
    const hasFontSizeExtension = editor.extensionManager.extensions.some(
      ext => ext.name === 'fontSize'
    )
    
    if (!hasFontSizeExtension) {
      console.warn('FontSize extension not loaded - command unavailable')
      return
    }
    
    // Ensure editor is ready
    if (!editor || editor.isDestroyed || !editor.isEditable) {
      console.warn('Editor not ready for font size change')
      return
    }
    
    // Execute command synchronously but with error handling
    if (fontSize === "default") {
      // @ts-ignore - Custom command
      editor.chain().focus().unsetFontSize().run()
    } else {
      // @ts-ignore - Custom command
      editor.chain().focus().setFontSize(`${fontSize}px`).run()
    }
  } catch (error) {
    // Silently handle transaction mismatch errors - they're usually harmless
    if (error instanceof Error && error.message.includes('mismatched transaction')) {
      // Retry once after a brief delay
      setTimeout(() => {
        try {
          if (fontSize === "default") {
            // @ts-ignore - Custom command
            editor.chain().focus().unsetFontSize().run()
          } else {
            // @ts-ignore - Custom command
            editor.chain().focus().setFontSize(`${fontSize}px`).run()
          }
        } catch (retryError) {
          console.warn('Font size command retry failed:', retryError)
        }
      }, 10)
    } else {
      console.warn('Font size command failed:', error)
    }
  }
}

// Table Grid Selector Component
function TableGridSelector({ onSelectTable }: { onSelectTable: (rows: number, cols: number) => void }) {
  const [hoveredCell, setHoveredCell] = useState<{ row: number; col: number } | null>(null)
  const maxRows = 8
  const maxCols = 8

  const handleCellHover = (row: number, col: number) => {
    setHoveredCell({ row, col })
  }

  const handleCellClick = (row: number, col: number) => {
    onSelectTable(row + 1, col + 1)
  }

  return (
    <div className="p-3">
      <div className="text-sm text-muted-foreground mb-2">Select table size</div>
      <div className="grid grid-cols-8 gap-1 mb-3">
        {Array.from({ length: maxRows }, (_, rowIndex) =>
          Array.from({ length: maxCols }, (_, colIndex) => {
            const isHighlighted = hoveredCell && rowIndex <= hoveredCell.row && colIndex <= hoveredCell.col
            return (
              <div
                key={`${rowIndex}-${colIndex}`}
                className={`w-4 h-4 border border-border cursor-pointer transition-colors ${
                  isHighlighted ? "bg-blue-500 border-blue-500" : "bg-card hover:bg-muted"
                }`}
                onMouseEnter={() => handleCellHover(rowIndex, colIndex)}
                onClick={() => handleCellClick(rowIndex, colIndex)}
              />
            )
          }),
        )}
      </div>
      {hoveredCell && (
        <div className="text-sm text-center text-muted-foreground">
          {hoveredCell.row + 1} × {hoveredCell.col + 1} table
        </div>
      )}
    </div>
  )
}

export function TiptapToolbar({
  editor,
  onToggleCodeView,
  showCodeView,
  onToggleFullscreen,
  isFullscreen,
  minimalFeatures = false,
}: TiptapToolbarProps) {
  const [, forceUpdate] = useState({})
  useEffect(() => {
    const handleUpdate = () => forceUpdate({})
    editor.on("selectionUpdate", handleUpdate)
    editor.on("transaction", handleUpdate)
    return () => {
      editor.off("selectionUpdate", handleUpdate)
      editor.off("transaction", handleUpdate)
    }
  }, [editor])

  const [linkPopoverOpen, setLinkPopoverOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState("")
  const [openInNewTab, setOpenInNewTab] = useState(false)

  const handleLinkPopoverOpenChange = (open: boolean) => {
    setLinkPopoverOpen(open)
    if (open) {
      const attrs = editor.getAttributes("link")
      setLinkUrl(attrs.href || "")
      setOpenInNewTab(attrs.target === "_blank")
    }
  }

  const handleSetLink = () => {
    if (linkUrl.trim()) {
      const existing = editor.getAttributes("link")
      const attrs: { href: string; target?: string; rel?: string; style?: string } = {
        href: linkUrl.trim(),
      }
      if (openInNewTab) {
        attrs.target = "_blank"
        attrs.rel = "noopener noreferrer"
      }
      if (existing.style) {
        attrs.style = existing.style
      }
      editor.chain().focus().setLink(attrs).run()
      setLinkPopoverOpen(false)
    }
  }

  const handleRemoveLink = () => {
    editor.chain().focus().unsetLink().run()
    setLinkPopoverOpen(false)
  }

  const [imagePopoverOpen, setImagePopoverOpen] = useState(false)
  const [imageUrl, setImageUrl] = useState("")
  const [imageAlt, setImageAlt] = useState("")
  const [imageHref, setImageHref] = useState("")
  const [isMediaManagerOpen, setIsMediaManagerOpen] = useState(false)
  const mediaSelectSucceededRef = useRef(false)

  const isImageSelected = editor.isActive("resizableImage")

  const handleImagePopoverOpenChange = (open: boolean) => {
    setImagePopoverOpen(open)
    if (open) {
      if (editor.isActive("resizableImage")) {
        const attrs = editor.getAttributes("resizableImage")
        setImageUrl(attrs.src || "")
        setImageAlt(attrs.alt || "")
        setImageHref(attrs.href || "")
      } else {
        setImageUrl("")
        setImageAlt("")
        setImageHref("")
      }
    } else {
      setImageUrl("")
      setImageAlt("")
      setImageHref("")
    }
  }

  const handleInsertOrUpdateImage = () => {
    const hasImageExtension = editor.extensionManager.extensions.some((ext) => ext.name === "resizableImage")
    if (!hasImageExtension) return

    const src = imageUrl.trim()
    if (src && /[?&](?:token|expires|mediatoken|media_token)=/i.test(src)) {
      toast.error("Use a public image URL. Signed URLs expire and break in email.")
      return
    }

    if (isImageSelected) {
      const anchor = editor.state.selection.anchor
      ;(editor.chain().focus() as any)
        .updateAttributes("resizableImage", {
          src,
          alt: imageAlt.trim() || undefined,
          href: normalizeExternalHref(imageHref) || null,
        })
        .setNodeSelection(anchor)
        .run()
    } else if (src) {
      ;(editor.chain().focus() as any)
        .setImage({
          src,
          alt: imageAlt.trim() || undefined,
          href: normalizeExternalHref(imageHref) || undefined,
        })
        .run()
    }

    if (src || isImageSelected) {
      setImagePopoverOpen(false)
      setImageUrl("")
      setImageAlt("")
      setImageHref("")
    }
  }

  const handleOpenMediaManager = () => {
    mediaSelectSucceededRef.current = false
    setImagePopoverOpen(false)
    setIsMediaManagerOpen(true)
  }

  const handleMediaSelect = (fileUrl: string, fileData: { originalName?: string }) => {
    const src = (fileUrl || "").trim()
    if (!src) {
      toast.error("Selected media has no usable image URL")
      return
    }
    // Email HTML cannot use private/signed media URLs — they expire.
    if (/[?&](?:token|expires|mediatoken|media_token)=/i.test(src)) {
      toast.error("Choose a public image. Signed URLs expire and break in email.")
      return
    }
    const hasImageExtension = editor.extensionManager.extensions.some((ext) => ext.name === "resizableImage")
    if (hasImageExtension) {
      ;(editor.chain().focus() as any)
        .setImage({ src, alt: fileData.originalName || undefined })
        .run()
    }
    mediaSelectSucceededRef.current = true
    setIsMediaManagerOpen(false)
    setImagePopoverOpen(false)
  }

  const handleMediaManagerClose = () => {
    setIsMediaManagerOpen(false)
    if (mediaSelectSucceededRef.current) {
      mediaSelectSucceededRef.current = false
      setImagePopoverOpen(false)
      return
    }
    // Cancel / dismiss: return to the insert-image popover
    setImagePopoverOpen(true)
  }

  const safeCommand = (editor: Editor, command: string, ...args: any[]) => {
    try {
      // @ts-ignore - We're checking if the method exists dynamically
      if (editor.chain().focus()[command]) {
        // @ts-ignore - Dynamic method call
        return editor
          .chain()
          .focus()
          [command](...args)
          .run()
      }
      return null
    } catch (error) {
      console.warn(`Command ${command} failed:`, error)
      return null
    }
  }

  const addTable = (editor: Editor, rows: number, cols: number) => {
    editor.chain().focus().insertTable({ rows, cols, withHeaderRow: false }).run()
  }

  const addHorizontalRule = (editor: Editor) => {
    editor.chain().focus().setHorizontalRule().run()
  }

  return (
    <div
      className="border-b bg-muted/30 p-2 space-y-2"
      onMouseDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
    >
      {/* First Row */}
      <div className="flex items-center gap-1 flex-wrap">
        {/* Heading Selector */}
        <Select value={getActiveHeading(editor)} onValueChange={(value) => handleHeadingChange(editor, value)}>
          <SelectTrigger className="w-32 h-8">
            <SelectValue placeholder="Normal" />
          </SelectTrigger>
          <SelectContent className="tiptap-popover-content">
            <SelectItem value="paragraph">Normal</SelectItem>
            <SelectItem value="heading1">Heading 1</SelectItem>
            <SelectItem value="heading2">Heading 2</SelectItem>
            <SelectItem value="heading3">Heading 3</SelectItem>
            <SelectItem value="heading4">Heading 4</SelectItem>
          </SelectContent>
        </Select>

        {/* Font Family - Only show if not minimal */}
        {!minimalFeatures && (
          <Select value={getCurrentFontFamily(editor)} onValueChange={(value) => handleFontFamilyChange(editor, value)}>
            <SelectTrigger className="w-32 h-8">
              <SelectValue placeholder="Arial" />
            </SelectTrigger>
            <SelectContent className="tiptap-popover-content">
              <SelectItem value="Arial">Arial</SelectItem>
              <SelectItem value="Inter">Inter</SelectItem>
              <SelectItem value="Helvetica">Helvetica</SelectItem>
              <SelectItem value="Times New Roman">Times</SelectItem>
              <SelectItem value="Courier New">Courier</SelectItem>
              <SelectItem value="Georgia">Georgia</SelectItem>
              <SelectItem value="Verdana">Verdana</SelectItem>
            </SelectContent>
          </Select>
        )}

        {/* Font Size - Only show if not minimal */}
        {!minimalFeatures && (
          <Select value={getCurrentFontSize(editor)} onValueChange={(value) => handleFontSizeChange(editor, value)}>
            <SelectTrigger className="w-16 h-8">
              <SelectValue placeholder="Size" />
            </SelectTrigger>
            <SelectContent className="tiptap-popover-content">
              <SelectItem value="10">10</SelectItem>
              <SelectItem value="12">12</SelectItem>
              <SelectItem value="14">14</SelectItem>
              <SelectItem value="16">16</SelectItem>
              <SelectItem value="18">18</SelectItem>
              <SelectItem value="20">20</SelectItem>
              <SelectItem value="24">24</SelectItem>
              <SelectItem value="28">28</SelectItem>
              <SelectItem value="32">32</SelectItem>
              <SelectItem value="36">36</SelectItem>
              <SelectItem value="48">48</SelectItem>
            </SelectContent>
          </Select>
        )}

        {/* Separator - Only show if not minimal */}
        {!minimalFeatures && <Separator orientation="vertical" className="h-6" />}

        {/* Text Color - Only show if not minimal */}
        {!minimalFeatures && (() => {
          const currentColor = getCurrentTextColor(editor)
          const hasColor = !!currentColor
          
          return (
            <Popover>
              <PopoverTrigger asChild>
                <Button 
                  variant={hasColor ? "default" : "ghost"} 
                  size="sm" 
                  className="h-8 w-8 p-0" 
                  type="button"
                  title={hasColor ? `Text color: ${currentColor}` : "Text color"}
                >
                  <div className="relative">
                    <Palette className="h-4 w-4" />
                    {hasColor && (
                      <div 
                        className="absolute bottom-0 right-0 w-2 h-2 rounded-full border border-background"
                        style={{ backgroundColor: currentColor }}
                      />
                    )}
                  </div>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="tiptap-popover-content w-64">
                <div className="space-y-2">
                  {/* Remove Color / Default Option */}
                  <div className="mb-2 pb-2 border-b">
                    <button
                      className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted flex items-center gap-2"
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        
                        // Focus the editor first
                        editor.commands.focus()
                        
                        // Use transaction API to remove color mark
                        const { state, dispatch } = editor.view
                        const { from, to } = state.selection
                        const markType = state.schema.marks.textStyle
                        
                        if (markType) {
                          // Get current attributes and remove color
                          const currentAttrs = editor.getAttributes('textStyle')
                          const newAttrs = { ...currentAttrs, color: null }
                          
                          // Remove color by setting it to null
                          editor.chain().focus().setMark('textStyle', newAttrs).removeEmptyTextStyle().run()
                        } else {
                          // Fallback: unset color
                          editor.chain().focus().unsetColor().run()
                        }
                      }}
                    >
                      <span className="w-6 h-6 rounded border border-border bg-transparent flex items-center justify-center">
                        <span className="text-xs">A</span>
                      </span>
                      <span>Default (Automatic)</span>
                    </button>
                  </div>
                  {/* Color Grid */}
                  <div className="grid grid-cols-7 gap-1">
                    {colors.map((color) => {
                      const isActive = currentColor === color
                      return (
                        <button
                          key={color}
                          className={cn(
                            "w-6 h-6 rounded border transition-all",
                            isActive ? "ring-2 ring-primary ring-offset-1" : "border-border"
                          )}
                          style={{ backgroundColor: color }}
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            
                            // If already this color, remove color (set to default)
                            if (isActive) {
                              const { state } = editor.view
                              const markType = state.schema.marks.textStyle
                              if (markType) {
                                const currentAttrs = editor.getAttributes('textStyle')
                                const newAttrs = { ...currentAttrs, color: null }
                                editor.chain().focus().setMark('textStyle', newAttrs).removeEmptyTextStyle().run()
                              } else {
                                editor.chain().focus().unsetColor().run()
                              }
                            } else {
                              // Set the new color
                              editor.chain().focus().setColor(color).run()
                            }
                          }}
                          title={isActive ? `Remove ${color} color (set to default)` : `Apply ${color} color`}
                        />
                      )
                    })}
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          )
        })()}

        {/* Highlight Color - Only show if not minimal */}
        {!minimalFeatures && (
          <Popover>
            <PopoverTrigger asChild>
              <Button 
                variant={editor.isActive('highlight') ? "default" : "ghost"} 
                size="sm" 
                className="h-8 w-8 p-0" 
                type="button"
              >
                <Highlighter className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="tiptap-popover-content w-64">
              <div className="space-y-2">
                {/* Remove Highlight Option */}
                <div className="mb-2 pb-2 border-b">
                  <button
                    className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted flex items-center gap-2"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      
                      // Focus the editor first
                      editor.commands.focus()
                      
                      // Use the transaction API directly to remove highlight mark
                      const { state, dispatch } = editor.view
                      const { from, to } = state.selection
                      
                      // Create a transaction that removes the highlight mark
                      const tr = state.tr
                      const markType = state.schema.marks.highlight
                      
                      if (markType) {
                        // Remove highlight mark from the selection
                        tr.removeMark(from, to, markType)
                        dispatch(tr)
                      } else {
                        // Fallback: use command chain
                        editor.chain().focus().unsetHighlight().run()
                      }
                    }}
                  >
                    <span className="w-6 h-6 rounded border border-border bg-transparent flex items-center justify-center">
                      <span className="text-xs">×</span>
                    </span>
                    <span>Remove highlight</span>
                  </button>
                </div>
                {/* Color Grid */}
                <div className="grid grid-cols-7 gap-1">
                  {colors.map((color) => {
                    // Get current highlight color from editor attributes
                    const currentHighlight = editor.getAttributes('highlight')
                    const currentColor = currentHighlight?.color
                    const isActive = currentColor === color
                    
                    return (
                      <button
                        key={color}
                        className={cn(
                          "w-6 h-6 rounded border transition-all",
                          isActive ? "ring-2 ring-primary ring-offset-1" : "border-border"
                        )}
                        style={{ backgroundColor: color }}
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          
                          // If already highlighted with this color, remove highlight
                          if (isActive) {
                            // Use transaction API to remove highlight mark
                            const { state, dispatch } = editor.view
                            const { from, to } = state.selection
                            const markType = state.schema.marks.highlight
                            
                            if (markType) {
                              const tr = state.tr.removeMark(from, to, markType)
                              dispatch(tr)
                            } else {
                              // Fallback
                              editor.chain().focus().unsetHighlight().run()
                            }
                          } else {
                            // Otherwise, set the new highlight color (this will replace existing highlight)
                            editor.chain().focus().setHighlight({ color }).run()
                          }
                        }}
                        title={isActive ? `Remove ${color} highlight` : `Apply ${color} highlight`}
                      />
                    )
                  })}
                </div>
              </div>
            </PopoverContent>
          </Popover>
        )}

        {/* Separator - Only show if not minimal */}
        {!minimalFeatures && <Separator orientation="vertical" className="h-6" />}

        {/* Basic Formatting */}
        <Button
          variant={editor.isActive("bold") ? "default" : "ghost"}
          size="sm"
          onClick={() => safeCommand(editor, "toggleBold")}
          className="h-8 w-8 p-0"
          type="button"
        >
          <Bold className="h-4 w-4" />
        </Button>

        <Button
          variant={editor.isActive("italic") ? "default" : "ghost"}
          size="sm"
          onClick={() => safeCommand(editor, "toggleItalic")}
          className="h-8 w-8 p-0"
          type="button"
        >
          <Italic className="h-4 w-4" />
        </Button>

        {/* Underline - Only show if not minimal (Underline extension not loaded in minimal mode) */}
        {!minimalFeatures && (
          <Button
            variant={editor.isActive("underline") ? "default" : "ghost"}
            size="sm"
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            className="h-8 w-8 p-0"
            type="button"
          >
            <Underline className="h-4 w-4" />
          </Button>
        )}

        <Separator orientation="vertical" className="h-6" />

        {/* Link & Image - URL group */}
        <Popover open={linkPopoverOpen} onOpenChange={handleLinkPopoverOpenChange}>
          <PopoverTrigger asChild>
            <Button
              variant={editor.isActive("link") ? "default" : "ghost"}
              size="sm"
              className="h-8 w-8 p-0"
              type="button"
              title="Add or edit link"
            >
              <Link2 className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="tiptap-popover-content w-80" align="start" onOpenAutoFocus={(e) => e.preventDefault()}>
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="link-url">URL</Label>
                <Input
                  id="link-url"
                  type="url"
                  placeholder="https://example.com"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      handleSetLink()
                    }
                  }}
                />
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="link-new-tab"
                  checked={openInNewTab}
                  onCheckedChange={(checked) => setOpenInNewTab(checked === true)}
                />
                <Label htmlFor="link-new-tab" className="cursor-pointer text-sm font-normal">
                  Open in new tab
                </Label>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleSetLink} disabled={!linkUrl.trim()}>
                  Set link
                </Button>
                {editor.isActive("link") && (
                  <Button size="sm" variant="outline" onClick={handleRemoveLink}>
                    Remove link
                  </Button>
                )}
              </div>
            </div>
          </PopoverContent>
        </Popover>

        {!minimalFeatures && (
          <Popover open={imagePopoverOpen} onOpenChange={handleImagePopoverOpenChange}>
            <PopoverTrigger asChild>
              <Button
                variant={isImageSelected ? "default" : "ghost"}
                size="sm"
                className="h-8 w-8 p-0"
                type="button"
                title={isImageSelected ? "Edit image" : "Insert image"}
              >
                <ImageIcon className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="tiptap-popover-content w-80" align="start" onOpenAutoFocus={(e) => e.preventDefault()}>
              <div className="space-y-3">
                {isImageSelected && (
                  <p className="text-sm text-muted-foreground">Image selected. Edit attributes below or use the toolbar to align.</p>
                )}
                {!isImageSelected && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full justify-start"
                      onClick={handleOpenMediaManager}
                    >
                      <FolderOpen className="h-4 w-4 mr-2" />
                      Browse media library
                    </Button>
                    <div className="relative">
                      <div className="absolute inset-0 flex items-center">
                        <span className="w-full border-t" />
                      </div>
                      <div className="relative flex justify-center text-xs uppercase">
                        <span className="bg-popover px-2 text-muted-foreground">or enter URL</span>
                      </div>
                    </div>
                  </>
                )}
                <div className="space-y-2">
                  <Label htmlFor="image-url">Image URL</Label>
                  <Input
                    id="image-url"
                    type="url"
                    placeholder="https://example.com/image.jpg"
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault()
                        handleInsertOrUpdateImage()
                      }
                    }}
                  />
                  <p className="text-xs text-muted-foreground">Where the picture loads from.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="image-alt">Alt text (optional)</Label>
                  <Input
                    id="image-alt"
                    type="text"
                    placeholder="Description of the image"
                    value={imageAlt}
                    onChange={(e) => setImageAlt(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">Shown if the image fails to load; helps accessibility.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="image-href">Link URL (optional)</Label>
                  <Input
                    id="image-href"
                    type="url"
                    placeholder="https://example.com"
                    value={imageHref}
                    onChange={(e) => setImageHref(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Optional. If set, clicking the image opens this URL (use https://…).
                  </p>
                </div>
                <Button
                  size="sm"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={handleInsertOrUpdateImage}
                  disabled={!isImageSelected && !imageUrl.trim()}
                >
                  {isImageSelected ? "Update image" : "Insert image"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  Tip: Select the image and drag the handle at the bottom-right corner to resize. Use alignment buttons to center.
                </p>
              </div>
            </PopoverContent>
          </Popover>
        )}

        <Separator orientation="vertical" className="h-6" />

        {/* Lists */}
        <Button
          variant={editor.isActive("bulletList") ? "default" : "ghost"}
          size="sm"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className="h-8 w-8 p-0"
          type="button"
        >
          <List className="h-4 w-4" />
        </Button>
        <Button
          variant={editor.isActive("orderedList") ? "default" : "ghost"}
          size="sm"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className="h-8 w-8 p-0"
          type="button"
        >
          <ListOrdered className="h-4 w-4" />
        </Button>
      
        {/* Text Alignment - Only show if not minimal */}
        {!minimalFeatures && (
          <>
            <Button
              variant={editor.isActive({ textAlign: "left" }) ? "default" : "ghost"}
              size="sm"
              onClick={() => editor.chain().focus().setTextAlign("left").run()}
              className="h-8 w-8 p-0"
              type="button"
            >
              <AlignLeft className="h-4 w-4" />
            </Button>
            <Button
              variant={editor.isActive({ textAlign: "center" }) ? "default" : "ghost"}
              size="sm"
              onClick={() => editor.chain().focus().setTextAlign("center").run()}
              className="h-8 w-8 p-0"
              type="button"
            >
              <AlignCenter className="h-4 w-4" />
            </Button>
            <Button
              variant={editor.isActive({ textAlign: "right" }) ? "default" : "ghost"}
              size="sm"
              onClick={() => editor.chain().focus().setTextAlign("right").run()}
              className="h-8 w-8 p-0"
              type="button"
            >
              <AlignRight className="h-4 w-4" />
            </Button>
            <Button
              variant={editor.isActive({ textAlign: "justify" }) ? "default" : "ghost"}
              size="sm"
              onClick={() => editor.chain().focus().setTextAlign("justify").run()}
              className="h-8 w-8 p-0"
              type="button"
            >
              <AlignJustify className="h-4 w-4" />
            </Button>

            <Separator orientation="vertical" className="h-6" />
          </>
        )}

        {/* Quote - Only show if not minimal */}
        {!minimalFeatures && (
          <Button
            variant={editor.isActive("blockquote") ? "default" : "ghost"}
            size="sm"
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            className="h-8 w-8 p-0"
            type="button"
          >
            <Quote className="h-4 w-4" />
          </Button>
        )}

        {/* Table with Grid Selector - Only show if not minimal */}
        {!minimalFeatures && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0" type="button">
                <Table className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="tiptap-popover-content w-auto p-0">
              <TableGridSelector onSelectTable={(rows, cols) => addTable(editor, rows, cols)} />
            </PopoverContent>
          </Popover>
        )}

        {/* Horizontal Rule - Only show if not minimal */}
        {!minimalFeatures && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => addHorizontalRule(editor)}
            className="h-8 w-8 p-0"
            title="Insert horizontal line"
            type="button"
          >
            <Minus className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Third Row */}
      <div className="flex items-center gap-1">
        {/* Code View Toggle - Show raw HTML in all modes */}
        {onToggleCodeView && (
          <Button
            variant={showCodeView ? "default" : "ghost"}
            size="sm"
            onClick={onToggleCodeView}
            className="h-8 w-8 p-0"
            title="Toggle raw HTML view"
            type="button"
          >
            <Code className="h-4 w-4" />
          </Button>
        )}

        {/* Undo/Redo - Only show if not minimal (users can use Ctrl+Z/Ctrl+Y) */}
        {!minimalFeatures && (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => editor.chain().focus().undo().run()}
              className="h-8 w-8 p-0"
              disabled={!editor.can().undo()}
              title="Undo (Ctrl+Z)"
              type="button"
            >
              <Undo className="h-4 w-4" />
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => editor.chain().focus().redo().run()}
              className="h-8 w-8 p-0"
              disabled={!editor.can().redo()}
              title="Redo (Ctrl+Y)"
              type="button"
            >
              <Redo className="h-4 w-4" />
            </Button>
          </>
        )}

        {/* Fullscreen Toggle - Only show if not minimal */}
        {!minimalFeatures && onToggleFullscreen && (
          <Button
            variant={isFullscreen ? "default" : "ghost"}
            size="sm"
            onClick={onToggleFullscreen}
            className="h-8 w-8 p-0"
            title={isFullscreen ? "Exit fullscreen (Esc)" : "Fullscreen"}
            type="button"
          >
            {isFullscreen ? (
              <Minimize className="h-4 w-4" />
            ) : (
              <Maximize className="h-4 w-4" />
            )}
          </Button>
        )}
      </div>

      {/* Media Manager for image selection - only in full editor */}
      {!minimalFeatures && (
        <MediaManager
          isOpen={isMediaManagerOpen}
          onClose={handleMediaManagerClose}
          onFileSelected={handleMediaSelect}
          title="Select image"
          description="Images for email must come from the public media library so links do not expire."
          allowedTypes={["image/*"]}
          maxFileSize={5 * 1024 * 1024}
          isPublic
          contentType="media"
          emitPersistableUrls
        />
      )}
    </div>
  )
}
