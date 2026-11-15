"use client"

import { Download } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"

interface ExportField {
  id: string
  label: string
  checked: boolean
}

interface ExportUsersDialogProps {
  open: boolean
  onClose: () => void
  onExport: (selectedFields: string[], data: any[]) => void
  data: any[]
  loading?: boolean
}

// Default export fields for platform admin
const PLATFORM_EXPORT_FIELDS: ExportField[] = [
  { id: "id", label: "User ID", checked: true },
  { id: "email", label: "Email Address", checked: true },
  { id: "firstName", label: "First Name", checked: true },
  { id: "lastName", label: "Last Name", checked: true },
  { id: "phoneNumber", label: "Phone Number", checked: true },
  { id: "organizationName", label: "Organization", checked: true },
  { id: "organizationDomain", label: "Organization Domain", checked: false },
  { id: "roles", label: "Roles", checked: true },
  { id: "locked", label: "Account Status", checked: true },
  { id: "createdAt", label: "Created Date", checked: true },
  { id: "updatedAt", label: "Last Updated", checked: false },
]

// Default export fields for organization admin
const ORG_EXPORT_FIELDS: ExportField[] = [
  { id: "id", label: "User ID", checked: true },
  { id: "email", label: "Email Address", checked: true },
  { id: "firstName", label: "First Name", checked: true },
  { id: "lastName", label: "Last Name", checked: true },
  { id: "phoneNumber", label: "Phone Number", checked: true },
  { id: "roles", label: "Roles", checked: true },
  { id: "locked", label: "Account Status", checked: true },
  { id: "createdAt", label: "Created Date", checked: true },
  { id: "updatedAt", label: "Last Updated", checked: false },
]

export function ExportUsersDialog({
  open,
  onClose,
  onExport,
  data,
  loading = false,
}: ExportUsersDialogProps) {
  const [fields, setFields] = useState<ExportField[]>(() => {
    // Initialize with default fields based on data type
    const defaultFields = data.length > 0 && data[0].organizationName 
      ? PLATFORM_EXPORT_FIELDS 
      : ORG_EXPORT_FIELDS
    return defaultFields.map(field => ({ ...field }))
  })

  const allSelected = fields.every((field) => field.checked)
  const someSelected = fields.some((field) => field.checked)

  const handleSelectAll = (checked: boolean) => {
    setFields(fields.map((field) => ({ ...field, checked })))
  }

  const handleFieldToggle = (fieldId: string, checked: boolean) => {
    setFields(fields.map((field) => (field.id === fieldId ? { ...field, checked } : field)))
  }

  const handleExport = () => {
    if (!someSelected) {
      toast.error("Please select at least one field to export")
      return
    }

    if (data.length === 0) {
      toast.error("No data to export")
      return
    }

    const selectedFields = fields.filter(field => field.checked).map(field => field.id)
    onExport(selectedFields, data)
    onClose()
  }

  const handleClose = () => {
    // Reset fields to defaults when closing
    const defaultFields = data.length > 0 && data[0].organizationName 
      ? PLATFORM_EXPORT_FIELDS 
      : ORG_EXPORT_FIELDS
    setFields(defaultFields.map(field => ({ ...field })))
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
              <Download className="h-4 w-4 text-primary" />
            </div>
            <DialogTitle className="text-xl font-semibold">Export Users</DialogTitle>
          </div>
          <DialogDescription className="text-sm text-muted-foreground">
            Select the fields you want to export from{" "}
            <span className="font-medium text-foreground">
              {data.length} user{data.length !== 1 ? 's' : ''}
            </span>{" "}
            in your current search results.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Separator />

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="select-all"
                  checked={allSelected}
                  onCheckedChange={handleSelectAll}
                  className="data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                />
                <label
                  htmlFor="select-all"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  Select All Fields
                </label>
              </div>
            </div>

            <div className="grid gap-3">
              {fields.map((field) => (
                <div
                  key={field.id}
                  className="flex items-center space-x-3 rounded-lg border p-3 hover:bg-muted/50 transition-colors"
                >
                  <Checkbox
                    id={field.id}
                    checked={field.checked}
                    onCheckedChange={(checked) => handleFieldToggle(field.id, checked as boolean)}
                    className="data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                  />
                  <label
                    htmlFor={field.id}
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer flex-1"
                  >
                    {field.label}
                  </label>
                </div>
              ))}
            </div>
          </div>

          <Separator />

          <div className="flex justify-between gap-3">
            <Button variant="outline" onClick={handleClose} className="flex-1">
              Cancel
            </Button>
            <Button 
              onClick={handleExport} 
              disabled={!someSelected || loading} 
              className="flex-1 gap-2"
            >
              <Download className="w-4 h-4" />
              {loading ? "Exporting..." : `Export ${data.length} Users`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}