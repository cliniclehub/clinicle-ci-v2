"use client"

import { Edit, Save } from "lucide-react"
import { useEffect, useState } from "react"
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
import { updateSavedFilter } from "@/lib/actions/saved-filter-actions"
import { FilterState, SavedFilter } from "@/lib/types/filter-schema"

interface UpdateFilterDialogProps {
  open: boolean
  onClose: () => void
  onUpdate: () => void
  savedFilter: SavedFilter | null
  currentFilters: FilterState
}

export function UpdateFilterDialog({
  open,
  onClose,
  onUpdate,
  savedFilter,
  currentFilters,
}: UpdateFilterDialogProps) {
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [updating, setUpdating] = useState(false)

  // Reset form when dialog opens with new filter data
  useEffect(() => {
    if (open && savedFilter) {
      setName(savedFilter.name)
      setDescription(savedFilter.description || "")
    }
  }, [open, savedFilter])

  const handleUpdate = async () => {
    if (!savedFilter) return

    if (!name.trim()) {
      toast.error("Please enter a name for this filter")
      return
    }

    setUpdating(true)
    try {
      const result = await updateSavedFilter(savedFilter.id, {
        name: name.trim(),
        description: description.trim() || undefined,
        filterConfig: currentFilters, // Update with current filter configuration
        isDefault: savedFilter.isDefault, // Keep existing default status
      })

      if (result.status === "success") {
        toast.success("Filter updated successfully")
        onUpdate()
        onClose()
      } else {
        toast.error(result.message || "Failed to update filter")
      }
    } catch (error) {
      toast.error("Failed to update filter")
    } finally {
      setUpdating(false)
    }
  }

  const handleClose = () => {
    // Reset form when closing
    setName("")
    setDescription("")
    onClose()
  }

  if (!savedFilter) return null

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Edit className="h-5 w-5" />
            Update Filter
          </DialogTitle>
          <DialogDescription>
            Update the filter "{savedFilter.name}" with your current changes.
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
            <p className="text-sm text-muted-foreground mb-2">Updated Filter Configuration:</p>
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
          <Button onClick={handleUpdate} disabled={updating || !name.trim()}>
            <Save className="h-4 w-4 mr-2" />
            {updating ? "Updating..." : "Update Filter"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
} 
