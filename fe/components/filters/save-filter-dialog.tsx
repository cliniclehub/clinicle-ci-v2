"use client"

import { Save } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { createSavedFilter } from "@/lib/actions/saved-filter-actions"
import { FilterState } from "@/lib/types/filter-schema"

interface SaveFilterDialogProps {
  open: boolean
  onClose: () => void
  onSave: () => void
  currentFilters: FilterState
  pageType: string
}

export function SaveFilterDialog({
  open,
  onClose,
  onSave,
  currentFilters,
  pageType,
}: SaveFilterDialogProps) {
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Please enter a name for this filter")
      return
    }

    setSaving(true)
    try {
      const result = await createSavedFilter({
        name: name.trim(),
        description: description.trim() || undefined,
        pageType: pageType,
        filterConfig: currentFilters,
        isDefault: false, // Always set to false for now
      })

      if (result.status === "success") {
        toast.success("Filter saved successfully")
        onSave()
        onClose()
        // Reset form
        setName("")
        setDescription("")
      } else {
        toast.error(result.message || "Failed to save filter")
      }
    } catch (error) {
      toast.error("Failed to save filter")
    } finally {
      setSaving(false)
    }
  }

  const handleClose = () => {
    // Reset form when closing
    setName("")
    setDescription("")
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Save className="h-5 w-5" />
            Save Filter
          </DialogTitle>
          <DialogDescription>
            Save your current filter configuration for future use.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="filter-name">Filter Name *</Label>
            <Input
              id="filter-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter a descriptive name..."
              maxLength={255}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="filter-description">Description</Label>
            <Textarea
              id="filter-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description of what this filter does..."
              rows={3}
            />
          </div>

          <div className="p-3 bg-muted/50 rounded-lg">
            <p className="text-sm text-muted-foreground mb-2">Filter Configuration:</p>
            <p className="text-xs text-muted-foreground">
              {currentFilters.groups.length} group{currentFilters.groups.length !== 1 ? 's' : ''} • 
              {currentFilters.groups.reduce((total, group) => total + group.conditions.length, 0)} condition{currentFilters.groups.reduce((total, group) => total + group.conditions.length, 0) !== 1 ? 's' : ''}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()}>
            <Save className="h-4 w-4 mr-2" />
            {saving ? "Saving..." : "Save Filter"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
} 