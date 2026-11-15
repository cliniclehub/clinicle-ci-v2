"use client"

import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { Code } from "lucide-react"

interface TemplateVariablesDialogProps {
  templateData: Record<string, any> | null | undefined
  trigger?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function TemplateVariablesDialog({ 
  templateData, 
  trigger,
  open,
  onOpenChange 
}: TemplateVariablesDialogProps) {
  // Don't render if no template data
  if (!templateData || Object.keys(templateData).length === 0) {
    return null
  }

  const defaultTrigger = (
    <Button
      variant="ghost"
      size="sm"
      title="View template variables"
    >
      <Code className="h-4 w-4" />
    </Button>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        {trigger || defaultTrigger}
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Template Variables</DialogTitle>
          <DialogDescription>
            Template variables used for this email
          </DialogDescription>
        </DialogHeader>
        <div className="bg-muted border rounded-lg p-4">
          <pre className="text-xs overflow-x-auto font-mono max-h-96 overflow-y-auto">
            {JSON.stringify(templateData, null, 2)}
          </pre>
        </div>
      </DialogContent>
    </Dialog>
  )
}


























