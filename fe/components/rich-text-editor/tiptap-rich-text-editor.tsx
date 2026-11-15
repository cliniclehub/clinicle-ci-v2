"use client"

import type React from "react"

import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils/cn"
import { Extension, type RawCommands } from "@tiptap/core"
import Color from "@tiptap/extension-color"
import FontFamily from "@tiptap/extension-font-family"
import Highlight from "@tiptap/extension-highlight"
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table"
import TextAlign from "@tiptap/extension-text-align"
import { TextStyle } from "@tiptap/extension-text-style"
import { Placeholder } from "@tiptap/extensions"
import { Editor, EditorContent, useEditor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import { StyledLink } from "./extensions/styled-link"
import { useCallback, useEffect, useRef, useState } from "react"
import { ResizableImage } from "./extensions/resizable-image"
import { TableControls } from "./table-controls"
import { TiptapToolbar } from "./tiptap-toolbar"

// Custom extension to preserve HTML structure
const PreserveHtml = Extension.create({
  name: 'preserveHtml',
  
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading', 'listItem'],
        attributes: {
          'data-preserve': {
            default: null,
            parseHTML: (element: HTMLElement) => element.getAttribute('data-preserve'),
            renderHTML: (attributes: any) => {
              if (!attributes['data-preserve']) return {}
              return { 'data-preserve': attributes['data-preserve'] }
            },
          },
        },
      },
    ]
  },
})

// Custom FontSize extension
const FontSize = Extension.create({
  name: "fontSize",

  addOptions() {
    return {
      types: ["textStyle"],
    }
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element) => element.style.fontSize?.replace(/['"]+/g, ""),
            renderHTML: (attributes) => {
              if (!attributes.fontSize) {
                return {}
              }

              return {
                style: `font-size: ${attributes.fontSize}`,
              }
            },
          },
        },
      },
    ]
  },

  addCommands() {
    return {
      setFontSize:
        (fontSize: string) =>
        ({ editor }: { editor: Editor }) => {
          return editor.chain().setMark("textStyle", { fontSize }).run();
        },
      unsetFontSize:
        () =>
        ({ editor }: { editor: Editor }) => {
          return editor.chain().setMark("textStyle", { fontSize: null }).removeEmptyTextStyle().run();
        },
    } as Partial<RawCommands>;
  },
})

interface TiptapRichTextEditorProps {
  placeholder?: string
  initialContent?: string
  value?: string // Support controlled component API (for backward compatibility)
  onChange?: (content: string) => void
  className?: string
  onBlur?: () => void
  'data-error'?: boolean | string
  editable?: boolean
  minimalFeatures?: boolean
  minHeight?: string // Custom minimum height (e.g., '50px', '80px')
  maxHeight?: string // Custom maximum height (e.g., '100px', '200px')
  resizable?: boolean // Allow vertical drag resize on the editor area
}

