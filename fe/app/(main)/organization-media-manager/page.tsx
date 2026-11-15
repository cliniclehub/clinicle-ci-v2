"use client"

import MediaManager from '@/components/media-manager/media-manager-form'
import { ORG_MEDIA_LIBRARY_MAX_FILE_SIZE_BYTES } from '@/lib/utils/upload-constants'
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { DataTableServerSide } from '@/components/ui/data-table-server-side'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from '@/components/ui/sheet'
import {
  deleteMediaFileAction,
  deleteMediaAssetAction,
  listMediaFilesAction,
  reconcileMediaLibraryAction,
  renameMediaAssetAction,
  renameMediaFileAction,
  signMediaAccessDetailsAction,
  updateMediaFileAction,
  type MediaFile,
  type MediaLibraryReconcileData,
} from '@/lib/actions/media-manager/media-manager-actions'
import { useRoles } from '@/lib/contexts/role-context'
import { formatStorageSize, formatStorageSizeDetail } from "@/lib/utils/format-storage-size"
import { createClientLogger } from "@/lib/utils/logger-client"
import { ColumnDef } from "@tanstack/react-table"
import {
    ArrowDown,
    ArrowUp,
    ArrowUpDown,
    Download,
    Eye,
    File,
    FileText,
    HardDrive,
    Image,
    Info,
    Link2,
    Loader2,
    MoreHorizontal,
    Music,
    Pencil,
    RefreshCw,
    Trash2,
    Upload,
    Video,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { toast } from "sonner"

interface StorageData {
  totalFiles: number
  totalSize: number
  fileTypes: {
    images: number
    videos: number
    audio: number
    documents: number
    other: number
  }
}

type MediaTypeFilter = 'all' | 'video' | 'audio' | 'pdf' | 'document' | 'image' | 'other'
type UsageFilter = 'all' | 'unused' | 'used'

/** R2 keys are `orgs/{orgId}/media/...` — show only the final segment in the UI. */
function storagePathBasename(path: string): string {
  const normalized = path.replace(/\\/g, "/").trim()
  if (!normalized) return path
  const segment = normalized.split("/").filter(Boolean).pop()
  return segment ?? normalized
}

function canDeleteMediaAsset(file: MediaFile): boolean {
  if (file.assetStatus === 'processing') return false
  if ((file.usageCount ?? 0) > 0) return false
  return true
}

function DetailField({
  label,
  children,
  mono = false,
}: {
  label: string
  children: ReactNode
  mono?: boolean
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
      <div className={mono ? "break-all font-mono text-sm text-foreground" : "text-sm text-foreground"}>
        {children}
      </div>
    </div>
  )
}

export default function OrgMediaManager() {
  const { activeRole, isLoading: rolesLoading } = useRoles()
  const router = useRouter()
  const logger = useMemo(() => createClientLogger('OrgMediaManager'), [])

  // Pagination and filtering state
  const [files, setFiles] = useState<MediaFile[]>([])
  const [allFiles, setAllFiles] = useState<MediaFile[]>([]) // Store all files for client-side pagination
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [searchTerm, setSearchTerm] = useState('')
  const [sortBy, setSortBy] = useState<'name' | 'size' | 'date' | 'type'>('date')
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc")
  const [mediaTypeFilter, setMediaTypeFilter] = useState<MediaTypeFilter>('all')
  const [usageFilter, setUsageFilter] = useState<UsageFilter>('all')

  // Storage data and stats
  const [storageData, setStorageData] = useState<StorageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [tableLoading, setTableLoading] = useState(false) // Separate loading state for table only
  const [totalFiles, setTotalFiles] = useState(0)

  // Multiselect state
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())

  // Refresh key to force table re-render when data updates
  const [refreshKey, setRefreshKey] = useState(0)

  // Upload dialog state (MediaManager handles uploads)
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false)

  // Track thumbnail load errors to avoid retrying broken images
  const [thumbnailErrors, setThumbnailErrors] = useState<Set<string>>(new Set())
  const [downloadingFileId, setDownloadingFileId] = useState<string | null>(null)
  const [viewingFileId, setViewingFileId] = useState<string | null>(null)
  const [detailsFile, setDetailsFile] = useState<MediaFile | null>(null)

  // Get user-friendly file type name
  const getFileTypeName = (mimetype: string, fileName?: string): string => {
    if (!mimetype) {
      // Try to get type from file extension if MIME type is missing
      if (fileName) {
        const ext = fileName.split('.').pop()?.toLowerCase()
        const extMap: Record<string, string> = {
          'doc': 'Word', 'docx': 'Word',
          'xls': 'Excel', 'xlsx': 'Excel',
          'ppt': 'PowerPoint', 'pptx': 'PowerPoint',
          'pdf': 'PDF',
          'zip': 'ZIP', 'rar': 'RAR', '7z': '7Z',
          'txt': 'TXT', 'csv': 'CSV', 'html': 'HTML',
          'jpg': 'JPEG', 'jpeg': 'JPEG', 'png': 'PNG', 'gif': 'GIF', 'webp': 'WebP',
          'mp3': 'MP3', 'wav': 'WAV', 'ogg': 'OGG',
          'mp4': 'MP4', 'webm': 'WebM', 'mov': 'MOV',
        }
        if (ext && extMap[ext]) {
          return extMap[ext]
        }
      }
      return 'FILE'
    }

    // Normalize MIME type: trim whitespace and convert to lowercase for comparison
    const normalizedMime = mimetype.trim().toLowerCase()

    // Common MIME type mappings (all lowercase for case-insensitive matching)
    const mimeTypeMap: Record<string, string> = {
      // Documents
      'application/pdf': 'PDF',
      'application/msword': 'Word',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
      'application/vnd.ms-word.document.macroenabled.12': 'Word',
      'application/vnd.ms-excel': 'Excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel',
      'application/vnd.ms-excel.sheet.macroenabled.12': 'Excel',
      'application/vnd.ms-powerpoint': 'PowerPoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PowerPoint',
      'application/vnd.ms-powerpoint.presentation.macroenabled.12': 'PowerPoint',
      // Archives
      'application/zip': 'ZIP',
      'application/x-zip-compressed': 'ZIP',
      'application/x-rar-compressed': 'RAR',
      'application/x-7z-compressed': '7Z',
      // Text
      'text/plain': 'TXT',
      'text/csv': 'CSV',
      'text/html': 'HTML',
      // Images
      'image/jpeg': 'JPEG',
      'image/png': 'PNG',
      'image/gif': 'GIF',
      'image/webp': 'WebP',
      // Audio
      'audio/mpeg': 'MP3',
      'audio/mp3': 'MP3',
      'audio/wav': 'WAV',
      'audio/ogg': 'OGG',
      // Video
      'video/mp4': 'MP4',
      'video/webm': 'WebM',
      'video/quicktime': 'MOV',
    }

    // Check if we have a mapping (case-insensitive)
    if (mimeTypeMap[normalizedMime]) {
      return mimeTypeMap[normalizedMime]
    }

    // For MIME types with slashes, try to extract a readable name
    if (normalizedMime.includes('/')) {
      const parts = normalizedMime.split('/')
      const subtype = parts[1]

      // Handle complex subtypes like vnd.openxmlformats-officedocument.wordprocessingml.document
      if (subtype.includes('wordprocessingml')) return 'Word'
      if (subtype.includes('spreadsheetml')) return 'Excel'
      if (subtype.includes('presentationml')) return 'PowerPoint'
      if (subtype.includes('pdf')) return 'PDF'
      if (subtype.includes('zip')) return 'ZIP'
      if (subtype.includes('msword')) return 'Word'
      if (subtype.includes('ms-excel')) return 'Excel'
      if (subtype.includes('ms-powerpoint')) return 'PowerPoint'

      // For simple subtypes, capitalize first letter
      const firstPart = subtype.split('.')[0]
      if (firstPart) {
        return firstPart.charAt(0).toUpperCase() + firstPart.slice(1)
      }
    }

    // Fallback: try to extract extension from original MIME type if it looks like it might be formatted differently
    const upperMime = mimetype.toUpperCase()
    if (upperMime.includes('WORD')) return 'Word'
    if (upperMime.includes('EXCEL')) return 'Excel'
    if (upperMime.includes('POWERPOINT') || upperMime.includes('PRESENTATION')) return 'PowerPoint'

    // Final fallback: try file extension if available
    if (fileName) {
      const ext = fileName.split('.').pop()?.toLowerCase()
      const extMap: Record<string, string> = {
        'doc': 'Word', 'docx': 'Word',
        'xls': 'Excel', 'xlsx': 'Excel',
        'ppt': 'PowerPoint', 'pptx': 'PowerPoint',
        'pdf': 'PDF',
        'zip': 'ZIP', 'rar': 'RAR', '7z': '7Z',
      }
      if (ext && extMap[ext]) {
        return extMap[ext]
      }
    }

    // Final fallback
    return 'FILE'
  }

  // Delete dialogs
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [fileToDelete, setFileToDelete] = useState<MediaFile | null>(null)
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Update dialog state
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false)
  const [fileToUpdate, setFileToUpdate] = useState<MediaFile | null>(null)
  const [updating, setUpdating] = useState(false)
  const [updateFileInput, setUpdateFileInput] = useState<HTMLInputElement | null>(null)
  const [updateFileName, setUpdateFileName] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)

  // Rename dialog state
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [fileToRename, setFileToRename] = useState<MediaFile | null>(null)
  const [newFileName, setNewFileName] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [updateProgress, setUpdateProgress] = useState(0)

  const [reconcileDialogOpen, setReconcileDialogOpen] = useState(false)
  const [reconcileLoading, setReconcileLoading] = useState(false)
  const [reconcileApplying, setReconcileApplying] = useState(false)
  const [reconcileReport, setReconcileReport] = useState<MediaLibraryReconcileData | null>(null)
  const selectedMediaFiles = useMemo(
    () => allFiles.filter(file => selectedFiles.has(file.id)),
    [allFiles, selectedFiles]
  )
  const selectedHasBlockedDelete = useMemo(
    () => selectedMediaFiles.some(file => !canDeleteMediaAsset(file)),
    [selectedMediaFiles]
  )
  const detailsFileLive = useMemo(
    () => detailsFile ? allFiles.find(file => file.id === detailsFile.id) ?? detailsFile : null,
    [allFiles, detailsFile]
  )

  // Org admin surface: org_owner implies org_admin (role-implications).
  useEffect(() => {
    if (rolesLoading) return
    if (activeRole !== 'org_admin' && activeRole !== 'org_owner') {
      toast.error("Access denied. Organization admin role required.")
      router.push('/unauthorized')
    }
  }, [rolesLoading, activeRole, router])

  const updatePrivateMediaState = useCallback((privateFilesData: MediaFile[]) => {
    const newFiles = [...privateFilesData]
    setAllFiles(newFiles)

    const totalSize = privateFilesData.reduce((sum, file) => sum + file.size, 0)
    const fileTypes = {
      images: privateFilesData.filter(f => f.mediaType === 'image').length,
      videos: privateFilesData.filter(f => f.mediaType === 'video').length,
      audio: privateFilesData.filter(f => f.mediaType === 'audio').length,
      documents: privateFilesData.filter(f => f.mediaType === 'pdf' || f.mediaType === 'document').length,
      other: privateFilesData.filter(f => !f.mediaType || f.mediaType === 'other').length
    }

    setStorageData({
      totalFiles: privateFilesData.length,
      totalSize,
      fileTypes,
    })
    setRefreshKey(prev => prev + 1)
  }, [])

  // Load private media-library rows from the platform media-assets table.
  const loadMediaFiles = async (showTableLoading = false) => {
    if (showTableLoading) {
      setTableLoading(true)
    } else {
      setLoading(true)
    }

    try {
      const privateFilesData = await listMediaFilesAction('', false)

      updatePrivateMediaState(privateFilesData)
      setThumbnailErrors(new Set())

      // Force a state update by ensuring all dependent states are updated
      // This helps React detect the change and re-render the table
      await new Promise(resolve => setTimeout(resolve, 0))

    } catch (error) {
      logger.error('Error loading media files', error as Error)
      toast.error("Failed to load media files")
    } finally {
      setLoading(false)
      setTableLoading(false)
    }
  }

  const handleOpenReconcile = async () => {
    setReconcileDialogOpen(true)
    setReconcileReport(null)
    setReconcileLoading(true)
    try {
      const res = await reconcileMediaLibraryAction({ dryRun: true })
      if (res.status === "success" && res.data) {
        setReconcileReport(res.data)
      } else {
        toast.error(res.message || "Failed to reconcile media library")
        setReconcileDialogOpen(false)
      }
    } catch (error) {
      logger.error("Error planning media library reconcile", error as Error)
      toast.error("Failed to reconcile media library")
      setReconcileDialogOpen(false)
    } finally {
      setReconcileLoading(false)
    }
  }

  const handleApplyReconcile = async () => {
    setReconcileApplying(true)
    try {
      const res = await reconcileMediaLibraryAction({ dryRun: false })
      if (res.status !== "success" || !res.data) {
        toast.error(res.message || "Failed to apply media library fixes")
        return
      }
      const report = res.data
      setReconcileReport(report)
      const parts: string[] = []
      if (report.created > 0) parts.push(`registered ${report.created}`)
      if (report.updated > 0) parts.push(`updated sizes for ${report.updated}`)
      if (report.dbOnly > 0) parts.push(`${report.dbOnly} still missing in storage`)
      if (report.errors > 0) parts.push(`${report.errors} error${report.errors === 1 ? "" : "s"}`)
      if (parts.length === 0) {
        toast.message("Library already in sync")
      } else {
        toast.success(parts.join("; "))
      }
      await loadMediaFiles(true)
    } catch (error) {
      logger.error("Error applying media library reconcile", error as Error)
      toast.error("Failed to apply media library fixes")
    } finally {
      setReconcileApplying(false)
    }
  }

  // Filter, sort, and paginate files
  const filteredAndSortedFiles = useMemo(() => {
    let result = [...allFiles]

    // Apply media type filter
    if (mediaTypeFilter !== 'all') {
      result = result.filter(file => file.mediaType === mediaTypeFilter)
    }

    // Apply usage filter
    if (usageFilter !== 'all') {
      result = result.filter((file) => {
        const unused = (file.usageCount ?? 0) === 0
        return usageFilter === 'unused' ? unused : !unused
      })
    }

    // Apply search filter
    if (searchTerm) {
      const q = searchTerm.toLowerCase()
      result = result.filter(
        (file) =>
          storagePathBasename(file.originalName).toLowerCase().includes(q) ||
          file.originalName.toLowerCase().includes(q) ||
          storagePathBasename(file.id).toLowerCase().includes(q) ||
          file.id.toLowerCase().includes(q)
      )
    }

    // Apply sorting
    result.sort((a, b) => {
      let comparison = 0
      switch (sortBy) {
        case 'name':
          comparison = storagePathBasename(a.originalName).localeCompare(
            storagePathBasename(b.originalName)
          )
          break
        case 'size':
          comparison = b.size - a.size
          break
        case 'date':
          comparison = new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
          break
        case 'type':
          comparison = a.mimetype.localeCompare(b.mimetype)
          break
        default:
          return 0
      }
      return sortOrder === 'asc' ? -comparison : comparison
    })

    return result
  }, [allFiles, searchTerm, sortBy, sortOrder, mediaTypeFilter, usageFilter])

  // Paginate files
  const paginatedFiles = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize
    const endIndex = startIndex + pageSize
    return filteredAndSortedFiles.slice(startIndex, endIndex)
  }, [filteredAndSortedFiles, currentPage, pageSize])

  // Update displayed files when pagination changes
  useEffect(() => {
    setFiles(paginatedFiles)
    setTotalFiles(filteredAndSortedFiles.length)
    // Reset to page 1 if current page is out of bounds
    const totalPages = Math.ceil(filteredAndSortedFiles.length / pageSize)
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(1)
    }
  }, [paginatedFiles, filteredAndSortedFiles.length, pageSize, currentPage])

  // Clear selections for files that no longer exist after data refresh
  useEffect(() => {
    const availableFileIds = new Set(allFiles.map(f => f.id))
    setSelectedFiles(prev => {
      const next = new Set(prev)
      let changed = false
      prev.forEach(id => {
        if (!availableFileIds.has(id)) {
          next.delete(id)
          changed = true
        }
      })
      return changed ? next : prev
    })
  }, [allFiles])

  useEffect(() => {
    if (!rolesLoading && activeRole === 'org_admin') {
      loadMediaFiles()
    }
  }, [rolesLoading, activeRole])

  // Handle delete file
  const handleDeleteClick = async (file: MediaFile) => {
    if ((file.usageCount ?? 0) > 0) {
      toast.error("This file is in use and cannot be deleted.")
      return
    }
    if (file.assetStatus === 'processing') {
      toast.error("This file is processing. Wait for processing to finish before deleting.")
      return
    }
    setFileToDelete(file)
    setDeleteDialogOpen(true)
  }

  const handleConfirmDelete = async () => {
    if (!fileToDelete) return

    setDeleting(true)
    try {
      if (fileToDelete.mediaAssetId) {
        await deleteMediaAssetAction(fileToDelete.mediaAssetId)
      } else {
        await deleteMediaFileAction(fileToDelete.id)
      }
      toast.success(`Deleted ${storagePathBasename(fileToDelete.originalName)}`)
      setDeleteDialogOpen(false)
      setFileToDelete(null)
      // Reload files after deletion - only show table loading
      await loadMediaFiles(true)
      // Clear selection if deleted file was selected
      setSelectedFiles(prev => {
        const next = new Set(prev)
        next.delete(fileToDelete.id)
        return next
      })
    } catch (error) {
      logger.error('Delete error', error as Error, { fileId: fileToDelete.id })
      toast.error("Failed to delete file")
    } finally {
      setDeleting(false)
    }
  }

  // Handle bulk delete
  const handleBulkDeleteClick = () => {
    if (selectedFiles.size === 0) return
    setBulkDeleteDialogOpen(true)
  }

  const handleConfirmBulkDelete = async () => {
    if (selectedFiles.size === 0) return

    setDeleting(true)
    try {
      const fileIds = Array.from(selectedFiles)
      const filesToDelete = allFiles.filter(f => fileIds.includes(f.id))
      const blocked = filesToDelete.filter(file => !canDeleteMediaAsset(file))
      if (blocked.length > 0) {
        toast.error("Some selected files are in use or processing and cannot be deleted.")
        return
      }

      // Delete all selected files
      await Promise.all(
        filesToDelete.map(file =>
          file.mediaAssetId
            ? deleteMediaAssetAction(file.mediaAssetId)
            : deleteMediaFileAction(file.id)
        )
      )

      toast.success(`Deleted ${selectedFiles.size} file${selectedFiles.size !== 1 ? 's' : ''}`)
      setBulkDeleteDialogOpen(false)
      setSelectedFiles(new Set())

      // Reload files after deletion - only show table loading
      await loadMediaFiles(true)
    } catch (error) {
      logger.error('Bulk delete error', error as Error, { count: selectedFiles.size })
      toast.error("Failed to delete some files")
    } finally {
      setDeleting(false)
    }
  }

  // Handle update file
  const handleUpdateClick = (file: MediaFile) => {
    setFileToUpdate(file)
    setUpdateFileName(storagePathBasename(file.originalName))
    setSelectedFile(null) // Reset selected file
    setUpdateDialogOpen(true)
  }

  const handleUpdateFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      setSelectedFile(file)
      // Auto-populate name field with selected file's name
        setUpdateFileName(file.name)
    } else {
      setSelectedFile(null)
    }
  }

  const handleUpdateSubmit = async () => {
    if (!selectedFile || !fileToUpdate) {
      toast.error("Please select a file to upload")
      return
    }

    const file = selectedFile

    // Use custom name if provided, otherwise use the selected file's name
    // Ensure extension is preserved if custom name doesn't have one
    let fileNameToUse = updateFileName.trim() || file.name
    const originalExt = file.name.includes('.') ? '.' + file.name.split('.').pop() : ''
    if (fileNameToUse && !fileNameToUse.includes('.')) {
      fileNameToUse = fileNameToUse + originalExt
    }

    // Set updating state first - this will trigger the UI to show progress
    setUpdating(true)
    setUpdateProgress(0)

    // Use setTimeout to ensure state updates before starting update
    setTimeout(async () => {
      let progressInterval: NodeJS.Timeout | null = null

      // Simulate upload progress (similar to upload dialog)
      progressInterval = setInterval(() => {
        setUpdateProgress(prev => {
          const newProgress = prev >= 90 ? 90 : prev + 10
          if (newProgress >= 90 && progressInterval) {
            clearInterval(progressInterval)
            progressInterval = null
          }
          return newProgress
        })
      }, 200)

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('contentType', 'media')
      formData.append('fileName', fileNameToUse) // Pass custom file name

      // Update file with same ID
      const result = await updateMediaFileAction(fileToUpdate.id, formData)

        // Complete upload progress, but keep dialog open
        if (progressInterval) {
          clearInterval(progressInterval)
          progressInterval = null
        }
        setUpdateProgress(100)

      // Wait a brief moment to show completion
      await new Promise(resolve => setTimeout(resolve, 300))

      // Continue showing progress while refreshing data
      setUpdateProgress(90) // Show we're refreshing

      // Reload files after update - keep dialog open showing progress
      await loadMediaFiles(true)

      // Now close dialog and show success - all done seamlessly
      toast.success(`Updated ${fileToUpdate.originalName} to ${fileNameToUse}${result.thumbnailUrl ? ' (thumbnail generated)' : ''}`)
      setUpdateDialogOpen(false)
      setFileToUpdate(null)
      setUpdateFileName('')
      setSelectedFile(null)
      setUpdateProgress(0)
      setUpdating(false)

      // Reset file input
      if (updateFileInput) {
        updateFileInput.value = ''
      }
    } catch (error) {
        if (progressInterval) {
          clearInterval(progressInterval)
          progressInterval = null
        }
      logger.error('Update error', error as Error, { fileId: fileToUpdate?.id })
      toast.error("Failed to update file")
      setUpdating(false)
        setUpdateProgress(0)
    }
    }, 100) // Small delay to ensure UI updates
  }

  // Handle rename file
  const handleDownloadFile = useCallback(
    async (file: MediaFile) => {
      setDownloadingFileId(file.id)
      try {
        const objectKey = file.sourceObjectKey || file.id
        const downloadUrl = `/api/media-manager/download?${new URLSearchParams({ objectKey }).toString()}`
        const anchor = document.createElement("a")
        anchor.href = downloadUrl
        anchor.download = file.originalName?.trim() || storagePathBasename(file.id)
        anchor.target = "_blank"
        anchor.rel = "noopener noreferrer"
        document.body.appendChild(anchor)
        anchor.click()
        anchor.remove()
        toast.success("Download started")
      } catch (e) {
        logger.error("handleDownloadFile failed", e as Error, { fileId: file.id })
        toast.error("Failed to download file")
      } finally {
        setDownloadingFileId(null)
      }
    },
    [logger]
  )

  const handleViewFile = useCallback(
    async (file: MediaFile) => {
      const objectKey = file.sourceObjectKey || file.id
      setViewingFileId(file.id)
      try {
        const signed = await signMediaAccessDetailsAction(null, {
          objectKey,
        })
        window.open(signed.playbackUrl, '_blank')
      } catch (e) {
        logger.error("handleViewFile failed", e as Error, { fileId: file.id })
        toast.error("Failed to open file")
      } finally {
        setViewingFileId(null)
      }
    },
    [logger]
  )

  const handleOpenDetails = useCallback((file: MediaFile) => {
    setDetailsFile(file)
  }, [])

  const handleRenameClick = (file: MediaFile) => {
    setFileToRename(file)
    setNewFileName(storagePathBasename(file.originalName))
    setRenameDialogOpen(true)
  }

  const handleConfirmRename = async () => {
    if (!fileToRename || !newFileName.trim()) {
      toast.error("Please enter a file name")
      return
    }

    const targetId = fileToRename.id
    const newName = newFileName.trim()
    setRenaming(true)

    try {
      const updated = fileToRename.mediaAssetId
        ? await renameMediaAssetAction(fileToRename.mediaAssetId, newName)
        : await renameMediaFileAction(targetId, newName)
      setAllFiles((prev) =>
        prev.map((f) => {
          if (f.id !== targetId) return f
          return {
            ...f,
            originalName: updated.originalName,
            url: updated.url ?? f.url,
            ...(updated.thumbnailUrl !== undefined ? { thumbnailUrl: updated.thumbnailUrl } : {}),
          }
        })
      )
      await loadMediaFiles(true)
      setRenameDialogOpen(false)
      setFileToRename(null)
      setNewFileName("")
      toast.success(`Renamed to "${updated.originalName}"`)
    } catch (error) {
      logger.error("Rename error", error as Error, { fileId: targetId })
      toast.error("Failed to rename file")
    } finally {
      setRenaming(false)
    }
  }

  const formatFileSize = (bytes: number) => formatStorageSize(bytes, "decimal")

  // Format date
  const formatDate = (dateString: string) => {
    if (dateString === 'Never') return 'Never'
    return new Date(dateString).toLocaleDateString()
  }

  const formatDateTime = (dateString?: string | null) => {
    if (!dateString) return "—"
    const date = new Date(dateString)
    if (Number.isNaN(date.getTime())) return "—"
    return date.toLocaleString()
  }

  const formatDuration = (seconds: number | undefined | null): string => {
    if (!seconds || seconds <= 0) return "—"
    const roundedSeconds = Math.round(seconds)
    const hours = Math.floor(roundedSeconds / 3600)
    const minutes = Math.floor((roundedSeconds % 3600) / 60)
    const secs = roundedSeconds % 60
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`
    }
    return `${minutes}:${secs.toString().padStart(2, "0")}`
  }

  const formatOptionalSize = (bytes?: number | null) =>
    bytes != null && bytes > 0 ? formatFileSize(bytes) : "—"

  const formatResolution = (file: MediaFile) => {
    if (!file.sourceWidth || !file.sourceHeight) return "—"
    return `${file.sourceWidth} × ${file.sourceHeight}`
  }

  const isVideoOrAudio = (mimetype: string) =>
    mimetype.startsWith("video/") || mimetype.startsWith("audio/")

  // Get file type icon
  const getFileIcon = (mimetype: string) => {
    if (mimetype.startsWith('image/')) return <Image className="w-4 h-4" />
    if (mimetype.startsWith('video/')) return <Video className="w-4 h-4" />
    if (mimetype.startsWith('audio/')) return <Music className="w-4 h-4" />
    if (mimetype === 'application/pdf') return <FileText className="w-4 h-4" />
    return <File className="w-4 h-4" />
  }

  // Column definitions for the table
  const columns: ColumnDef<MediaFile>[] = useMemo(() => [
    {
      id: "select",
      header: ({ table }) => (
        <Checkbox
          checked={table.getIsAllPageRowsSelected()}
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Select all"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label={`Select ${storagePathBasename(row.original.originalName)}`}
        />
      ),
      enableSorting: false,
      enableHiding: false,
    },
    {
      id: "file",
      accessorKey: "originalName",
      header: ({ column }) => {
        const isSorted = sortBy === 'name'
        return (
          <Button
            variant="ghost"
            onClick={() => {
              const newSort = sortBy === 'name' && sortOrder === 'asc' ? 'desc' : 'asc'
              setSortBy('name')
              setSortOrder(newSort)
            }}
          >
            File
            {isSorted && sortOrder === 'asc' ? (
              <ArrowUp className="ml-2 h-4 w-4" />
            ) : isSorted && sortOrder === 'desc' ? (
              <ArrowDown className="ml-2 h-4 w-4" />
            ) : (
              <ArrowUpDown className="ml-2 h-4 w-4" />
            )}
          </Button>
        )
      },
      cell: ({ row }) => {
        const file = row.original
        const displayName = storagePathBasename(file.originalName)
        const objectBasename = storagePathBasename(file.id)
        return (
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-12 h-12 rounded bg-muted flex items-center justify-center overflow-hidden">
              {file.thumbnailUrl && !thumbnailErrors.has(file.id) ? (
                <img
                  src={file.thumbnailUrl}
                  alt={displayName}
                  className="w-full h-full object-cover"
                  onError={() => {
                    setThumbnailErrors(prev => new Set(prev).add(file.id))
                  }}
                />
              ) : (
                <div className="flex items-center justify-center">
                  {getFileIcon(file.mimetype)}
                </div>
              )}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex min-w-0 items-center gap-2">
                <p className="truncate font-medium" title={file.originalName}>
                  {displayName}
                </p>
                {file.mediaAssetId ? (
                  <Badge variant="outline" className="shrink-0">Asset</Badge>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">
                <span className="sr-only">Object ID: </span>
                <code className="block truncate font-mono" title={file.id}>
                  {objectBasename}
                </code>
              </p>
            </div>
          </div>
        )
      },
    },
    {
      id: "size",
      accessorKey: "size",
      header: ({ column }) => {
        const isSorted = sortBy === 'size'
        return (
          <Button
            variant="ghost"
            onClick={() => {
              const newSort = sortBy === 'size' && sortOrder === 'asc' ? 'desc' : 'asc'
              setSortBy('size')
              setSortOrder(newSort)
            }}
          >
            Size
            {isSorted && sortOrder === 'asc' ? (
              <ArrowUp className="ml-2 h-4 w-4" />
            ) : isSorted && sortOrder === 'desc' ? (
              <ArrowDown className="ml-2 h-4 w-4" />
            ) : (
              <ArrowUpDown className="ml-2 h-4 w-4" />
            )}
          </Button>
        )
      },
      cell: ({ row }) => {
        const bytes = row.original.size
        return (
          <Badge variant="secondary" title={formatStorageSizeDetail(bytes)}>
            {formatFileSize(bytes)}
          </Badge>
        )
      },
    },
    {
      id: "type",
      accessorKey: "mimetype",
      header: ({ column }) => {
        const isSorted = sortBy === 'type'
        return (
          <Button
            variant="ghost"
            onClick={() => {
              const newSort = sortBy === 'type' && sortOrder === 'asc' ? 'desc' : 'asc'
              setSortBy('type')
              setSortOrder(newSort)
            }}
          >
            Type
            {isSorted && sortOrder === 'asc' ? (
              <ArrowUp className="ml-2 h-4 w-4" />
            ) : isSorted && sortOrder === 'desc' ? (
              <ArrowDown className="ml-2 h-4 w-4" />
            ) : (
              <ArrowUpDown className="ml-2 h-4 w-4" />
            )}
          </Button>
        )
      },
      cell: ({ row }) => {
        return (
          <Badge variant="outline">
            {getFileTypeName(row.original.mimetype, row.original.originalName)}
          </Badge>
        )
      },
    },
    {
      id: "duration",
      accessorFn: (row) => row.duration ?? 0,
      header: "Duration",
      cell: ({ row }) => {
        const file = row.original
        if (!isVideoOrAudio(file.mimetype)) {
          return <span className="text-sm text-muted-foreground">—</span>
        }
        return (
          <span className="text-sm tabular-nums text-foreground">
            {formatDuration(file.duration)}
          </span>
        )
      },
    },
    {
      id: "uploadedAt",
      accessorKey: "uploadedAt",
      header: ({ column }) => {
        const isSorted = sortBy === 'date'
        return (
          <Button
            variant="ghost"
            onClick={() => {
              const newSort = sortBy === 'date' && sortOrder === 'asc' ? 'desc' : 'asc'
              setSortBy('date')
              setSortOrder(newSort)
            }}
          >
            Uploaded
            {isSorted && sortOrder === 'asc' ? (
              <ArrowUp className="ml-2 h-4 w-4" />
            ) : isSorted && sortOrder === 'desc' ? (
              <ArrowDown className="ml-2 h-4 w-4" />
            ) : (
              <ArrowUpDown className="ml-2 h-4 w-4" />
            )}
          </Button>
        )
      },
      cell: ({ row }) => {
        return (
          <span className="text-sm text-muted-foreground">
            {formatDate(row.original.uploadedAt)}
          </span>
        )
      },
    },
    {
      id: "actions",
      enableHiding: false,
      cell: ({ row }) => {
        const file = row.original
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <span className="sr-only">Open menu</span>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => handleOpenDetails(file)}>
                <Info className="mr-2 h-4 w-4" />
                Details
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleRenameClick(file)}
                disabled={file.assetStatus === 'processing'}
              >
                <Pencil className="mr-2 h-4 w-4" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => void handleViewFile(file)}
                disabled={viewingFileId === file.id}
              >
                {viewingFileId === file.id ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Eye className="mr-2 h-4 w-4" />
                )}
                View
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => void handleDownloadFile(file)}
                disabled={downloadingFileId === file.id}
              >
                {downloadingFileId === file.id ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Download className="mr-2 h-4 w-4" aria-hidden />
                )}
                Download
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => void handleDeleteClick(file)}
                disabled={deleting || !canDeleteMediaAsset(file)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                {file.mediaAssetId ? "Delete file" : "Delete object"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
    },
  ], [sortBy, sortOrder, thumbnailErrors, deleting, downloadingFileId, viewingFileId, handleDownloadFile, handleViewFile, handleOpenDetails, handleDeleteClick, formatFileSize, formatDate, formatDuration, getFileIcon])

  if (rolesLoading) {
    return (
      <div className="flex-1 p-8 pt-6">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-lg font-medium">Loading…</p>
          </div>
        </div>
      </div>
    )
  }

  if (activeRole !== 'org_admin') {
    return null // Will redirect in useEffect
  }

  if (loading) {
    return (
      <div className="flex-1 p-8 pt-6">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-lg font-medium">Loading media files...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 space-y-6 p-8 pt-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Media Manager</h1>
          <p className="text-muted-foreground">
            Upload and manage organization files
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => void handleOpenReconcile()}
            disabled={reconcileLoading || reconcileApplying}
          >
            {reconcileLoading ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4 mr-2" />
            )}
            Reconcile library
          </Button>
          <Button onClick={() => loadMediaFiles()}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          <Button onClick={() => setUploadDialogOpen(true)}>
            <Upload className="w-4 h-4 mr-2" />
            Upload Files
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      {storageData && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Files</CardTitle>
              <File className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{storageData.totalFiles}</div>
              <p className="text-xs text-muted-foreground">
                Organization files stored
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Storage</CardTitle>
              <HardDrive className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatFileSize(storageData.totalSize)}</div>
              <p className="text-xs text-muted-foreground">
                Total file size
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">By Type</CardTitle>
              <Image className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-sm font-medium">
                {storageData.fileTypes.images} images · {storageData.fileTypes.videos} videos · {storageData.fileTypes.audio} audio
              </div>
              <p className="text-xs text-muted-foreground">
                {storageData.fileTypes.documents} documents · {storageData.fileTypes.other} other
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Files Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Organization Files</CardTitle>
              <CardDescription>
                Browse, upload, and manage files in your organization library.
              </CardDescription>
            </div>
	                {selectedFiles.size > 0 && (
	                  <Button
	                    variant="destructive"
	                    size="sm"
                onClick={handleBulkDeleteClick}
                disabled={deleting || selectedHasBlockedDelete}
                title={selectedHasBlockedDelete ? "Selected files include items in use or processing" : undefined}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Selected ({selectedFiles.size})
              </Button>
            )}
          </div>

          {/* Media Type Filter Buttons */}
          <div className="flex flex-col gap-3 mt-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-muted-foreground">Type:</span>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant={mediaTypeFilter === 'all' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => {
                    setMediaTypeFilter('all')
                    setCurrentPage(1)
                  }}
                >
                  All
                  <Badge variant="secondary" className="ml-2">
                    {allFiles.length}
                  </Badge>
                </Button>
                {(['video', 'audio', 'pdf', 'document', 'image', 'other'] as const).map((type) => (
                  <Button
                    key={type}
                    variant={mediaTypeFilter === type ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => {
                      setMediaTypeFilter(type)
                      setCurrentPage(1)
                    }}
                  >
                    {type.charAt(0).toUpperCase() + type.slice(1)}
                    <Badge variant="secondary" className="ml-2">
                      {allFiles.filter(f => f.mediaType === type).length}
                    </Badge>
                  </Button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-muted-foreground">Usage:</span>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant={usageFilter === 'all' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => {
                    setUsageFilter('all')
                    setCurrentPage(1)
                  }}
                >
                  All
                  <Badge variant="secondary" className="ml-2">
                    {allFiles.length}
                  </Badge>
                </Button>
                <Button
                  variant={usageFilter === 'unused' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => {
                    setUsageFilter('unused')
                    setCurrentPage(1)
                  }}
                >
                  Unused
                  <Badge variant="secondary" className="ml-2">
                    {allFiles.filter((f) => (f.usageCount ?? 0) === 0).length}
                  </Badge>
                </Button>
                <Button
                  variant={usageFilter === 'used' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => {
                    setUsageFilter('used')
                    setCurrentPage(1)
                  }}
                >
                  Used
                  <Badge variant="secondary" className="ml-2">
                    {allFiles.filter((f) => (f.usageCount ?? 0) > 0).length}
                  </Badge>
                </Button>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <DataTableServerSide
            key={`media-table-${refreshKey}`}
            columns={columns}
            data={files}
            getRowId={(row) => row.id}
            searchKey="originalName"
            searchPlaceholder="Search by name or object ID..."
            pageSize={pageSize}
            pageSizeOptions={[10, 20, 30, 50, 100]}
            totalItems={totalFiles}
            currentPage={currentPage}
            isLoading={loading || tableLoading}
            enableRowSelection={true}
            onRowSelectionChange={(selectedRows) => {
              setSelectedFiles(new Set(selectedRows.map(file => file.id)))
            }}
            onPageChange={(page) => setCurrentPage(page)}
            onPageSizeChange={(size) => {
              setPageSize(size)
              setCurrentPage(1)
            }}
            onSearchChange={(search) => {
              setSearchTerm(search)
              setCurrentPage(1)
            }}
            onFilterChange={() => {
              // Not used with current filtering
            }}
            onSortChange={(columnId, direction) => {
              if (direction) {
                const sortMap: Record<string, 'name' | 'size' | 'date' | 'type'> = {
                  'file': 'name',
                  'size': 'size',
                  'uploadedAt': 'date',
                  'type': 'type',
                }
                const mappedSort = sortMap[columnId] || 'date'
                setSortBy(mappedSort)
                setSortOrder(direction)
                setCurrentPage(1)
              }
            }}
            activeFilters={{}}
            sortColumn={
              sortBy === 'name'
                ? 'file'
                : sortBy === 'size'
                  ? 'size'
                  : sortBy === 'date'
                    ? 'uploadedAt'
                    : 'type'
            }
            sortDirection={sortOrder}
          />
        </CardContent>
      </Card>

      <Sheet
        open={Boolean(detailsFileLive)}
        onOpenChange={(open) => {
          if (!open) setDetailsFile(null)
        }}
      >
        <SheetContent className="flex h-full w-full max-w-full flex-col overflow-hidden p-0 sm:max-w-xl">
          {detailsFileLive ? (
            <>
              <SheetHeader className="border-b px-6 py-5 pr-12">
                <div className="flex items-start gap-3">
                  <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted">
                    {getFileIcon(detailsFileLive.mimetype)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <SheetTitle className="truncate" title={detailsFileLive.originalName}>
                      {storagePathBasename(detailsFileLive.originalName)}
                    </SheetTitle>
                    <SheetDescription>
                      {getFileTypeName(detailsFileLive.mimetype, detailsFileLive.originalName)} · {formatOptionalSize(detailsFileLive.size)}
                    </SheetDescription>
                  </div>
                </div>
              </SheetHeader>

              <ScrollArea className="flex-1">
                <div className="space-y-6 px-6 py-5">
                  {detailsFileLive.thumbnailUrl && !thumbnailErrors.has(detailsFileLive.id) ? (
                    <div className="overflow-hidden rounded-md border bg-muted">
                      <img
                        src={detailsFileLive.thumbnailUrl}
                        alt={storagePathBasename(detailsFileLive.originalName)}
                        className="aspect-video w-full object-cover"
                        onError={() => {
                          setThumbnailErrors(prev => new Set(prev).add(detailsFileLive.id))
                        }}
                      />
                    </div>
                  ) : null}

                  <section className="space-y-4">
                    <div className="flex items-center gap-2">
                      <Link2 className="h-4 w-4 text-muted-foreground" />
                      <h3 className="text-sm font-semibold">Source</h3>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <DetailField label="Media type">{detailsFileLive.mediaType ?? "other"}</DetailField>
                      <DetailField label="MIME type">{detailsFileLive.mimetype || "—"}</DetailField>
                      <DetailField label="File size">{formatOptionalSize(detailsFileLive.size)}</DetailField>
                      <DetailField label="Duration">{formatDuration(detailsFileLive.duration)}</DetailField>
                      <DetailField label="Resolution">{formatResolution(detailsFileLive)}</DetailField>
                      <DetailField label="Uploaded">{formatDateTime(detailsFileLive.uploadedAt)}</DetailField>
                      <DetailField label="Usage count">{detailsFileLive.usageCount ?? 0}</DetailField>
                      <DetailField label="Status">{detailsFileLive.assetStatus ?? "—"}</DetailField>
                    </div>
                    <DetailField label="Asset ID" mono>
                      {detailsFileLive.mediaAssetId ?? "—"}
                    </DetailField>
                    <DetailField label="Object key" mono>
                      {detailsFileLive.sourceObjectKey || detailsFileLive.id}
                    </DetailField>
                  </section>
                </div>
              </ScrollArea>

              <SheetFooter className="border-t px-6 py-4">
                <Button type="button" variant="outline" onClick={() => setDetailsFile(null)}>
                  Close
                </Button>
              </SheetFooter>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete File</AlertDialogTitle>
            <AlertDialogDescription>
              Delete <strong>{fileToDelete ? storagePathBasename(fileToDelete.originalName) : ""}</strong> from your organization library.
              This removes the file from storage. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? 'Deleting...' : 'Delete file'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Delete Confirmation Dialog */}
      <AlertDialog open={bulkDeleteDialogOpen} onOpenChange={setBulkDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Selected Files</AlertDialogTitle>
            <AlertDialogDescription>
              Delete <strong>{selectedFiles.size}</strong> selected file{selectedFiles.size !== 1 ? 's' : ''} from your organization library.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmBulkDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? 'Deleting...' : 'Delete All'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Update File Dialog */}
      <Dialog open={updateDialogOpen} onOpenChange={(open) => {
        // Prevent closing dialog while updating
        if (!open && updating) {
          return
        }
        setUpdateDialogOpen(open)
        if (!open) {
          setUpdateFileName('')
          setFileToUpdate(null)
          setSelectedFile(null)
          setUpdateProgress(0)
          // Reset file input when dialog closes
          if (updateFileInput) {
            updateFileInput.value = ''
          }
        }
      }}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Update File</DialogTitle>
            <DialogDescription>
              Select a new file to replace <strong>{fileToUpdate ? storagePathBasename(fileToUpdate.originalName) : ""}</strong>. The file will keep the same reference ID ({fileToUpdate ? storagePathBasename(fileToUpdate.id) : ""}).
            </DialogDescription>
          </DialogHeader>

          {updating ? (
            <div className="space-y-4 py-4">
              <div className="text-center">
                <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                <p className="text-lg font-medium">
                  {updateProgress < 100 ? 'Updating file...' : 'Refreshing data...'}
                </p>
                <p className="text-sm text-muted-foreground">
                  {updateProgress < 100
                    ? 'Please wait while we update your file'
                    : 'Updating file list with changes'}
                </p>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Progress</span>
                  <span>{Math.round(updateProgress)}%</span>
                </div>
                <Progress value={updateProgress} className="w-full" />
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="update-file-name">File Name</Label>
              <Input
                id="update-file-name"
                type="text"
                value={updateFileName}
                onChange={(e) => setUpdateFileName(e.target.value)}
                placeholder={fileToUpdate ? storagePathBasename(fileToUpdate.originalName) : "Enter file name"}
                disabled={updating}
              />
              <p className="text-xs text-muted-foreground">
                  Enter a custom name or leave empty to use: {selectedFile?.name || 'the selected file\'s name'}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="update-file-input">Select New File</Label>
              <Input
                id="update-file-input"
                type="file"
                onChange={handleUpdateFileSelect}
                disabled={updating}
                ref={(el) => setUpdateFileInput(el)}
                className="hidden"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => updateFileInput?.click()}
                disabled={updating}
                className="w-full"
              >
                <Upload className="w-4 h-4 mr-2" />
                {selectedFile ? selectedFile.name : 'Choose File'}
              </Button>
              {selectedFile && (
                  <div className="flex items-center gap-2 p-2 bg-muted rounded-md">
                    <div className="flex-shrink-0">
                      {getFileIcon(selectedFile.type || 'application/octet-stream')}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" title={selectedFile.name}>
                        {selectedFile.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatFileSize(selectedFile.size)}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (!updating) {
                  setUpdateDialogOpen(false)
                  setUpdateFileName('')
                  setFileToUpdate(null)
                  setSelectedFile(null)
                  setUpdateProgress(0)
                  if (updateFileInput) {
                    updateFileInput.value = ''
                  }
                }
              }}
              disabled={updating}
            >
              Cancel
            </Button>
              {updating ? (
              <Button disabled>
                  <div className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin mr-2" />
                  Updating...
              </Button>
              ) : (
              <Button
                onClick={handleUpdateSubmit}
                disabled={!selectedFile}
              >
                <Upload className="w-4 h-4 mr-2" />
                Update File
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={reconcileDialogOpen}
        onOpenChange={(open) => {
          if (!open && (reconcileLoading || reconcileApplying)) return
          if (!open) {
            setReconcileDialogOpen(false)
            setReconcileReport(null)
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Reconcile media library</DialogTitle>
            <DialogDescription>
              Compare private R2 objects under this organization&apos;s media prefix with the media
              asset table. Apply registers missing files and fills null or mismatched sizes. It does
              not delete storage objects or table rows.
            </DialogDescription>
          </DialogHeader>
          {reconcileLoading || !reconcileReport ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin shrink-0" aria-hidden />
              Scanning storage and library…
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <div className="rounded-md border px-3 py-2">
                  <p className="text-muted-foreground">R2 scanned</p>
                  <p className="font-medium">{reconcileReport.r2Scanned}</p>
                </div>
                <div className="rounded-md border px-3 py-2">
                  <p className="text-muted-foreground">Table rows</p>
                  <p className="font-medium">{reconcileReport.dbScanned}</p>
                </div>
                <div className="rounded-md border px-3 py-2">
                  <p className="text-muted-foreground">Matched</p>
                  <p className="font-medium">{reconcileReport.matched}</p>
                </div>
                <div className="rounded-md border px-3 py-2">
                  <p className="text-muted-foreground">Errors</p>
                  <p className="font-medium">{reconcileReport.errors}</p>
                </div>
              </div>
              <div className="rounded-md border px-3 py-3 space-y-1 text-sm">
                <p>
                  Missing from table (in R2):{" "}
                  <strong>{reconcileReport.r2Only}</strong>
                  {reconcileReport.dryRun ? " — will register on Apply" : ` — registered ${reconcileReport.created}`}
                </p>
                <p>
                  Size null or mismatched:{" "}
                  <strong>{reconcileReport.sizeRefresh}</strong>
                  {reconcileReport.dryRun
                    ? " — will refresh on Apply"
                    : ` — updated ${reconcileReport.updated}`}
                </p>
                <p>
                  Missing from storage (in table):{" "}
                  <strong>{reconcileReport.dbOnly}</strong> — reported only, not deleted
                </p>
              </div>
              {reconcileReport.items.length > 0 ? (
                <ScrollArea className="h-48 rounded-md border">
                  <ul className="p-3 space-y-2 text-xs">
                    {reconcileReport.items.map((item) => (
                      <li key={`${item.action}-${item.objectKey}`} className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">{item.action}</Badge>
                          <span className="font-medium truncate">{item.displayName}</span>
                        </div>
                        <code className="block text-muted-foreground truncate font-mono">
                          {item.objectKey}
                        </code>
                        {item.error ? (
                          <p className="text-destructive">{item.error}</p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
              ) : (
                <p className="text-sm text-muted-foreground">No sample issues to list.</p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setReconcileDialogOpen(false)
                setReconcileReport(null)
              }}
              disabled={reconcileApplying}
            >
              Close
            </Button>
            <Button
              type="button"
              onClick={() => void handleApplyReconcile()}
              disabled={
                reconcileLoading ||
                reconcileApplying ||
                !reconcileReport ||
                !reconcileReport.dryRun ||
                (reconcileReport.r2Only === 0 && reconcileReport.sizeRefresh === 0)
              }
            >
              {reconcileApplying ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Applying…
                </>
              ) : (
                "Apply fixes"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename File Dialog */}
      <AlertDialog
        open={renameDialogOpen}
        onOpenChange={(open) => {
          // Prevent closing while renaming/refreshing - user must wait for operation to complete
          if (!open && renaming) {
            return
          }
          if (!open && !renaming) {
            setNewFileName('')
            setFileToRename(null)
            setRenameDialogOpen(false)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rename File</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  Rename <strong className="text-foreground">{fileToRename ? storagePathBasename(fileToRename.originalName) : ""}</strong>. Content stays the
                  same; only the display name in metadata changes.
                </p>
                {fileToRename?.id ? (
                  <p className="text-xs">
                    <span className="font-medium text-foreground">Storage key</span>{" "}
                    <code className="break-all font-mono text-foreground/90" title={fileToRename.id}>
                      {storagePathBasename(fileToRename.id)}
                    </code>
                  </p>
                ) : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          {renaming ? (
            <div className="py-6">
              <div className="space-y-4">
                <div className="text-center">
                  <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                  <p className="text-lg font-medium">Renaming media...</p>
                  <p className="text-sm text-muted-foreground mt-2">
                    Updating the display name and refreshing data
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="py-4">
              <div className="space-y-2">
                <Label htmlFor="rename-file-name">Display name</Label>
                <Input
                  id="rename-file-name"
                  type="text"
                  value={newFileName}
                  onChange={(e) => setNewFileName(e.target.value)}
                  placeholder="Enter new file name"
                  disabled={renaming}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !renaming && newFileName.trim()) {
                      handleConfirmRename()
                    }
                  }}
                />
              </div>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={renaming}>Cancel</AlertDialogCancel>
            {renaming ? (
              <Button disabled className="min-w-[120px]">
                <div className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin mr-2 inline-block" />
                Processing...
              </Button>
            ) : (
              <Button
                type="button"
                onClick={() => void handleConfirmRename()}
                disabled={
                  !newFileName.trim() ||
                  newFileName.trim() === storagePathBasename(fileToRename?.originalName ?? "")
                }
              >
                Rename
              </Button>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Media Manager for Uploading Files */}
      <MediaManager
        isOpen={uploadDialogOpen}
        onClose={() => {
          setUploadDialogOpen(false)
          // Reload files after closing (in case files were uploaded)
          loadMediaFiles(true)
        }}
        onFileSelected={(fileUrl, fileData) => {
          // When a file is selected/uploaded, reload the file list
          loadMediaFiles(true)
        }}
        title="Upload Files"
        description="Upload new files to your media library"
        allowedTypes={['image/*', 'video/*', 'audio/*', 'application/pdf']}
        maxFileSize={ORG_MEDIA_LIBRARY_MAX_FILE_SIZE_BYTES}
        allowConcurrentUploads
        isPublic={false}
        contentType="media"
        showSelectExisting={false}
        showEnterUrl={false}
      />
    </div>
  )
}
