"use client"

import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { getDefaultFilter, getSavedFilters, updateSavedFilter } from "@/lib/actions/saved-filter-actions"
import {
    countActiveConditions,
    countValidConditions,
    createNewGroup,
    FilterField,
    FilterState,
    SavedFilter,
} from "@/lib/types/filter-schema"
import { createClientLogger } from "@/lib/utils/logger-client"
import { FolderOpen, Plus, Save } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { FilterGroupComponent } from "./filter-group"
import { LoadFilterDialog } from "./load-filter-dialog"
import { SaveFilterDialog } from "./save-filter-dialog"

interface AdvancedFilterDialogProps {
  open: boolean
  onClose: () => void
  onApply: (filters: FilterState) => void
  currentFilters: FilterState | null
  fields: FilterField[]
  pageType?: string // Add pageType prop for save/load functionality
}

export function AdvancedFilterDialog({
  open,
  onClose,
  onApply,
  currentFilters,
  fields,
  pageType,
}: AdvancedFilterDialogProps) {
  const [localFilters, setLocalFilters] = useState<FilterState>(() => 
    currentFilters || { groups: [], groupLogic: 'AND' }
  )
  const logger = createClientLogger("AdvancedFilterDialog")
  // Save/Load dialog states
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [showLoadDialog, setShowLoadDialog] = useState(false)
  
  // Track loaded filter and saved filters
  const [loadedFilter, setLoadedFilter] = useState<SavedFilter | null>(null)
  const [originalLoadedConfig, setOriginalLoadedConfig] = useState<FilterState | null>(null)
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([])

  // Update local filters when currentFilters prop changes
  useEffect(() => {
    if (currentFilters) {
      console.log('AdvancedFilterDialog: Updating local filters with:', currentFilters)
      setLocalFilters(currentFilters)
    }
  }, [currentFilters])

  // Reset local filters when dialog opens
  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen) {
      setLocalFilters(currentFilters || { groups: [], groupLogic: 'AND' })
      setLoadedFilter(null)
      setOriginalLoadedConfig(null)
      if (pageType) {
        loadSavedFilters()
        loadDefaultFilter()
      }
    } else {
      onClose()
    }
  }

  // Load default filter if available
  const loadDefaultFilter = async () => {
    if (!pageType) return
    const methodLogger = logger.forMethod("loadDefaultFilter")
    
    try {
      const result = await getDefaultFilter(pageType)
      if (result.status === "success" && result.data) {
        // Parse filterConfig if it's a string
        let filterConfig: FilterState
        if (typeof result.data.filterConfig === 'string') {
          filterConfig = JSON.parse(result.data.filterConfig)
        } else {
          filterConfig = result.data.filterConfig as FilterState
        }
        
        // Validate the filter config structure
        if (!filterConfig || !filterConfig.groups || !Array.isArray(filterConfig.groups)) {
          methodLogger.error('Invalid default filter config structure', new Error('Invalid default filter config structure'), filterConfig)
          return
        }
        
        // Load the default filter into the dialog but don't apply it
        setLocalFilters(filterConfig)
        setLoadedFilter(result.data)
        setOriginalLoadedConfig(filterConfig)
      }
    } catch (error) {
      // Silently fail - no default filter is fine
      methodLogger.debug("No default filter found for page type:", pageType)
    }
  }

  // Load saved filters to check for matches
  const loadSavedFilters = async () => {
    if (!pageType) return
    const methodLogger = logger.forMethod("loadSavedFilters")
    try {
      const result = await getSavedFilters(pageType)
      if (result.status === "success") {
        setSavedFilters(result.data || [])
      }
    } catch (error) {
      // Silently fail - not critical for save functionality
      methodLogger.error("Error loading saved filters",  error as Error)
    }
  }

  // Check if current filters match an existing saved filter
  const findMatchingFilter = (): SavedFilter | null => {
    if (!loadedFilter) return null
    const methodLogger = logger.forMethod("findMatchingFilter")
    
    try {
      // Parse loaded filter config if it's a string
      let loadedConfig: FilterState
      if (typeof loadedFilter.filterConfig === 'string') {
        loadedConfig = JSON.parse(loadedFilter.filterConfig)
      } else {
        loadedConfig = loadedFilter.filterConfig as FilterState
      }
      
      // Check if current filters match the loaded filter
      const currentConfig = JSON.stringify(localFilters)
      const loadedConfigStr = JSON.stringify(loadedConfig)
      
      return currentConfig === loadedConfigStr ? loadedFilter : null
    } catch (error) {
      methodLogger.error("Error comparing filter configs", error as Error)
      return null
    }
  }

  // Check if current filters are modified from the loaded filter
  const hasModifications = (): boolean => {
    const methodLogger = logger.forMethod("hasModifications")
    if (!loadedFilter || !originalLoadedConfig) return false
    
    try {
      const currentConfig = JSON.stringify(localFilters)
      const originalConfig = JSON.stringify(originalLoadedConfig)
      
      return currentConfig !== originalConfig
    } catch (error) {
      methodLogger.error("Error checking modifications", error as Error)
      return false
    }
  }

  const handleApply = () => {
    const methodLogger = logger.forMethod("handleApply")
    const validCount = countValidConditions(localFilters)
    const totalCount = countActiveConditions(localFilters)
    
    if (validCount > 0 && validCount === totalCount) {
      // All conditions are complete
      onApply(localFilters)
      onClose()
    } else if (totalCount > 0) {
      const incompleteCount = totalCount - validCount
      methodLogger.error(`You have ${incompleteCount} incomplete filter condition${incompleteCount > 1 ? 's' : ''}. Please complete all conditions before applying.`)
    } else {
      methodLogger.error("Please add at least one filter condition")
    }
  }

  const handleAddGroup = () => {
    const methodLogger = logger.forMethod("handleAddGroup")
    setLocalFilters(prev => ({
      ...prev,
      groups: [...prev.groups, createNewGroup()]
    }))
  }

  const handleUpdateGroup = (index: number, group: any) => {
    const methodLogger = logger.forMethod("handleUpdateGroup")
    const newGroups = [...localFilters.groups]
    newGroups[index] = group
    setLocalFilters(prev => ({ ...prev, groups: newGroups }))
  }

  const handleDeleteGroup = (index: number) => {
    const methodLogger = logger.forMethod("handleDeleteGroup")
    setLocalFilters(prev => ({
      ...prev,
      groups: prev.groups.filter((_, i) => i !== index)
    }))
  }

  const handleClearAll = () => {
    const methodLogger = logger.forMethod("handleClearAll")
    setLocalFilters({ groups: [], groupLogic: 'AND' })
    setLoadedFilter(null)
    setOriginalLoadedConfig(null)
  }

  const handleGroupLogicChange = (logic: 'AND' | 'OR') => {
    const methodLogger = logger.forMethod("handleGroupLogicChange")
    setLocalFilters(prev => ({ ...prev, groupLogic: logic }))
  }

  const handleSaveFilter = async () => {
    if (!pageType) {
      toast.error("Page type is required to save filters")
      return
    }
    
    // If we have a loaded filter and it has modifications, update it directly
    if (loadedFilter && hasModifications()) {
      try {
        const result = await updateSavedFilter(loadedFilter.id, {
          name: loadedFilter.name,
          description: loadedFilter.description || undefined,
          filterConfig: localFilters, // Update with current filter configuration
          isDefault: loadedFilter.isDefault,
        })

        if (result.status === "success") {
          toast.success("Filter updated successfully")
          handleFilterSaved()
        } else {
          toast.error(result.message || "Failed to update filter")
        }
      } catch (error) {
        toast.error("Failed to update filter")
      }
      return
    }
    
    // If loaded filter but no modifications, do nothing (silent)
    if (loadedFilter && !hasModifications()) {
      return
    }
    
    // Otherwise, create a new filter
    setShowSaveDialog(true)
  }

  const handleLoadFilter = () => {
    if (!pageType) {
      toast.error("Page type is required to load filters")
      return
    }
    setShowLoadDialog(true)
  }

  const handleFilterSaved = () => {
    // Refresh the load dialog if it's open
    if (showLoadDialog) {
      setShowLoadDialog(false)
      setTimeout(() => setShowLoadDialog(true), 100)
    }
    // Refresh saved filters list
    loadSavedFilters()
    // Reset the original loaded config to current state after successful save/update
    if (loadedFilter) {
      setOriginalLoadedConfig(localFilters)
    }
  }

  const handleFilterLoaded = (loadedFilters: FilterState, savedFilter?: SavedFilter) => {
    // Add null check to prevent undefined
    if (!loadedFilters) {
      setLocalFilters({ groups: [], groupLogic: 'AND' })
    } else {
      setLocalFilters(loadedFilters)
    }
    setLoadedFilter(savedFilter || null)
    setOriginalLoadedConfig(loadedFilters || { groups: [], groupLogic: 'AND' })
  }

  const handleSaveAsFilter = () => {
    if (!pageType) {
      toast.error("Page type is required to save filters")
      return
    }
    setShowSaveDialog(true)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Advanced Filters</DialogTitle>
            <DialogDescription>
              Create complex filters to find specific users. Add multiple conditions and groups to refine your search.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Header with filter name and action buttons */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {loadedFilter ? (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">Loaded:</span>
                    <span className="font-medium text-primary">{loadedFilter.name}</span>
                    {hasModifications() && (
                      <span className="text-xs bg-orange-100 text-orange-700 px-2 py-1 rounded">
                        Modified
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    No filter loaded
                  </div>
                )}
              </div>
              
              {/* Save/Load buttons - only show if pageType is provided */}
              {pageType && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleLoadFilter}
                  >
                    <FolderOpen className="h-4 w-4 mr-2" />
                    Load Filter
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSaveFilter}
                    disabled={countValidConditions(localFilters) === 0 || (loadedFilter ? !hasModifications() : false)}
                  >
                    <Save className="h-4 w-4 mr-2" />
                    {loadedFilter ? "Update Filter" : "Save Filter"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSaveAsFilter}
                    disabled={countValidConditions(localFilters) === 0}
                  >
                    <Save className="h-4 w-4 mr-2" />
                    {loadedFilter ? "Save As New" : "Save As"}
                  </Button>
                </div>
              )}
            </div>

            {localFilters?.groups?.length > 1 && (
              <div className="flex items-center gap-2 px-1">
                <span className="text-sm font-medium">Match</span>
                <Select
                  value={localFilters?.groupLogic || 'AND'}
                  onValueChange={handleGroupLogicChange}
                >
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="AND">All groups</SelectItem>
                    <SelectItem value="OR">Any group</SelectItem>
                  </SelectContent>
                </Select>
                <span className="text-sm">of the following</span>
              </div>
            )}

            {!localFilters?.groups || localFilters.groups.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-muted-foreground mb-4">
                  No filter groups added yet
                </p>
                <Button onClick={handleAddGroup}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Filter Group
                </Button>
              </div>
            ) : (
              <>
                {localFilters.groups.map((group, index) => (
                  <FilterGroupComponent
                    key={group.id || `group-${index}`}
                    group={group}
                    fields={fields}
                    onUpdate={(updatedGroup) => handleUpdateGroup(index, updatedGroup)}
                    onDelete={() => handleDeleteGroup(index)}
                    canDelete={localFilters.groups.length > 1}
                    groupNumber={index + 1}
                  />
                ))}

                <Button
                  variant="outline"
                  onClick={handleAddGroup}
                  className="w-full"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Filter Group
                </Button>
              </>
            )}
          </div>

          <DialogFooter>
            <div className="flex items-center gap-4 mr-auto">
              {countActiveConditions(localFilters) > 0 && (
                <div className={`text-sm ${
                  countValidConditions(localFilters) === countActiveConditions(localFilters) 
                    ? 'text-green-600' 
                    : 'text-orange-600'
                }`}>
                  <div>{countValidConditions(localFilters)} of {countActiveConditions(localFilters)} condition{countActiveConditions(localFilters) > 1 ? 's' : ''} complete</div>
                  {countValidConditions(localFilters) !== countActiveConditions(localFilters) && (
                    <div>• Complete all conditions to apply</div>
                  )}
                </div>
              )}
            </div>
            
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={handleClearAll}
              disabled={!localFilters?.groups || localFilters.groups.length === 0}
            >
              Clear All
            </Button>
            <Button 
              onClick={handleApply}
              disabled={countValidConditions(localFilters) === 0 || countActiveConditions(localFilters) !== countValidConditions(localFilters)}
            >
              Apply Filters
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Save Filter Dialog */}
      {pageType && (
        <SaveFilterDialog
          open={showSaveDialog}
          onClose={() => setShowSaveDialog(false)}
          onSave={handleFilterSaved}
          currentFilters={localFilters}
          pageType={pageType}
        />
      )}

      {/* Load Filter Dialog */}
      {pageType && (
        <LoadFilterDialog
          open={showLoadDialog}
          onClose={() => setShowLoadDialog(false)}
          onLoad={handleFilterLoaded}
          pageType={pageType}
        />
      )}
    </>
  )
}