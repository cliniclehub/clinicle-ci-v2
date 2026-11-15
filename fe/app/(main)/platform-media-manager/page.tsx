"use client"

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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { deleteMediaFileAction, listMediaFilesForSuperAdmin, renameMediaFileAction, updateMediaFileAction, type MediaFile } from '@/lib/actions/media-manager/media-manager-actions'
import { listOrganizations } from '@/lib/actions/organizations/organizations-platform-actions'
import { useRoles } from '@/lib/contexts/role-context'
import { formatStorageSize, formatStorageSizeDetail } from '@/lib/utils/format-storage-size'
import { createClientLogger } from '@/lib/utils/logger-client'
import { ColumnDef } from '@tanstack/react-table'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BarChart3,
  Calendar,
  Edit2,
  Eye,
  File,
  FileText,
  Globe,
  HardDrive,
  Image,
  Lock,
  MoreHorizontal,
  Music,
  Pencil,
  Search,
  Trash2,
  TrendingUp,
  Upload,
  Users,
  Video,
  Zap
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { toast } from "sonner"

interface OrgStorageData {
  orgId: string
  orgName: string
  domain: string
  totalFiles: number
  totalSize: number
  fileTypes: {
    images: number
    videos: number
    audio: number
    documents: number
    other: number
  }
  lastUpload: string
  monthlyGrowth: number
}

interface StorageSummary {
  totalOrgs: number
  totalStorage: number
  totalFiles: number
  averageStoragePerOrg: number
  topOrgs: OrgStorageData[]
}

