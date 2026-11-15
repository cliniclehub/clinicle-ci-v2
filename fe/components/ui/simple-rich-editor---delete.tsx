"use client"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils/cn"
import { Bold, Heading, Italic, List, ListOrdered, Redo, Undo } from "lucide-react"
import { useEffect, useRef, useState } from "react"

interface SimpleRichEditorProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
}

export function SimpleRichEditor({
  value,
  onChange,
  placeholder = "Enter content...",
  className,
  disabled = false,
}: SimpleRichEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const [isFocused, setIsFocused] = useState(false)
  const lastValueRef = useRef<string>("")
  const isInternalChangeRef = useRef<boolean>(false)
  const isInitializedRef = useRef<boolean>(false)
  const savedSelectionRef = useRef<Range | null>(null)
  
  // Initialize editor content on mount
  useEffect(() => {
    if (editorRef.current && !isInitializedRef.current) {
      editorRef.current.innerHTML = value || ""
      lastValueRef.current = value || ""
      isInitializedRef.current = true
    }
  }, [value])
  
  // Update editor content only when value changes externally (not from user typing)
  useEffect(() => {
    if (editorRef.current && isInitializedRef.current && !isFocused && value !== lastValueRef.current && !isInternalChangeRef.current) {
      // Save cursor position before updating
      const selection = window.getSelection()
      const savedRange = selection?.rangeCount ? selection.getRangeAt(0) : null
      
      // Update content
      editorRef.current.innerHTML = value || ""
      lastValueRef.current = value || ""
      
      // Try to restore cursor position
      if (savedRange && editorRef.current.contains(savedRange.startContainer)) {
        try {
          selection?.removeAllRanges()
          selection?.addRange(savedRange)
        } catch (e) {
          // If restoration fails, just place cursor at end
          const newRange = document.createRange()
          newRange.selectNodeContents(editorRef.current)
          newRange.collapse(false)
          selection?.removeAllRanges()
          selection?.addRange(newRange)
        }
      }
    }
  }, [value, isFocused])

  // Save selection range for restoring when buttons are clicked
  const saveSelection = () => {
    if (window.getSelection) {
      const sel = window.getSelection()
      if (sel?.rangeCount) {
        return sel.getRangeAt(0)
      }
    }
    return null
  }

  const restoreSelection = (range: Range | null) => {
    if (range && window.getSelection) {
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    }
  }

  const handleCommand = (command: string, value?: string) => {
    if (disabled || !editorRef.current) return
    
    // Use saved selection if available, otherwise try to get current selection
    let savedRange = savedSelectionRef.current || saveSelection()
    
    // Focus the editor if it's not already focused
    editorRef.current.focus()
    
    // Small delay to ensure focus is established
    setTimeout(() => {
      try {
        // Restore selection before executing command
        if (savedRange) {
          restoreSelection(savedRange)
        }
        
        // Handle heading specially
        if (command === "formatBlock") {
          document.execCommand("formatBlock", false, value || "<p>")
        } 
        // Handle other commands
        else if (value) {
          document.execCommand(command, false, value)
        } else {
          document.execCommand(command, false)
        }
        
        // Update parent with new content
        handleChange()
        
        // Update selection state after command
        handleSelectionChange()
      } catch (error) {
        console.error(`Error executing command ${command}:`, error)
      }
    }, 10)
  }

  const handleChange = () => {
    if (editorRef.current) {
      const newContent = editorRef.current.innerHTML
      // Mark this as an internal change to prevent useEffect from resetting content
      isInternalChangeRef.current = true
      lastValueRef.current = newContent
      onChange(newContent)
      // Reset flag after a brief delay to allow parent state to update
      setTimeout(() => {
        isInternalChangeRef.current = false
      }, 0)
    }
  }

  // Track selection for toolbar button state
  const [selectionState, setSelectionState] = useState({
    isBold: false,
    isItalic: false,
    isHeading: false,
    isUnorderedList: false,
    isOrderedList: false
  })

  // Update selection state when selection changes
  const handleSelectionChange = () => {
    if (!window.getSelection || !editorRef.current?.contains(window.getSelection()?.anchorNode || null)) {
      return
    }
    
    setSelectionState({
      isBold: document.queryCommandState('bold'),
      isItalic: document.queryCommandState('italic'),
      isHeading: document.queryCommandValue('formatBlock') === 'h2',
      isUnorderedList: document.queryCommandState('insertUnorderedList'),
      isOrderedList: document.queryCommandState('insertOrderedList')
    })
  }

  // Add selection change listener and save selection when editor is focused
  useEffect(() => {
    const handleSelectionSave = () => {
      if (editorRef.current && isFocused) {
        const selection = window.getSelection()
        if (selection?.rangeCount && editorRef.current.contains(selection.anchorNode)) {
          savedSelectionRef.current = selection.getRangeAt(0).cloneRange()
        }
      }
    }
    
    document.addEventListener('selectionchange', handleSelectionChange)
    document.addEventListener('selectionchange', handleSelectionSave)
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange)
      document.removeEventListener('selectionchange', handleSelectionSave)
    }
  }, [isFocused])

  // Toggle heading function (more reliable than formatBlock)
  const toggleHeading = () => {
    if (disabled || !editorRef.current) return
    
    // Use saved selection if available, otherwise try to get current selection
    let savedRange = savedSelectionRef.current || saveSelection()
    
    // Focus the editor
    editorRef.current.focus()
    
    // Small delay to ensure focus is established
    setTimeout(() => {
      try {
        // Restore selection
        if (savedRange) {
          restoreSelection(savedRange)
        }
        
        const selection = window.getSelection()
        if (!selection?.rangeCount) return
        
        const range = selection.getRangeAt(0)
        let container = range.commonAncestorContainer
        
        // Navigate up to the element node if we're in a text node
        while (container.nodeType === Node.TEXT_NODE) {
          container = container.parentNode as Node
        }
        
        // Check if current selection is already in a heading
        const isInHeading = (container as Element).tagName === 'H2' ||
          (container.parentElement && container.parentElement.tagName === 'H2')
        
        // Toggle between heading and paragraph
        if (isInHeading) {
          // If already a heading, convert to paragraph
          document.execCommand('formatBlock', false, '<p>')
        } else {
          // If not a heading, convert to heading
          document.execCommand('formatBlock', false, '<h2>')
        }
        
        // Update content after change
        handleChange()
        
        // Update selection state after command
        handleSelectionChange()
      } catch (error) {
        console.error('Error toggling heading:', error)
      }
    }, 10)
  }

  return (
    <div className={cn("border rounded-md overflow-hidden", className)}>
      <div className="border-b bg-muted/50 p-2 flex flex-wrap gap-1">
        <Button
          type="button"
          variant={selectionState.isBold ? "secondary" : "ghost"}
          size="sm"
          onMouseDown={(e) => {
            e.preventDefault() // Prevent editor from losing focus
            handleCommand("bold")
          }}
          disabled={disabled}
        >
          <Bold className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant={selectionState.isItalic ? "secondary" : "ghost"}
          size="sm"
          onMouseDown={(e) => {
            e.preventDefault() // Prevent editor from losing focus
            handleCommand("italic")
          }}
          disabled={disabled}
        >
          <Italic className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant={selectionState.isHeading ? "secondary" : "ghost"}
          size="sm"
          onMouseDown={(e) => {
            e.preventDefault() // Prevent editor from losing focus
            toggleHeading()
          }}
          disabled={disabled}
        >
          <Heading className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant={selectionState.isUnorderedList ? "secondary" : "ghost"}
          size="sm"
          onMouseDown={(e) => {
            e.preventDefault() // Prevent editor from losing focus
            handleCommand("insertUnorderedList")
          }}
          disabled={disabled}
        >
          <List className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant={selectionState.isOrderedList ? "secondary" : "ghost"}
          size="sm"
          onMouseDown={(e) => {
            e.preventDefault() // Prevent editor from losing focus
            handleCommand("insertOrderedList")
          }}
          disabled={disabled}
        >
          <ListOrdered className="h-4 w-4" />
        </Button>
        <div className="flex-1"></div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => handleCommand("undo")}
          disabled={disabled}
        >
          <Undo className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => handleCommand("redo")}
          disabled={disabled}
        >
          <Redo className="h-4 w-4" />
        </Button>
      </div>
      <div
        ref={editorRef}
        className="p-3 min-h-[200px] focus:outline-none prose prose-sm max-w-none"
        contentEditable={!disabled}
        onInput={handleChange}
        onFocus={() => setIsFocused(true)}
        onBlur={() => {
          setIsFocused(false)
          // Update lastValueRef when blurring to sync with external changes
          if (editorRef.current) {
            lastValueRef.current = editorRef.current.innerHTML
          }
        }}
        onKeyUp={handleSelectionChange}
        onMouseUp={handleSelectionChange}
        suppressContentEditableWarning
      />
    </div>
  )
} 