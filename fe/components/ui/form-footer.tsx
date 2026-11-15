"use client"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils/cn"
import { AlertCircle, Loader2 } from "lucide-react"

interface FormFooterProps {
  onSave?: () => void
  onCancel?: () => void
  isSaving?: boolean
  isDirty?: boolean
  isValid?: boolean
  saveLabel?: string
  cancelLabel?: string
  className?: string
  sticky?: boolean
}

export function FormFooter({
  onSave,
  onCancel,
  isSaving = false,
  isDirty = false,
  isValid = true,
  saveLabel = "Save",
  cancelLabel = "Cancel",
  className,
  sticky = true,
}: FormFooterProps) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-wrap items-center justify-end gap-4 border-t bg-background px-4 py-4 sm:px-6",
        sticky && "sticky bottom-0 z-10",
        className
      )}
    >
      {isDirty && (
        <div className="flex min-w-0 max-w-full flex-1 items-center gap-2 border border-red-500 bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400 rounded-md px-4 py-2 mr-auto text-sm">
          <AlertCircle className="h-5 w-5 text-red-500" />
          <span>You have unsaved changes</span>
        </div>
      )}
      
      {onCancel && (
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isSaving}
        >
          {cancelLabel}
        </Button>
      )}
      
      {onSave && (
        <Button
          type="button"
          onClick={onSave}
          disabled={isSaving || !isDirty || !isValid}
        >
          {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {saveLabel}
        </Button>
      )}
    </div>
  )
}