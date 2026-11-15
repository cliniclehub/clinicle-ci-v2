"use client"

import { Clock, Edit, FolderOpen, Star, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { deleteSavedFilter, getSavedFilters } from "@/lib/actions/saved-filter-actions"
import { FilterState, SavedFilter } from "@/lib/types/filter-schema"
import { formatDate } from "@/lib/utils/date-time-helper"
import { createClientLogger } from "@/lib/utils/logger-client"
import { EditFilterDialog } from "./edit-filter-dialog"

interface LoadFilterDialogProps {
  open: boolean
  onClose: () => void
  onLoad: (filters: FilterState, savedFilter?: SavedFilter) => void
  pageType: string
}

export function LoadFilterDialog({
  open,
  onClose,
  onLoad,
  pageType,
}: LoadFilterDialogProps) {
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([])
  const [loading, setLoading] = useState(false)
  const [deletingFilter, setDeletingFilter] = useState<number | null>(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [filterToDelete, setFilterToDelete] = useState<SavedFilter | null>(null)
  const logger = createClientLogger("LoadFilterDialog")
  
  // Edit dialog state
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [filterToEdit, setFilterToEdit] = useState<SavedFilter | null>(null)

  useEffect(() => {
    if (open) {
      loadSavedFilters()
    }
  }, [open, pageType])

  const loadSavedFilters = async () => {
    setLoading(true)
    try {
      const result = await getSavedFilters(pageType)
      if (result.status === "success") {
        setSavedFilters(result.data || [])
      } else {
        toast.error(result.message || "Failed to load saved filters")
      }
    } catch (error) {
      toast.error("Failed to load saved filters")
    } finally {
      setLoading(false)
    }
  }

  const handleLoadFilter = (savedFilter: SavedFilter) => {
    const methodLogger = logger.forMethod("handleLoadFilter")
    try {
      methodLogger.debug('Loading savedFilter:', savedFilter) // Debug: log the entire savedFilter
      methodLogger.debug('filterConfig type:', typeof savedFilter.filterConfig) // Debug: check the type
      methodLogger.debug('filterConfig value:', savedFilter.filterConfig) // Debug: see the actual value
      
      let filterConfig: FilterState
      
      // Check if filterConfig exists
      if (!savedFilter.filterConfig) {
        methodLogger.error('filterConfig is missing or null', new Error('filterConfig is missing or null'), savedFilter.filterConfig)
        toast.error("Filter configuration is missing")
        return
      }
      
      // Check if filterConfig is a string (JSON) or already an object
      if (typeof savedFilter.filterConfig === 'string') {
        try {
          // Parse JSON string to FilterState object
          filterConfig = JSON.parse(savedFilter.filterConfig)
          methodLogger.debug('Parsed filterConfig from string:', filterConfig) // Debug: log parsed result
        } catch (parseError) {
          methodLogger.error('Failed to parse filterConfig JSON', parseError as Error)
          toast.error("Invalid filter configuration format")
          return
        }
      } else {
        // It's already a FilterState object
        filterConfig = savedFilter.filterConfig as FilterState
        methodLogger.debug('Using filterConfig as object:', filterConfig) // Debug: log object result
      }
      
      // Validate that we have a proper FilterState structure
      if (!filterConfig || !filterConfig.groups || !Array.isArray(filterConfig.groups)) {
        methodLogger.error('Invalid filter config structure', new Error('Invalid filter config structure'), filterConfig)
        toast.error("Invalid filter configuration structure")
        return
      }
      
      methodLogger.debug('Loading filter config:', filterConfig) // Debug log
      onLoad(filterConfig, savedFilter)
      onClose()
      toast.success(`Loaded filter: ${savedFilter.name}`)
    } catch (error) {
      methodLogger.error('Error loading filter', error as Error)
      toast.error("Failed to load filter configuration")
    }
  }

  const handleEditFilter = (savedFilter: SavedFilter) => {
    setFilterToEdit(savedFilter)
    setShowEditDialog(true)
  }

  const handleDeleteFilter = async (savedFilter: SavedFilter) => {
    setFilterToDelete(savedFilter)
    setShowDeleteDialog(true)
  }

  const confirmDelete = async () => {
    if (!filterToDelete) return

    setDeletingFilter(filterToDelete.id)
    try {
      const result = await deleteSavedFilter(filterToDelete.id)
      if (result.status === "success") {
        toast.success("Filter deleted successfully")
        loadSavedFilters()
      } else {
        toast.error(result.message || "Failed to delete filter")
      }
    } catch (error) {
      toast.error("Failed to delete filter")
    } finally {
      setDeletingFilter(null)
      setShowDeleteDialog(false)
      setFilterToDelete(null)
    }
  }

  const handleFilterUpdated = () => {
    loadSavedFilters()
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-md max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderOpen className="h-5 w-5" />
              Load Saved Filter
            </DialogTitle>
            <DialogDescription>
              Choose a saved filter to apply to your current view.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock className="h-4 w-4 animate-spin" />
                  Loading saved filters...
                </div>
              </div>
            ) : savedFilters.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <FolderOpen className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No saved filters found</p>
                <p className="text-sm">Save a filter first to see it here</p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
                {savedFilters.map((savedFilter) => (
                  <div
                    key={savedFilter.id}
                    className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-medium truncate">{savedFilter.name}</h4>
                        {savedFilter.isDefault && (
                          <Badge variant="default" className="text-xs">
                            <Star className="h-3 w-3 mr-1" />
                            Default
                          </Badge>
                        )}
                      </div>
                      {savedFilter.description && (
                        <p className="text-sm text-muted-foreground truncate">
                          {savedFilter.description}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        Created {formatDate(savedFilter.createdAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 ml-4">
                      <Button
                        size="sm"
                        onClick={() => handleLoadFilter(savedFilter)}
                      >
                        Load
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleEditFilter(savedFilter)}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteFilter(savedFilter)}
                        disabled={deletingFilter === savedFilter.id}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Filter Dialog */}
      <EditFilterDialog
        open={showEditDialog}
        onClose={() => setShowEditDialog(false)}
        onUpdate={handleFilterUpdated}
        savedFilter={filterToEdit}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Saved Filter</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{filterToDelete?.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
} 