export function TiptapRichTextEditor({
  placeholder = "Start typing...",
  initialContent,
  value,
  onChange,
  className = "",
  onBlur,
  'data-error': dataError,
  editable = true,
  minimalFeatures = false,
  minHeight = '300px',
  maxHeight = '500px',
  resizable = false,
}: TiptapRichTextEditorProps) {
  // Support both controlled (value) and uncontrolled (initialContent) APIs
  const content = value !== undefined ? value : (initialContent || "")
  const [showCodeView, setShowCodeView] = useState(false)
  const [htmlContent, setHtmlContent] = useState(content)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const editorContainerRef = useRef<HTMLDivElement>(null)
  const editorSurfaceRef = useRef<HTMLDivElement>(null)
  const [showPreview, setShowPreview] = useState(false)
  const [showHtmlModal, setShowHtmlModal] = useState(false)
  const isUpdatingRef = useRef(false)

  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    extensions: [
      PreserveHtml,
      ...(placeholder.trim()
        ? [
            Placeholder.configure({
              placeholder,
              showOnlyWhenEditable: true,
              emptyEditorClass: "is-editor-empty",
            }),
          ]
        : []),
      StarterKit.configure({
        // StyledLink replaces the default Link mark (email CTA styles).
        link: false,
        // Keep underline only in the full editor (previous TipTap 2 behavior).
        ...(minimalFeatures ? { underline: false as const } : {}),
        // Configure paragraph to preserve line breaks
        paragraph: {
          HTMLAttributes: {
            class: 'mb-2',
          },
        },
        // Configure hard break to preserve line breaks
        hardBreak: {
          HTMLAttributes: {
            class: 'break-all',
          },
        },
        // Configure codeBlock to properly handle special characters
        codeBlock: {
          HTMLAttributes: {
            class: 'bg-muted p-4 rounded font-mono text-sm overflow-x-auto',
          },
        },
        // Configure code (inline code) to properly handle special characters
        code: {
          HTMLAttributes: {
            class: 'bg-muted px-1 py-0.5 rounded font-mono text-sm',
          },
        },
      }),
      StyledLink.configure({
        openOnClick: false,
        autolink: false,
      }),
      ...(minimalFeatures ? [] : [
        TextAlign.configure({
          types: ["heading", "paragraph", "resizableImage"],
        }),
        Table.configure({
          resizable: true,
          handleWidth: 5,
          cellMinWidth: 25,
          allowTableNodeSelection: true,
          HTMLAttributes: {
            style: "border: 2px solid hsl(var(--border)); border-collapse: collapse;",
          },
        }).extend({
          addAttributes() {
            return {
              ...this.parent?.(),
              style: {
                default: "border: 2px solid hsl(var(--border)); border-collapse: collapse;",
                parseHTML: (element) => element.getAttribute("style"),
                renderHTML: (attributes) => {
                  if (!attributes.style) {
                    return { style: "border: 2px solid hsl(var(--border)); border-collapse: collapse;" }
                  }
                  return { style: attributes.style }
                },
              },
            }
          },
        }),
        TableRow.extend({
          allowGapCursor: false,
        }),
        TableHeader.extend({
          addAttributes() {
            return {
              ...this.parent?.(),
              colspan: {
                default: 1,
                parseHTML: (element) => {
                  const colspan = element.getAttribute("colspan")
                  return colspan ? Number.parseInt(colspan, 10) : 1
                },
              },
              rowspan: {
                default: 1,
                parseHTML: (element) => {
                  const rowspan = element.getAttribute("rowspan")
                  return rowspan ? Number.parseInt(rowspan, 10) : 1
                },
              },
              style: {
                default: "border: 1px solid hsl(var(--border)); padding: 0.75em; background-color: hsl(var(--muted));",
                parseHTML: (element) => element.getAttribute("style"),
                renderHTML: (attributes) => {
                  if (!attributes.style) {
                    return { style: "border: 1px solid hsl(var(--border)); padding: 0.75em; background-color: hsl(var(--muted));" }
                  }
                  return { style: attributes.style }
                },
              },
            }
          },
        }),
        TableCell.extend({
          addAttributes() {
            return {
              ...this.parent?.(),
              colspan: {
                default: 1,
                parseHTML: (element) => {
                  const colspan = element.getAttribute("colspan")
                  return colspan ? Number.parseInt(colspan, 10) : 1
                },
              },
              rowspan: {
                default: 1,
                parseHTML: (element) => {
                  const rowspan = element.getAttribute("rowspan")
                  return rowspan ? Number.parseInt(rowspan, 10) : 1
                },
              },
              style: {
                default: "border: 1px solid hsl(var(--border)); padding: 0.75em;",
                parseHTML: (element) => element.getAttribute("style"),
                renderHTML: (attributes) => {
                  if (!attributes.style) {
                    return { style: "border: 1px solid hsl(var(--border)); padding: 0.75em;" }
                  }
                  return { style: attributes.style }
                },
              },
            }
          },
        }),
        Color,
        TextStyle,
        FontFamily,
        Highlight.configure({
          multicolor: true,
        }),
        FontSize,
        ResizableImage,
      ]),
    ],
    content: content,
    editable,
    onUpdate: ({ editor }) => {
      if (isUpdatingRef.current) return;
      
      try {
        const html = editor.getHTML();
        setHtmlContent(html);
        onChange?.(html);
      } catch (error) {
        console.warn('Error in editor onUpdate:', error);
      }
    },
    onCreate: ({ editor }) => {
      // Don't automatically set font family on create - let users choose
      // Only set default font family if editor is empty
      if (!minimalFeatures && !editor.getHTML().trim()) {
        // Only set default font if editor is completely empty
        const isEmpty = editor.state.doc.content.size <= 2 // Empty doc has minimal size
        if (isEmpty) {
          // Set default font family only for new empty editor
          editor.chain().setFontFamily("Arial").run();
        }
      }
      setHtmlContent(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class: "focus:outline-none min-h-[200px] p-4 bg-transparent text-foreground",
        // Don't set default font-family in style - let TextStyle extension handle it
      },
    },
  })

  // Update editor content when value/initialContent changes (controlled or uncontrolled)
  useEffect(() => {
    if (editor && content !== htmlContent && !editor.isDestroyed) {
      // Use requestAnimationFrame to ensure editor is ready and avoid transaction conflicts
      requestAnimationFrame(() => {
        if (editor.isDestroyed) return;
        
        isUpdatingRef.current = true;
        try {
          // TipTap 3: setContent(content, options) — emitUpdate:false matches prior 2nd-arg `false`
          editor.commands.setContent(content, { emitUpdate: false });
          setHtmlContent(content);
        } catch (error) {
          console.error('Error setting content:', error);
          // Fallback: try to set content as HTML
          try {
            editor.commands.setContent(content);
            setHtmlContent(content);
          } catch (fallbackError) {
            console.error('Fallback content setting also failed:', fallbackError);
          }
        } finally {
          // Use a small delay to ensure the update is complete before allowing new updates
          setTimeout(() => {
            isUpdatingRef.current = false;
          }, 0);
        }
      });
    }
  }, [editor, content, htmlContent]);

  const toggleCodeView = () => {
    if (showCodeView && editor) {
      // Switching from code view to editor view
      editor.commands.setContent(htmlContent)
    }
    setShowCodeView(!showCodeView)
  }

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen(!isFullscreen)
  }, [isFullscreen])

  const handleHtmlChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setHtmlContent(e.target.value)
    onChange?.(e.target.value)
  }

  // Handle ESC key to exit fullscreen
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isFullscreen) {
        setIsFullscreen(false)
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [isFullscreen])

  // Focus editor when entering fullscreen
  useEffect(() => {
    if (isFullscreen && editor) {
      editor.commands.focus()
    }
  }, [isFullscreen, editor])

  return (
    <div
      ref={editorContainerRef}
      className={`tiptap-editor-root w-full flex flex-col ${className}`}
      onClick={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
      onFocus={e => e.stopPropagation()}
    >
      <Card className={cn(
        "w-full flex-1 flex flex-col min-h-0 transition-colors",
        dataError ? "border-2 border-destructive" : "border"
      )}>
        <div className="sticky top-0 z-10 bg-background">
          {editor && (
            <TiptapToolbar
              editor={editor}
              onToggleCodeView={toggleCodeView}
              showCodeView={showCodeView}
              onToggleFullscreen={toggleFullscreen}
              isFullscreen={isFullscreen}
              minimalFeatures={minimalFeatures}
            />
          )}
        </div>
        <div
          ref={editorSurfaceRef}
          className={cn(
            "flex-1 border-t relative min-h-0 overflow-y-auto overflow-x-auto",
            resizable && "resize-y"
          )}
          style={{ minHeight, maxHeight }}
        >
          {showCodeView ? (
            <textarea
              value={htmlContent}
              onChange={handleHtmlChange}
              className="w-full h-full min-h-[200px] p-4 font-mono border-0 resize-none bg-background text-foreground focus:outline-none"
              style={{ 
                minHeight,
                maxHeight,
                overflowY: 'auto'
              }}
              aria-label="Raw HTML editor"
            />
          ) : (
            <>
              <EditorContent 
                editor={editor} 
                className="p-4 pb-12 pt-8 pl-10 block bg-transparent text-foreground"
                style={{ minHeight }}
                onBlur={onBlur}
              />
              {editor && !minimalFeatures && (
                <TableControls
                  editor={editor}
                  containerRef={editorSurfaceRef}
                  enabled={editable && !showCodeView}
                />
              )}
            </>
          )}
        </div>
        {showPreview && (
          <div className="border-t bg-muted">
            <div className="p-2 border-b bg-muted flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Preview</span>
              <button
                type="button"
                className="text-xs text-blue-600 hover:underline ml-2"
                onClick={() => setShowHtmlModal(true)}
                aria-label="Show HTML"
              >
                Show HTML
              </button>
            </div>
            <style>{`
              .tiptap-preview h1 { font-size: 1.875rem !important; font-weight: 800 !important; }
              .tiptap-preview h2 { font-size: 1.5rem !important; font-weight: 700 !important; }
              .tiptap-preview h3 { font-size: 1.25rem !important; font-weight: 600 !important; }
              .tiptap-preview h4 { font-size: 1.125rem !important; font-weight: 600 !important; }
            `}</style>
            <div
              className="p-4 tiptap-preview bg-background min-h-[100px]"
              dangerouslySetInnerHTML={{ __html: htmlContent }}
              style={{ fontFamily: "Arial, sans-serif" }}
            />
          </div>
        )}
      </Card>

      {showHtmlModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50" role="dialog" aria-modal="true">
          <div className="bg-background rounded shadow-lg max-w-2xl w-full p-6 relative">
            <button
              className="absolute top-2 right-2 text-muted-foreground hover:text-foreground text-lg"
              onClick={() => setShowHtmlModal(false)}
              aria-label="Close HTML preview"
            >
              &times;
            </button>
            <h2 className="text-base font-semibold mb-4">Raw HTML</h2>
            <pre className="bg-muted p-4 rounded border overflow-x-auto max-h-[60vh] whitespace-pre-wrap">
              {htmlContent}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}
