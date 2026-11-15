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
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { updateSavedFilter } from "@/lib/actions/saved-filter-actions"
import { SavedFilter } from "@/lib/types/filter-schema"

interface EditFilterDialogProps {
  open: boolean
  onClose: () => void
  onUpdate: () => void
  savedFilter: SavedFilter | null
}

export function EditFilterDialog({
  open,
  onClose,
  onUpdate,
  savedFilter,
}: EditFilterDialogProps) {
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [isDefault, setIsDefault] = useState(false)
  const [updating, setUpdating] = useState(false)

  // Helper functions for safe access
  const getGroupCount = () => {
    return savedFilter?.filterConfig?.groups?.length || 0
  }

  const getConditionCount = () => {
    return savedFilter?.filterConfig?.groups?.reduce((total: number, group: any) => 
      total + (group.conditions?.length || 0), 0) || 0
  }

  // Reset form when dialog opens with new filter data
  useEffect(() => {
    if (open && savedFilter) {
      setName(savedFilter.name)
      setDescription(savedFilter.description || "")
      setIsDefault(savedFilter.isDefault)
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
        isDefault: isDefault,
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
    setIsDefault(false)
    onClose()
  }

  if (!savedFilter) return null

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Edit className="h-5 w-5" />
            Edit Filter
          </DialogTitle>
          <DialogDescription>
            Update the details of your saved filter.
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

          <div className="flex items-center space-x-2">
            <Switch
              id="is-default"
              checked={isDefault}
              onCheckedChange={setIsDefault}
            />
            <Label htmlFor="is-default">Set as default filter for this page</Label>
          </div>

          <div className="p-3 bg-muted/50 rounded-lg">
            <p className="text-sm text-muted-foreground mb-2">Filter Configuration:</p>
            <p className="text-xs text-muted-foreground">
              {getGroupCount()} group{getGroupCount() !== 1 ? 's' : ''} • 
              {getConditionCount()} condition{getConditionCount() !== 1 ? 's' : ''}
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