export default function SuperAdminMediaManager() {
  const logger = createClientLogger('SuperAdminMediaManager')
  const { activeRole, isLoading: rolesLoading } = useRoles()
  const router = useRouter()
  const [orgsData, setOrgsData] = useState<OrgStorageData[]>([])
  const [summary, setSummary] = useState<StorageSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [sortBy, setSortBy] = useState<'name' | 'storage' | 'files' | 'growth'>('storage')
  const [selectedOrg, setSelectedOrg] = useState<OrgStorageData | null>(null)
  const [allOrgFiles, setAllOrgFiles] = useState<MediaFile[]>([]) // Store all files for filtering
  const [activeTab, setActiveTab] = useState('overview')
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [visibilityFilter, setVisibilityFilter] = useState<'all' | 'public' | 'private'>('all')
  
  // File table state
  const [files, setFiles] = useState<MediaFile[]>([])
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [fileSortBy, setFileSortBy] = useState<'name' | 'size' | 'date' | 'type'>('date')
  const [fileSortOrder, setFileSortOrder] = useState<"asc" | "desc">("desc")
  const [fileSearchTerm, setFileSearchTerm] = useState('')
  
  // Multiselect state
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())
  
  // Track thumbnail load errors
  const [thumbnailErrors, setThumbnailErrors] = useState<Set<string>>(new Set())

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
  const [updateProgress, setUpdateProgress] = useState(0)
  
  // Rename dialog state
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [fileToRename, setFileToRename] = useState<MediaFile | null>(null)
  const [newFileName, setNewFileName] = useState('')
  const [renaming, setRenaming] = useState(false)
  
  // Refresh key to force table re-render
  const [refreshKey, setRefreshKey] = useState(0)

  // Check if user has super admin role (wait for roles to finish loading)
  useEffect(() => {
    if (rolesLoading) return
    if (activeRole !== 'super_admin') {
      toast.error("Access denied. Super admin role required.")
      router.push('/unauthorized')
      return
    }
  }, [rolesLoading, activeRole, router])

  // Load all organizations data
  const loadOrgsData = async () => {
    if (activeRole !== 'super_admin') return
    
    setLoading(true)
    try {
      // Get ALL organizations from the database (not just user's orgs)
      const allOrgsResponse = await listOrganizations({
        page: 1,
        pageSize: 100,
        search: "",
        isActive: true,
        orgType: "",
        sortBy: "created_at",
        sortOrder: "desc"
      })

      if (allOrgsResponse.status === "error") {
        toast.error(allOrgsResponse.message || "Failed to fetch organizations")
        return
      }

      if (!allOrgsResponse.data || allOrgsResponse.data.length === 0) {
        throw new Error('No organizations found')
      }

      const orgsStorageData: OrgStorageData[] = []

      // Process each organization
      for (const org of allOrgsResponse.data) {
        try {
          // Load files from both private and public buckets
          const [privateFiles, publicFiles] = await Promise.all([
            listMediaFilesForSuperAdmin(org.id, '', false),  // Private bucket
            listMediaFilesForSuperAdmin(org.id, '', true)    // Public bucket
          ])
          const files = [...privateFiles, ...publicFiles]
          
          const totalSize = files.reduce((sum, file) => sum + file.size, 0)
          const fileTypes = {
            images: files.filter(f => f.mimetype.startsWith('image/')).length,
            videos: files.filter(f => f.mimetype.startsWith('video/')).length,
            audio: files.filter(f => f.mimetype.startsWith('audio/')).length,
            documents: files.filter(f => f.mimetype === 'application/pdf').length,
            other: files.filter(f => !f.mimetype.startsWith('image/') && !f.mimetype.startsWith('video/') && !f.mimetype.startsWith('audio/') && f.mimetype !== 'application/pdf').length
          }

          const lastUpload = files.length > 0 
            ? files.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())[0].uploadedAt
            : 'Never'

          // Simulate monthly growth (in real app, you'd calculate this from historical data)
          const monthlyGrowth = Math.random() * 20 - 10 // -10% to +10%

          orgsStorageData.push({
            orgId: org.id,
            orgName: org.name,
            domain: org.domain,
            totalFiles: files.length,
            totalSize,
            fileTypes,
            lastUpload,
            monthlyGrowth
          })
        } catch (error) {
          logger.error(`Error loading data for org ${org.id}`, error as Error)
          // Add org with zero data if there's an error
          orgsStorageData.push({
            orgId: org.id,
            orgName: org.name,
            domain: org.domain,
            totalFiles: 0,
            totalSize: 0,
            fileTypes: { images: 0, videos: 0, audio: 0, documents: 0, other: 0 },
            lastUpload: 'Never',
            monthlyGrowth: 0
          })
        }
      }

      setOrgsData(orgsStorageData)

      // Calculate summary
      const totalStorage = orgsStorageData.reduce((sum, org) => sum + org.totalSize, 0)
      const totalFiles = orgsStorageData.reduce((sum, org) => sum + org.totalFiles, 0)
      const averageStoragePerOrg = orgsStorageData.length > 0 ? totalStorage / orgsStorageData.length : 0
      const topOrgs = [...orgsStorageData].sort((a, b) => b.totalSize - a.totalSize).slice(0, 5)

      setSummary({
        totalOrgs: orgsStorageData.length,
        totalStorage,
        totalFiles,
        averageStoragePerOrg,
        topOrgs
      })

    } catch (error) {
      logger.error('Error loading organizations data', error as Error)
      toast.error("Failed to load organizations data")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (activeRole === 'super_admin') {
      loadOrgsData()
    }
  }, [activeRole])

  // Load files for selected organization and switch to details tab
  const handleViewFiles = async (org: OrgStorageData) => {
    setLoadingFiles(true)
    try {
      // Load files from both private and public buckets
      const [privateFiles, publicFiles] = await Promise.all([
        listMediaFilesForSuperAdmin(org.orgId, '', false),  // Private bucket
        listMediaFilesForSuperAdmin(org.orgId, '', true)    // Public bucket
      ])
      
      // Mark files with their visibility (isPublic property)
      const privateFilesWithVisibility = privateFiles.map(file => ({ ...file, isPublic: false }))
      const publicFilesWithVisibility = publicFiles.map(file => ({ ...file, isPublic: true }))
      
      // Combine files from both buckets
      const allFiles = [...privateFilesWithVisibility, ...publicFilesWithVisibility]
      setAllOrgFiles(allFiles)
      setFiles(allFiles)
      setSelectedOrg(org)
      setVisibilityFilter('all') // Reset filter when loading new org
      setCurrentPage(1) // Reset pagination
      setFileSearchTerm('') // Reset search
      setSelectedFiles(new Set()) // Clear selection
      setActiveTab('details') // Switch to details tab
    } catch (error) {
      logger.error('Error loading org files', error as Error, { orgId: org.orgId })
      toast.error("Failed to load organization files")
    } finally {
      setLoadingFiles(false)
    }
  }

  // Filter, sort, and paginate files
  const filteredAndSortedFiles = useMemo(() => {
    let result = [...allOrgFiles]
    
    // Apply visibility filter
    if (visibilityFilter === 'public') {
      result = result.filter(file => (file as MediaFile & { isPublic?: boolean }).isPublic === true)
    } else if (visibilityFilter === 'private') {
      result = result.filter(file => (file as MediaFile & { isPublic?: boolean }).isPublic === false)
    }
    
    // Apply search filter
    if (fileSearchTerm) {
      result = result.filter(file => 
        file.originalName.toLowerCase().includes(fileSearchTerm.toLowerCase())
      )
    }
    
    // Apply sorting
    result.sort((a, b) => {
      let comparison = 0
      switch (fileSortBy) {
        case 'name':
          comparison = a.originalName.localeCompare(b.originalName)
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
      return fileSortOrder === 'asc' ? -comparison : comparison
    })
    
    return result
  }, [allOrgFiles, fileSearchTerm, fileSortBy, fileSortOrder, visibilityFilter])

  // Paginate files
  const paginatedFiles = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize
    const endIndex = startIndex + pageSize
    return filteredAndSortedFiles.slice(startIndex, endIndex)
  }, [filteredAndSortedFiles, currentPage, pageSize])

  // Update displayed files when pagination changes
  useEffect(() => {
    setFiles(paginatedFiles)
    setRefreshKey(prev => prev + 1)
  }, [paginatedFiles])

  const formatFileSize = (bytes: number) => formatStorageSize(bytes, "decimal")

  // Format date
  const formatDate = (dateString: string) => {
    if (dateString === 'Never') return 'Never'
    return new Date(dateString).toLocaleDateString()
  }

  // Format duration from seconds to HH:MM:SS or MM:SS
  const formatDuration = (seconds: number | undefined): string => {
    if (!seconds || seconds <= 0) return ''
    
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const secs = seconds % 60
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`
  }

  // Get file type icon
  const getFileIcon = (mimetype: string) => {
    if (mimetype.startsWith('image/')) return <Image className="w-4 h-4" />
    if (mimetype.startsWith('video/')) return <Video className="w-4 h-4" />
    if (mimetype.startsWith('audio/')) return <Music className="w-4 h-4" />
    if (mimetype === 'application/pdf') return <FileText className="w-4 h-4" />
    return <File className="w-4 h-4" />
  }

  // Handle delete click
  const handleDeleteClick = (file: MediaFile) => {
    setFileToDelete(file)
    setDeleteDialogOpen(true)
  }

  // Handle confirm delete
  const handleConfirmDelete = async () => {
    if (!fileToDelete) return

    setDeleting(true)
    try {
      await deleteMediaFileAction(fileToDelete.id)
      toast.success(`Deleted ${fileToDelete.originalName}`)
      
      // Reload files
      if (selectedOrg) {
        await handleViewFiles(selectedOrg)
      }
      
      setDeleteDialogOpen(false)
      setFileToDelete(null)
    } catch (error) {
      logger.error('Delete error', error as Error, { fileId: fileToDelete.id })
      toast.error("Failed to delete file")
    } finally {
      setDeleting(false)
    }
  }

  // Handle bulk delete click
  const handleBulkDeleteClick = () => {
    if (selectedFiles.size === 0) return
    setBulkDeleteDialogOpen(true)
  }

  // Handle confirm bulk delete
  const handleConfirmBulkDelete = async () => {
    if (selectedFiles.size === 0) return

    setDeleting(true)
    try {
      const deletePromises = Array.from(selectedFiles).map(fileId => {
        const file = allOrgFiles.find(f => f.id === fileId)
        return file ? deleteMediaFileAction(file.id) : Promise.resolve()
      })
      
      await Promise.all(deletePromises)
      toast.success(`Deleted ${selectedFiles.size} file${selectedFiles.size !== 1 ? 's' : ''}`)
      
      // Reload files
      if (selectedOrg) {
        await handleViewFiles(selectedOrg)
      }
      
      setBulkDeleteDialogOpen(false)
      setSelectedFiles(new Set())
    } catch (error) {
      logger.error('Bulk delete error', error as Error)
      toast.error("Failed to delete some files")
    } finally {
      setDeleting(false)
    }
  }

  // Handle rename click
  const handleRenameClick = (file: MediaFile) => {
    setFileToRename(file)
    setNewFileName(file.originalName)
    setRenameDialogOpen(true)
  }

  // Handle confirm rename
  const handleConfirmRename = async () => {
    if (!fileToRename || !newFileName.trim()) {
      toast.error("Please enter a file name")
      return
    }

    setRenaming(true)
    try {
      await renameMediaFileAction(fileToRename.id, newFileName.trim())
      toast.success(`Renamed to ${newFileName.trim()}`)
      
      // Reload files
      if (selectedOrg) {
        await handleViewFiles(selectedOrg)
      }
      
      setRenameDialogOpen(false)
      setFileToRename(null)
      setNewFileName('')
    } catch (error) {
      logger.error('Rename error', error as Error, { fileId: fileToRename?.id })
      toast.error("Failed to rename file")
    } finally {
      setRenaming(false)
    }
  }

  // Handle update click
  const handleUpdateClick = (file: MediaFile) => {
    setFileToUpdate(file)
    setUpdateFileName(file.originalName)
    setUpdateDialogOpen(true)
  }

  // Handle update file select
  const handleUpdateFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setSelectedFile(file)
      if (!updateFileName || updateFileName === fileToUpdate?.originalName) {
        setUpdateFileName(file.name)
      }
    }
  }

  // Handle confirm update
  const handleConfirmUpdate = async () => {
    if (!fileToUpdate || !selectedFile) {
      toast.error("Please select a file to update")
      return
    }

    setUpdating(true)
    setUpdateProgress(0)

    // Simulate progress
    const progressInterval = setInterval(() => {
      setUpdateProgress(prev => {
        const newProgress = prev >= 90 ? 90 : prev + 10
        if (newProgress >= 90 && progressInterval) {
          clearInterval(progressInterval)
        }
        return newProgress
      })
    }, 200)

    try {
      const formData = new FormData()
      formData.append('file', selectedFile)
      formData.append('contentType', 'media')
      formData.append('fileName', updateFileName || selectedFile.name)

      await updateMediaFileAction(fileToUpdate.id, formData)
      
      if (progressInterval) {
        clearInterval(progressInterval)
      }
      setUpdateProgress(100)

      await new Promise(resolve => setTimeout(resolve, 300))
      
      // Reload files
      if (selectedOrg) {
        await handleViewFiles(selectedOrg)
      }
      
      toast.success(`Updated ${fileToUpdate.originalName} to ${updateFileName || selectedFile.name}`)
      setUpdateDialogOpen(false)
      setFileToUpdate(null)
      setUpdateFileName('')
      setSelectedFile(null)
      setUpdateProgress(0)
      
      if (updateFileInput) {
        updateFileInput.value = ''
      }
    } catch (error) {
      if (progressInterval) {
        clearInterval(progressInterval)
      }
      logger.error('Update error', error as Error, { fileId: fileToUpdate?.id })
      toast.error("Failed to update file")
      setUpdateProgress(0)
    } finally {
      setUpdating(false)
    }
  }

  // Column definitions for the file table
  const fileColumns: ColumnDef<MediaFile>[] = useMemo(() => [
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
          aria-label={`Select ${row.original.originalName}`}
        />
      ),
      enableSorting: false,
      enableHiding: false,
    },
    {
      id: "file",
      accessorKey: "originalName",
      header: ({ column }) => {
        const isSorted = fileSortBy === 'name'
        return (
          <Button
            variant="ghost"
            onClick={() => {
              const newSort = fileSortBy === 'name' && fileSortOrder === 'asc' ? 'desc' : 'asc'
              setFileSortBy('name')
              setFileSortOrder(newSort)
            }}
          >
            File
            {isSorted && fileSortOrder === 'asc' ? (
              <ArrowUp className="ml-2 h-4 w-4" />
            ) : isSorted && fileSortOrder === 'desc' ? (
              <ArrowDown className="ml-2 h-4 w-4" />
            ) : (
              <ArrowUpDown className="ml-2 h-4 w-4" />
            )}
          </Button>
        )
      },
      cell: ({ row }) => {
        const file = row.original
        return (
          <div className="flex items-center space-x-3">
            <div className="flex-shrink-0 w-12 h-12 rounded bg-muted flex items-center justify-center overflow-hidden">
              {(file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') && file.thumbnailUrl && !thumbnailErrors.has(file.id) ? (
                <img 
                  src={file.thumbnailUrl} 
                  alt={file.originalName}
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
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-medium truncate" title={file.originalName}>
                  {file.originalName}
                </p>
                {(file as MediaFile & { isPublic?: boolean }).isPublic === true ? (
                  <span title="Public file">
                    <Globe className="h-3 w-3 text-muted-foreground" />
                  </span>
                ) : (file as MediaFile & { isPublic?: boolean }).isPublic === false ? (
                  <span title="Private file">
                    <Lock className="h-3 w-3 text-muted-foreground" />
                  </span>
                ) : null}
                {file.duration && (file.mimetype.startsWith('video/') || file.mimetype.startsWith('audio/')) && (
                  <Badge variant="secondary" className="text-xs font-normal">
                    {formatDuration(file.duration)}
                  </Badge>
                )}
              </div>
            </div>
          </div>
        )
      },
    },
    {
      id: "size",
      accessorKey: "size",
      header: ({ column }) => {
        const isSorted = fileSortBy === 'size'
        return (
          <Button
            variant="ghost"
            onClick={() => {
              const newSort = fileSortBy === 'size' && fileSortOrder === 'asc' ? 'desc' : 'asc'
              setFileSortBy('size')
              setFileSortOrder(newSort)
            }}
          >
            Size
            {isSorted && fileSortOrder === 'asc' ? (
              <ArrowUp className="ml-2 h-4 w-4" />
            ) : isSorted && fileSortOrder === 'desc' ? (
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
        const isSorted = fileSortBy === 'type'
        return (
          <Button
            variant="ghost"
            onClick={() => {
              const newSort = fileSortBy === 'type' && fileSortOrder === 'asc' ? 'desc' : 'asc'
              setFileSortBy('type')
              setFileSortOrder(newSort)
            }}
          >
            Type
            {isSorted && fileSortOrder === 'asc' ? (
              <ArrowUp className="ml-2 h-4 w-4" />
            ) : isSorted && fileSortOrder === 'desc' ? (
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
      id: "uploadedAt",
      accessorKey: "uploadedAt",
      header: ({ column }) => {
        const isSorted = fileSortBy === 'date'
        return (
          <Button
            variant="ghost"
            onClick={() => {
              const newSort = fileSortBy === 'date' && fileSortOrder === 'asc' ? 'desc' : 'asc'
              setFileSortBy('date')
              setFileSortOrder(newSort)
            }}
          >
            Uploaded
            {isSorted && fileSortOrder === 'asc' ? (
              <ArrowUp className="ml-2 h-4 w-4" />
            ) : isSorted && fileSortOrder === 'desc' ? (
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
              <DropdownMenuItem onClick={() => window.open(file.url, '_blank')}>
                <Eye className="mr-2 h-4 w-4" />
                View
              </DropdownMenuItem>
              <DropdownMenuItem 
                onClick={() => handleRenameClick(file)}
                disabled={renaming}
              >
                <Edit2 className="mr-2 h-4 w-4" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem 
                onClick={() => handleUpdateClick(file)}
                disabled={updating}
              >
                <Pencil className="mr-2 h-4 w-4" />
                Update
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem 
                onClick={() => handleDeleteClick(file)}
                disabled={deleting}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
    },
  ], [fileSortBy, fileSortOrder, thumbnailErrors, renaming, updating, deleting, handleRenameClick, handleUpdateClick, handleDeleteClick, formatFileSize, formatDate, formatDuration, getFileIcon])

  // Filter and sort organizations
  const filteredAndSortedOrgs = orgsData
    .filter(org => 
      org.orgName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      org.domain.toLowerCase().includes(searchTerm.toLowerCase())
    )
    .sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return a.orgName.localeCompare(b.orgName)
        case 'storage':
          return b.totalSize - a.totalSize
        case 'files':
          return b.totalFiles - a.totalFiles
        case 'growth':
          return b.monthlyGrowth - a.monthlyGrowth
        default:
          return 0
      }
    })

  if (activeRole !== 'super_admin') {
    return null // Will redirect in useEffect
  }

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-lg font-medium">Loading organizations data...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Storage Management</h1>
          <p className="text-muted-foreground">
            Monitor storage usage across all organizations
          </p>
        </div>
        <Button onClick={loadOrgsData}>
          <Zap className="w-4 h-4 mr-2" />
          Refresh Data
        </Button>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Organizations</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary.totalOrgs}</div>
              <p className="text-xs text-muted-foreground">
                All organizations
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Storage</CardTitle>
              <HardDrive className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatFileSize(summary.totalStorage)}</div>
              <p className="text-xs text-muted-foreground">
                Across all organizations
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Files</CardTitle>
              <File className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary.totalFiles.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground">
                Media files stored
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Avg Storage/Org</CardTitle>
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatFileSize(summary.averageStoragePerOrg)}</div>
              <p className="text-xs text-muted-foreground">
                Per organization
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Main Content */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="organizations">Organizations</TabsTrigger>
          <TabsTrigger value="details">Details</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Top Organizations */}
            <Card>
              <CardHeader>
                <CardTitle>Top Storage Users</CardTitle>
                <CardDescription>
                  Organizations using the most storage
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {summary?.topOrgs.map((org, index) => (
                    <div key={org.orgId} className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium">
                          {index + 1}
                        </div>
                        <div>
                          <p className="font-medium">{org.orgName}</p>
                          <p className="text-sm text-muted-foreground">{org.domain}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-medium">{formatFileSize(org.totalSize)}</p>
                        <p className="text-sm text-muted-foreground">{org.totalFiles} files</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Storage Distribution */}
            <Card>
              <CardHeader>
                <CardTitle>Storage Distribution</CardTitle>
                <CardDescription>
                  How storage is distributed across organizations
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {summary?.topOrgs.map((org) => {
                    const percentage = (org.totalSize / summary.totalStorage) * 100
                    return (
                      <div key={org.orgId} className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span>{org.orgName}</span>
                          <span>{percentage.toFixed(1)}%</span>
                        </div>
                        <Progress value={percentage} className="h-2" />
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="organizations" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>All Organizations</CardTitle>
              <CardDescription>
                Detailed storage information for each organization
              </CardDescription>
            </CardHeader>
            <CardContent>
              {/* Search and Filter */}
              <div className="flex gap-4 mb-4">
                <div className="flex-1">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                    <Input
                      placeholder="Search organizations..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                </div>
                <Select value={sortBy} onValueChange={(value: any) => setSortBy(value)}>
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder="Sort by" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="name">Name</SelectItem>
                    <SelectItem value="storage">Storage Used</SelectItem>
                    <SelectItem value="files">File Count</SelectItem>
                    <SelectItem value="growth">Growth Rate</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Organizations Table */}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Organization</TableHead>
                    <TableHead>Storage Used</TableHead>
                    <TableHead>Files</TableHead>
                    <TableHead>File Types</TableHead>
                    <TableHead>Last Upload</TableHead>
                    <TableHead>Growth</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAndSortedOrgs.map((org) => (
                    <TableRow key={org.orgId}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{org.orgName}</p>
                          <p className="text-sm text-muted-foreground">{org.domain}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium">{formatFileSize(org.totalSize)}</p>
                          <p className="text-sm text-muted-foreground">
                            {((org.totalSize / (summary?.totalStorage || 1)) * 100).toFixed(1)}% of total
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{org.totalFiles.toLocaleString()}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {org.fileTypes.images > 0 && (
                            <Badge variant="outline" className="text-xs">
                              <Image className="w-3 h-3 mr-1" />
                              {org.fileTypes.images}
                            </Badge>
                          )}
                          {org.fileTypes.videos > 0 && (
                            <Badge variant="outline" className="text-xs">
                              <Video className="w-3 h-3 mr-1" />
                              {org.fileTypes.videos}
                            </Badge>
                          )}
                          {org.fileTypes.documents > 0 && (
                            <Badge variant="outline" className="text-xs">
                              <FileText className="w-3 h-3 mr-1" />
                              {org.fileTypes.documents}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-muted-foreground">
                          {formatDate(org.lastUpload)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className={`flex items-center ${org.monthlyGrowth >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          <TrendingUp className={`w-4 h-4 mr-1 ${org.monthlyGrowth < 0 ? 'rotate-180' : ''}`} />
                          <span className="text-sm font-medium">
                            {org.monthlyGrowth >= 0 ? '+' : ''}{org.monthlyGrowth.toFixed(1)}%
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleViewFiles(org)}
                          disabled={loadingFiles}
                        >
                          <Eye className="w-4 h-4 mr-2" />
                          {loadingFiles ? 'Loading...' : 'View Files'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="details" className="space-y-4">
          {selectedOrg ? (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>All Files</CardTitle>
                    <CardDescription>
                      Manage all media files for {selectedOrg.orgName}
                    </CardDescription>
                  </div>
                  {selectedFiles.size > 0 && (
                    <Button 
                      variant="destructive" 
                      size="sm" 
                      onClick={handleBulkDeleteClick}
                      disabled={deleting}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete Selected ({selectedFiles.size})
                    </Button>
                  )}
                </div>
                
                {/* Visibility Filter Buttons */}
                <div className="flex items-center gap-2 mt-4">
                  <span className="text-sm font-medium text-muted-foreground">Visibility:</span>
                  <div className="flex gap-2">
                    <Button
                      variant={visibilityFilter === 'all' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => {
                        setVisibilityFilter('all')
                        setCurrentPage(1)
                      }}
                    >
                      All Files
                      <Badge variant="secondary" className="ml-2">
                        {allOrgFiles.length}
                      </Badge>
                    </Button>
                    <Button
                      variant={visibilityFilter === 'public' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => {
                        setVisibilityFilter('public')
                        setCurrentPage(1)
                      }}
                    >
                      <Globe className="mr-2 h-4 w-4" />
                      Public
                      <Badge variant="secondary" className="ml-2">
                        {allOrgFiles.filter(f => (f as MediaFile & { isPublic?: boolean }).isPublic === true).length}
                      </Badge>
                    </Button>
                    <Button
                      variant={visibilityFilter === 'private' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => {
                        setVisibilityFilter('private')
                        setCurrentPage(1)
                      }}
                    >
                      <Lock className="mr-2 h-4 w-4" />
                      Private
                      <Badge variant="secondary" className="ml-2">
                        {allOrgFiles.filter(f => (f as MediaFile & { isPublic?: boolean }).isPublic === false).length}
                      </Badge>
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <DataTableServerSide
                  key={`media-table-${refreshKey}`}
                  columns={fileColumns}
                  data={files}
                  searchKey="originalName"
                  searchPlaceholder="Search files..."
                  pageSize={pageSize}
                  pageSizeOptions={[10, 20, 30, 50, 100]}
                  totalItems={filteredAndSortedFiles.length}
                  currentPage={currentPage}
                  isLoading={loadingFiles}
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
                    setFileSearchTerm(search)
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
                        'type': 'type'
                      }
                      const mappedSort = sortMap[columnId] || 'date'
                      setFileSortBy(mappedSort)
                      setFileSortOrder(direction)
                      setCurrentPage(1)
                    }
                  }}
                  activeFilters={{}}
                  sortColumn={fileSortBy === 'name' ? 'file' : fileSortBy === 'size' ? 'size' : fileSortBy === 'date' ? 'uploadedAt' : 'type'}
                  sortDirection={fileSortOrder}
                />
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="text-center py-8">
                <HardDrive className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                <p className="text-muted-foreground">Select an organization to view detailed file information</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete File</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{fileToDelete?.originalName}</strong>? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? 'Deleting...' : 'Delete'}
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
              Are you sure you want to delete <strong>{selectedFiles.size}</strong> file{selectedFiles.size !== 1 ? 's' : ''}? This action cannot be undone.
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

      {/* Rename File Dialog */}
      <Dialog open={renameDialogOpen} onOpenChange={(open) => {
        if (!open && !renaming) {
          setRenameDialogOpen(false)
          setFileToRename(null)
          setNewFileName('')
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename File</DialogTitle>
            <DialogDescription>
              Enter a new name for <strong>{fileToRename?.originalName}</strong>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="new-file-name">File Name</Label>
              <Input
                id="new-file-name"
                type="text"
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                placeholder={fileToRename?.originalName || "Enter file name"}
                disabled={renaming}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setRenameDialogOpen(false)
                setFileToRename(null)
                setNewFileName('')
              }}
              disabled={renaming}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleConfirmRename}
              disabled={renaming || !newFileName.trim()}
            >
              {renaming ? 'Renaming...' : 'Rename'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Update File Dialog */}
      <Dialog open={updateDialogOpen} onOpenChange={(open) => {
        if (!open && !updating) {
          setUpdateDialogOpen(false)
          setUpdateFileName('')
          setFileToUpdate(null)
          setSelectedFile(null)
          setUpdateProgress(0)
          if (updateFileInput) {
            updateFileInput.value = ''
          }
        }
      }}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Update File</DialogTitle>
            <DialogDescription>
              Select a new file to replace <strong>{fileToUpdate?.originalName}</strong>. The file will keep the same reference ID ({fileToUpdate?.id.split('/').pop()}).
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
                  placeholder={fileToUpdate?.originalName || "Enter file name"}
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
              type="button"
              variant="outline"
              onClick={() => {
                setUpdateDialogOpen(false)
                setUpdateFileName('')
                setFileToUpdate(null)
                setSelectedFile(null)
                setUpdateProgress(0)
                if (updateFileInput) {
                  updateFileInput.value = ''
                }
              }}
              disabled={updating}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleConfirmUpdate}
              disabled={updating || !selectedFile}
            >
              {updating ? 'Updating...' : 'Update File'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

