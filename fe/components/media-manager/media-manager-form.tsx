"use client"

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  listMediaFilesAction,
  uploadFileAction,
  type MediaFile,
} from '@/lib/actions/media-manager/media-manager-actions'
import { getPublicMediaListPrefix } from '@/lib/utils/public-media-paths'
import { useAuth } from '@/lib/contexts/auth-context'
import { useChunkedUpload } from '@/lib/hooks/use-chunked-upload'
import { ChunkedUploadProgress } from '@/lib/utils/chunked-upload-service'
import {
  formatAllowedTypesLabel,
  getDefaultUrlFileType,
  getUrlFileTypeOptions,
  getUrlTabPlaceholders,
  isUrlFileTypeAllowed,
} from '@/lib/utils/format-allowed-types-label'
import {
  filenameFromMediaUrl,
  isHostedOrgMediaUrl,
  stripUrlTokenForDisplay,
  toPersistableMediaUrl,
} from '@/lib/utils/media-url-display'
import { createClientLogger } from '@/lib/utils/logger-client'
import { formatStorageLimit, formatStorageSize } from '@/lib/utils/format-storage-size'
import {
  shouldUseChunkedMediaUpload,
  uploadMediaLibraryFile,
} from '@/lib/utils/media-file-upload'
import {
  Calendar,
  Check,
  File,
  FileText,
  Globe,
  HardDrive,
  Image,
  LayoutGrid,
  List,
  Music,
  Search,
  Upload,
  Video,
  X
} from 'lucide-react'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from "sonner"

interface MediaManagerProps {
  isOpen: boolean
  onClose: () => void
  onFileSelected: (fileUrl: string, fileData: MediaFile) => void
  title?: string
  description?: string
  allowedTypes?: string[]
  maxFileSize?: number
  isPublic?: boolean // If true, uploads to the public image bucket.
  contentType?: string // Content type (for example: 'public-image', 'logo', 'favicon', 'media')
  showSelectExisting?: boolean // If false, hides "Select Existing" tab
  showEnterUrl?: boolean // If false, hides "Enter URL" tab
  loadFromBothBuckets?: boolean // If true, loads from both private and public buckets for "Select Existing"
  /** When true, render body only (parent supplies Dialog shell). Avoids nested dialogs. */
  embedded?: boolean
  /** Saved media URL on the content/field being edited — shown in Enter URL tab. */
  currentMediaUrl?: string | null
  /** When false, pass the raw/signed URL through (needed for TipTap img preview). Default true. */
  emitPersistableUrls?: boolean
  /** Org media library: select and upload multiple files concurrently. */
  allowConcurrentUploads?: boolean
}

type ConcurrentUploadJob = {
  id: string
  file: File
  displayName: string
  status: 'pending' | 'uploading' | 'completed' | 'failed'
  progress: number
  error?: string
  usesChunked: boolean
}

type ConcurrentBatchOutcome = {
  succeeded: number
  failed: number
}

const MediaManager: React.FC<MediaManagerProps> = ({
  isOpen,
  onClose,
  onFileSelected,
  title = "Media Manager",
  description = "Upload new files or select from existing media",
  allowedTypes = ['image/*', 'video/*', 'audio/*', 'application/pdf'],
  maxFileSize = 100 * 1024 * 1024,
  isPublic = false, // NEW: Default to private bucket
  contentType = 'media', // NEW: Default content type
  showSelectExisting = true, // Default to showing all tabs
  showEnterUrl = true, // Default to showing all tabs
  loadFromBothBuckets = false, // Default to single bucket
  embedded = false,
  currentMediaUrl = null,
  emitPersistableUrls = true,
  allowConcurrentUploads = false,
}) => {
  const { user } = useAuth()
  
  const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedType, setSelectedType] = useState<string>('all')
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [selectedFile, setSelectedFile] = useState<MediaFile | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const [urlFileName, setUrlFileName] = useState('')
  const [urlFileType, setUrlFileType] = useState(() => getDefaultUrlFileType(['image/*', 'video/*', 'audio/*', 'application/pdf']))
  const [thumbnailErrors, setThumbnailErrors] = useState<Set<string>>(new Set())
  const [customFileName, setCustomFileName] = useState('')
  const [selectedFileForUpload, setSelectedFileForUpload] = useState<File | null>(null)
  const [chunkedProgress, setChunkedProgress] = useState<ChunkedUploadProgress | null>(null)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [activeTab, setActiveTab] = useState<string>('upload')
  const [concurrentJobs, setConcurrentJobs] = useState<ConcurrentUploadJob[]>([])
  const [concurrentUploading, setConcurrentUploading] = useState(false)
  const [concurrentBatchOutcome, setConcurrentBatchOutcome] =
    useState<ConcurrentBatchOutcome | null>(null)
  const logger = useMemo(() => createClientLogger('MediaManager'), [])

  // Chunked upload hook for large files
  const {
    upload: chunkedUpload,
    abort: abortChunkedUpload,
    isUploading: isChunkedUploading,
    progress: chunkedUploadProgress,
    shouldUseChunkedUpload
  } = useChunkedUpload({
    onProgress: (progress) => {
      setChunkedProgress(progress)
      setUploadProgress(progress.percentage)
    },
    onError: (error) => {
      logger.error('Chunked upload error', error)
      toast.error(`Upload failed: ${error.message}`)
    }
  })

  const savedMediaUrl = useMemo(() => currentMediaUrl?.trim() ?? "", [currentMediaUrl])
  const savedUrlIsHosted = useMemo(
    () => (savedMediaUrl ? isHostedOrgMediaUrl(savedMediaUrl) : false),
    [savedMediaUrl]
  )
  const savedUrlDisplay = useMemo(
    () => (savedMediaUrl ? stripUrlTokenForDisplay(savedMediaUrl) : ""),
    [savedMediaUrl]
  )
  const savedMediaFileName = useMemo(
    () => (savedMediaUrl ? filenameFromMediaUrl(savedMediaUrl) : ""),
    [savedMediaUrl]
  )
  const emitFileSelected = useCallback(
    (fileUrl: string, fileData: MediaFile) => {
      const url = emitPersistableUrls ? toPersistableMediaUrl(fileUrl) : fileUrl
      onFileSelected(url, { ...fileData, url })
    },
    [emitPersistableUrls, onFileSelected]
  )
  const isImageOnlyPicker = useMemo(
    () =>
      allowedTypes.length > 0 &&
      allowedTypes.every((t) => t === "image/*" || t.startsWith("image/")),
    [allowedTypes]
  )

  // Reset on close; initialize URL fields when opening with a saved value
  useEffect(() => {
    if (!isOpen) {
      setSelectedFile(null)
      setUploadProgress(0)
      setUploading(false)
      setSearchTerm('')
      setSelectedType('all')
      setUrlInput('')
      setUrlFileName('')
      setUrlFileType(getDefaultUrlFileType(allowedTypes))
      setThumbnailErrors(new Set())
      setCustomFileName('')
      setSelectedFileForUpload(null)
      setViewMode('grid')
      setActiveTab('upload')
      setConcurrentJobs([])
      setConcurrentUploading(false)
      setConcurrentBatchOutcome(null)
      return
    }

    setUrlFileType(getDefaultUrlFileType(allowedTypes))
    if (savedMediaUrl && !savedUrlIsHosted) {
      setUrlInput(savedMediaUrl)
      const name = filenameFromMediaUrl(savedMediaUrl)
      setUrlFileName(name)
    } else {
      setUrlInput('')
      setUrlFileName('')
    }
  }, [isOpen, allowedTypes, savedMediaUrl, savedUrlIsHosted])

  const publicListPrefix = useMemo(
    () => (isPublic ? getPublicMediaListPrefix(contentType) : ''),
    [contentType, isPublic]
  )

  // Load media files from the collection
  const loadMediaFiles = useCallback(async () => {
    try {
      if (loadFromBothBuckets) {
        // Load from both private and public buckets (e.g. for rich text image picker)
        const results = await Promise.allSettled([
          listMediaFilesAction('', false), // Private bucket
          listMediaFilesAction('', true)   // Public bucket (all org public folders)
        ])
        const privateFiles = results[0].status === 'fulfilled' ? results[0].value : []
        const publicFiles = results[1].status === 'fulfilled' ? results[1].value : []
        setMediaFiles([...privateFiles, ...publicFiles])
        setThumbnailErrors(new Set())
      } else {
        // Single bucket; scope public listings to logos/ or images/ when applicable
        const data = await listMediaFilesAction(publicListPrefix, isPublic)
        setMediaFiles(data)
        setThumbnailErrors(new Set())
      }
    } catch (error) {
      logger.error('Error loading media files', error instanceof Error ? error : new Error(String(error)))
      toast.error("Failed to load media files")
    }
  }, [isPublic, loadFromBothBuckets, logger, publicListPrefix])

  useEffect(() => {
    if (isOpen) {
      loadMediaFiles()
    }
  }, [isOpen, loadMediaFiles])

  const formatFileSize = (bytes: number) => formatStorageSize(bytes, "decimal")
  const formatLimit = (bytes: number) => formatStorageLimit(bytes)
  const supportedFormatsMessage = useMemo(
    () => formatAllowedTypesLabel(allowedTypes),
    [allowedTypes]
  )
  const urlFileTypeOptions = useMemo(() => getUrlFileTypeOptions(allowedTypes), [allowedTypes])
  const urlTabPlaceholders = useMemo(() => getUrlTabPlaceholders(allowedTypes), [allowedTypes])

  const pendingConcurrentCount = useMemo(
    () => concurrentJobs.filter((job) => job.status === 'pending').length,
    [concurrentJobs],
  )

  const concurrentUploadFinished =
    allowConcurrentUploads &&
    concurrentBatchOutcome !== null &&
    !concurrentUploading &&
    pendingConcurrentCount === 0

  useEffect(() => {
    if (!isUrlFileTypeAllowed(urlFileType, allowedTypes)) {
      setUrlFileType(getDefaultUrlFileType(allowedTypes))
    }
  }, [allowedTypes, urlFileType])

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

  const validateFileForUpload = useCallback((file: File): string | null => {
    const isValidType = allowedTypes.some((type) => {
      if (type === '*/*') return true
      if (type.endsWith('/*')) {
        const baseType = type.replace('/*', '')
        return file.type.startsWith(baseType)
      }
      return file.type === type
    })
    if (!isValidType) {
      return `File type ${file.type || 'unknown'} is not allowed`
    }
    if (file.size > maxFileSize) {
      return `File size must be less than ${formatLimit(maxFileSize)}`
    }
    return null
  }, [allowedTypes, maxFileSize])

  const addFilesToConcurrentQueue = useCallback((files: FileList | File[]) => {
    const incoming = Array.from(files)
    if (!incoming.length) return

    const nextJobs: ConcurrentUploadJob[] = []
    for (const file of incoming) {
      const validationError = validateFileForUpload(file)
      if (validationError) {
        toast.error(`${file.name}: ${validationError}`)
        continue
      }
      nextJobs.push({
        id: crypto.randomUUID(),
        file,
        displayName: file.name,
        status: 'pending',
        progress: 0,
        usesChunked: shouldUseChunkedMediaUpload(file),
      })
    }

    if (!nextJobs.length) return
    setConcurrentBatchOutcome(null)
    setConcurrentJobs((prev) => [...prev, ...nextJobs])
  }, [validateFileForUpload])

  const updateConcurrentJob = useCallback(
    (jobId: string, patch: Partial<ConcurrentUploadJob>) => {
      setConcurrentJobs((prev) =>
        prev.map((job) => (job.id === jobId ? { ...job, ...patch } : job)),
      )
    },
    [],
  )

  const removeConcurrentJob = useCallback((jobId: string) => {
    setConcurrentJobs((prev) => prev.filter((job) => job.id !== jobId))
  }, [])

  const handleConcurrentUploadAll = async () => {
    const pendingJobs = concurrentJobs.filter((job) => job.status === 'pending')
    if (!pendingJobs.length || concurrentUploading) return

    setConcurrentUploading(true)
    setConcurrentBatchOutcome(null)
    try {
      const results = await Promise.allSettled(
        pendingJobs.map(async (job) => {
          updateConcurrentJob(job.id, { status: 'uploading', progress: 0, error: undefined })
          const result = await uploadMediaLibraryFile(job.file, {
            isPublic,
            contentType,
            fileName: job.displayName,
            onProgress: (progress) => {
              updateConcurrentJob(job.id, { progress: progress.percentage })
            },
          })
          updateConcurrentJob(job.id, { status: 'completed', progress: 100 })
          emitFileSelected(result.url, result)
          return job.displayName
        }),
      )

      await loadMediaFiles()

      const succeeded = results.filter((result) => result.status === 'fulfilled').length
      const failed = results.length - succeeded
      results.forEach((result, index) => {
        if (result.status !== 'rejected') return
        const job = pendingJobs[index]
        if (!job) return
        const message =
          result.reason instanceof Error
            ? result.reason.message
            : 'Failed to upload file'
        updateConcurrentJob(job.id, { status: 'failed', error: message })
        toast.error(`${job.displayName}: ${message}`)
      })
      if (succeeded > 0 && failed === 0) {
        toast.success(
          succeeded === 1 ? 'Upload complete' : `All ${succeeded} files uploaded`,
        )
      } else if (succeeded > 0) {
        toast.message(`${succeeded} uploaded, ${failed} failed`)
      }
      setConcurrentBatchOutcome({ succeeded, failed })
    } finally {
      setConcurrentUploading(false)
    }
  }

  const handleConcurrentFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (!files?.length) return
    addFilesToConcurrentQueue(files)
    event.target.value = ''
  }

  const handleConcurrentDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    if (e.dataTransfer.files?.length) {
      addFilesToConcurrentQueue(e.dataTransfer.files)
    }
  }, [addFilesToConcurrentQueue])

  // Handle file selection (before upload)
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (!files || files.length === 0) return

    const file = files[0]
    
    // Validate file type
    const isValidType = allowedTypes.some(type => {
      // Allow all types if */* is specified
      if (type === '*/*') {
        return true
      }
      if (type.endsWith('/*')) {
        const baseType = type.replace('/*', '')
        return file.type.startsWith(baseType)
      }
      return file.type === type
    })

    if (!isValidType) {
      toast.error(`File type ${file.type} is not allowed`)
      return
    }

    // Validate file size
    if (file.size > maxFileSize) {
      toast.error(`File size must be less than ${formatLimit(maxFileSize)}`)
      return
    }

    // Set the selected file and pre-fill custom file name with original name
    setSelectedFileForUpload(file)
    setCustomFileName(file.name)
  }

  // Handle file upload with progress - uses chunked upload for large files
  const handleFileUpload = async () => {
    if (!selectedFileForUpload) return

    const file = selectedFileForUpload
    const useChunked = shouldUseChunkedUpload(file)
    
    setUploading(true)
    setUploadProgress(0)
    setChunkedProgress(null)

    try {
      if (useChunked) {
        // Use chunked upload for large files (> 100MB)
        logger.info('Using chunked upload for large file', {
          fileName: file.name,
          sizeMb: Number((file.size / 1024 / 1024).toFixed(2)),
        })
        
        const result = await chunkedUpload(file, {
          isPublic,
          contentType
        })

        if (result) {
          // Create MediaFile object from chunked upload result
          const response: MediaFile = {
            id: result.key,
            originalName: customFileName.trim() || file.name,
            url: result.url,
            size: result.size,
            mimetype: file.type,
            uploadedAt: new Date().toISOString()
          }

          // Show success toast
          const finalFileName = customFileName.trim() || file.name
          toast.success(`${finalFileName} uploaded successfully!`)
          
          // Return the full URL and close modal
          setTimeout(() => {
            emitFileSelected(response.url, response)
            onClose()
          }, 1000)
        }
      } else {
        // Use regular upload for smaller files
        const formData = new FormData()
        formData.append('file', file)
        
        // Add custom file name if provided
        if (customFileName.trim()) {
          formData.append('fileName', customFileName.trim())
        }
        
        // Add content type (use prop or default)
        formData.append('contentType', contentType)
        
        // Add isPublic flag if this is a public upload
        if (isPublic) {
          formData.append('isPublic', 'true')
        }

        // Simulate upload progress for smaller files
        const progressInterval = setInterval(() => {
          setUploadProgress(prev => {
            if (prev >= 90) {
              clearInterval(progressInterval)
              return prev
            }
            return prev + 10
          })
        }, 200)

        const response = await uploadFileAction(formData)
        
        // Complete progress
        setUploadProgress(100)
        clearInterval(progressInterval)
        
        // Show success toast with the final file name
        const finalFileName = customFileName.trim() || file.name
        toast.success(`${finalFileName} uploaded successfully!`)
        
        // Return the full URL and close modal
        setTimeout(() => {
          emitFileSelected(response.url, response)
          onClose()
        }, 1000)
      }
      
    } catch (error) {
      logger.error('Upload error', error instanceof Error ? error : new Error(String(error)))
      toast.error("Failed to upload file. Please try again.")
    } finally {
      setUploading(false)
      setSelectedFileForUpload(null)
      setCustomFileName('')
      setChunkedProgress(null)
    }
  }

  // Handle abort for chunked uploads
  const handleAbortUpload = async () => {
    if (isChunkedUploading) {
      await abortChunkedUpload()
      setUploading(false)
      setUploadProgress(0)
      setChunkedProgress(null)
      toast.info("Upload cancelled")
    }
  }

  // Handle drag and drop file selection
  const handleDropWithSelection = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0]
      
      // Validate file type
      const isValidType = allowedTypes.some(type => {
        // Allow all types if */* is specified
        if (type === '*/*') {
          return true
        }
        if (type.endsWith('/*')) {
          const baseType = type.replace('/*', '')
          return file.type.startsWith(baseType)
        }
        return file.type === type
      })

      if (!isValidType) {
        toast.error(`File type ${file.type} is not allowed`)
        return
      }

      // Validate file size
      if (file.size > maxFileSize) {
        toast.error(`File size must be less than ${formatLimit(maxFileSize)}`)
        return
      }

      // Set the selected file and pre-fill custom file name with original name
      setSelectedFileForUpload(file)
      setCustomFileName(file.name)
    }
  }, [allowedTypes, maxFileSize])

  // Handle URL input
  const handleUrlSubmit = () => {
    if (!urlInput.trim()) {
      toast.error("Please enter a valid URL")
      return
    }

    // Validate URL
    try {
      new URL(urlInput)
    } catch {
      toast.error("Please enter a valid URL")
      return
    }

    if (!isUrlFileTypeAllowed(urlFileType, allowedTypes)) {
      toast.error("This file type is not allowed for this upload")
      return
    }

    // Create a virtual file object from URL
    const fileName = urlFileName || `external-file-${Date.now()}`
    const virtualFile: MediaFile = {
      id: `url-${Date.now()}`,
      originalName: fileName,
      url: urlInput,
      size: 0, // Unknown size for external URLs
      mimetype: urlFileType,
      uploadedAt: new Date().toISOString()
    }

    // Return the external URL and close modal
    emitFileSelected(urlInput, virtualFile)
    onClose()
    
    toast.success("External URL has been added successfully!")
  }

  // Handle drag and drop
  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true)
    } else if (e.type === "dragleave") {
      setDragActive(false)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    if (allowConcurrentUploads) {
      handleConcurrentDrop(e)
      return
    }
    handleDropWithSelection(e)
  }, [allowConcurrentUploads, handleConcurrentDrop, handleDropWithSelection])

  // Helper function to check if a mimetype matches allowed types
  const matchesAllowedTypes = (mimetype: string): boolean => {
    return allowedTypes.some(allowedType => {
      // Allow all types if */* is specified
      if (allowedType === '*/*') return true
      if (allowedType.endsWith('/*')) {
        // Check if mimetype matches the base type (e.g., 'image/*' matches 'image/jpeg')
        const baseType = allowedType.replace('/*', '')
        return mimetype.startsWith(baseType)
      }
      // Exact match (e.g., 'application/pdf')
      return mimetype === allowedType
    })
  }

  // Filter media files based on search, type filter, and allowed types
  const filteredFiles = mediaFiles.filter(file => {
    const matchesSearch = file.originalName.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesTypeFilter = selectedType === 'all' || file.mimetype.startsWith(selectedType.replace('/*', ''))
    const matchesAllowed = matchesAllowedTypes(file.mimetype)
    return matchesSearch && matchesTypeFilter && matchesAllowed
  })

  // Get file type icon
  const getFileIcon = (mimetype: string) => {
    if (mimetype.startsWith('image/')) return <Image className="w-8 h-8" />
    if (mimetype.startsWith('video/')) return <Video className="w-8 h-8" />
    if (mimetype.startsWith('audio/')) return <Music className="w-8 h-8" />
    if (mimetype === 'application/pdf') return <FileText className="w-8 h-8" />
    return <File className="w-8 h-8" />
  }

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

  // Format date
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString()
  }

  // Handle existing file selection (from the media library)
  const handleExistingFileSelect = (file: MediaFile) => {
    setSelectedFile(file)
  }

  // Handle confirm selection
  const handleConfirmSelection = () => {
    if (selectedFile) {
      emitFileSelected(selectedFile.url, selectedFile)
      onClose()
    }
  }

  const scrollableContent = !user?.organizationId ? (
    <div className="text-center py-8 text-muted-foreground">
      <File className="w-12 h-12 mx-auto mb-4 opacity-50" />
      <p>Loading organization information...</p>
    </div>
  ) : (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className={`grid w-full ${
                !showSelectExisting && !showEnterUrl ? 'grid-cols-1' :
                showSelectExisting && showEnterUrl ? 'grid-cols-3' :
                'grid-cols-2'
              }`}>
                <TabsTrigger value="upload">Upload New</TabsTrigger>
                {showSelectExisting && (
                  <TabsTrigger value="select">Select Existing</TabsTrigger>
                )}
                {showEnterUrl && (
                  <TabsTrigger value="url">Enter URL</TabsTrigger>
                )}
              </TabsList>

              {savedMediaUrl ? (
                <div className="rounded-md border border-border bg-muted/40 p-3 space-y-2 mt-4">
                  <p className="text-xs font-medium text-muted-foreground m-0">
                    Current selected media
                  </p>
                  {isImageOnlyPicker ? (
                    <img
                      src={savedMediaUrl}
                      alt={savedMediaFileName || "Selected image"}
                      className="max-h-28 w-auto max-w-full rounded-md border border-border object-contain bg-background"
                    />
                  ) : null}
                  {savedMediaFileName ? (
                    <p className="text-sm font-medium text-foreground m-0 truncate" title={savedMediaFileName}>
                      {savedMediaFileName}
                    </p>
                  ) : null}
                  <p className="text-sm break-all m-0 font-mono text-muted-foreground">{savedUrlDisplay}</p>
                  {!savedUrlIsHosted && activeTab === "url" ? (
                    <p className="text-xs text-muted-foreground m-0">
                      External link saved for this content. Edit the field below or add a new URL to replace it.
                    </p>
                  ) : null}
                </div>
              ) : null}

              <TabsContent value="upload" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Upload className="w-5 h-5" />
                      Upload New File
                    </CardTitle>
                    <CardDescription>
                      {allowConcurrentUploads
                        ? 'Drag and drop files here or click to browse. Select multiple files to upload them in parallel.'
                        : 'Drag and drop a file here or click to browse'}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {allowConcurrentUploads ? (
                      <div className="space-y-4">
                        <div
                          className={`flex flex-col gap-3 rounded-lg border border-dashed px-4 py-3 transition-colors sm:flex-row sm:items-center sm:justify-between ${
                            dragActive
                              ? 'border-primary bg-primary/5'
                              : 'border-muted-foreground/30 bg-muted/20 hover:border-primary/50'
                          }`}
                          onDragEnter={handleDrag}
                          onDragLeave={handleDrag}
                          onDragOver={handleDrag}
                          onDrop={handleDrop}
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground">
                              <Upload className="h-5 w-5" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-foreground">
                                Drop files here or browse
                              </p>
                              <p className="truncate text-xs text-muted-foreground">
                                {supportedFormatsMessage} · Max {formatLimit(maxFileSize)}
                              </p>
                            </div>
                          </div>
                          <Input
                            type="file"
                            multiple
                            onChange={handleConcurrentFileSelect}
                            accept={allowedTypes.includes('*/*') ? undefined : allowedTypes.join(',')}
                            className="hidden"
                            id="file-upload-concurrent"
                            disabled={concurrentUploading}
                          />
                          <Label htmlFor="file-upload-concurrent">
                            <Button asChild disabled={concurrentUploading}>
                              <span className="w-full sm:w-auto">
                                <Upload className="w-4 h-4 mr-2" />
                                Choose Files
                              </span>
                            </Button>
                          </Label>
                        </div>

                        {concurrentJobs.length > 0 && (
                          <div className="space-y-3 pt-4 border-t">
                            {concurrentBatchOutcome && concurrentBatchOutcome.failed === 0 ? (
                              <Alert className="border-primary/30 bg-primary/5">
                                <Check className="h-4 w-4" />
                                <AlertTitle>Upload complete</AlertTitle>
                                <AlertDescription>
                                  {concurrentBatchOutcome.succeeded === 1
                                    ? 'Your file was uploaded successfully. Click Done when you are ready to close.'
                                    : `All ${concurrentBatchOutcome.succeeded} files uploaded successfully. Click Done when you are ready to close.`}
                                </AlertDescription>
                              </Alert>
                            ) : null}
                            {concurrentBatchOutcome && concurrentBatchOutcome.failed > 0 ? (
                              <Alert variant="destructive">
                                <AlertTitle>Some uploads failed</AlertTitle>
                                <AlertDescription>
                                  {concurrentBatchOutcome.succeeded} uploaded,{' '}
                                  {concurrentBatchOutcome.failed} failed. Review the errors below,
                                  then close or add files to try again.
                                </AlertDescription>
                              </Alert>
                            ) : null}
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm font-medium">
                                {concurrentUploading
                                  ? `Uploading ${concurrentJobs.filter((job) => job.status === 'uploading').length} of ${concurrentJobs.length} files...`
                                  : concurrentBatchOutcome && concurrentBatchOutcome.failed === 0
                                    ? `${concurrentBatchOutcome.succeeded} file${concurrentBatchOutcome.succeeded === 1 ? '' : 's'} uploaded`
                                    : `${concurrentJobs.length} file${concurrentJobs.length === 1 ? '' : 's'} in queue`}
                              </p>
                              {!concurrentUploading && pendingConcurrentCount === 0 ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    setConcurrentJobs([])
                                    setConcurrentBatchOutcome(null)
                                  }}
                                >
                                  Clear list
                                </Button>
                              ) : !concurrentUploading && pendingConcurrentCount > 0 ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    setConcurrentJobs([])
                                    setConcurrentBatchOutcome(null)
                                  }}
                                >
                                  Clear all
                                </Button>
                              ) : null}
                            </div>
                            <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
                              {concurrentJobs.map((job) => (
                                <div key={job.id} className="space-y-2 rounded-md border p-3">
                                  <div className="flex items-start gap-2">
                                    <File className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
                                    <div className="min-w-0 flex-1">
                                      <p className="text-sm font-medium truncate" title={job.displayName}>
                                        {job.displayName}
                                      </p>
                                      <p className="text-xs text-muted-foreground">
                                        {formatFileSize(job.file.size)}
                                        {job.usesChunked ? ' · Chunked upload' : ''}
                                      </p>
                                      {job.status === 'failed' && job.error ? (
                                        <p className="text-xs text-destructive mt-1">{job.error}</p>
                                      ) : null}
                                    </div>
                                    {job.status === 'pending' && !concurrentUploading ? (
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="shrink-0"
                                        onClick={() => removeConcurrentJob(job.id)}
                                      >
                                        <X className="w-4 h-4" />
                                      </Button>
                                    ) : null}
                                    {job.status === 'completed' ? (
                                      <Badge variant="secondary" className="shrink-0 text-xs">
                                        Uploaded
                                      </Badge>
                                    ) : null}
                                  </div>
                                  {(job.status === 'uploading' || job.status === 'completed') && (
                                    <Progress value={job.progress} className="w-full" />
                                  )}
                                </div>
                              ))}
                            </div>
                            {pendingConcurrentCount > 0 ? (
                              <Button
                                type="button"
                                className="w-full"
                                disabled={concurrentUploading}
                                onClick={() => void handleConcurrentUploadAll()}
                              >
                                <Upload className="w-4 h-4 mr-2" />
                                {concurrentUploading
                                  ? 'Uploading in parallel...'
                                  : `Upload ${pendingConcurrentCount} file${pendingConcurrentCount === 1 ? '' : 's'}`}
                              </Button>
                            ) : null}
                          </div>
                        )}
                      </div>
                    ) : uploading ? (
                      <div className="space-y-4">
                        <div className="text-center">
                          <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                          <p className="text-lg font-medium">
                            {chunkedProgress ? 'Uploading large file...' : 'Uploading file...'}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {chunkedProgress 
                              ? `Part ${chunkedProgress.uploadedParts} of ${chunkedProgress.totalParts}`
                              : 'Please wait while we upload your file'}
                          </p>
                        </div>
                        <div className="space-y-2">
                          <div className="flex justify-between text-sm">
                            <span>Progress</span>
                            <span>{uploadProgress}%</span>
                          </div>
                          <Progress value={uploadProgress} className="w-full" />
                          {chunkedProgress && (
                            <p className="text-xs text-muted-foreground text-center">
                              {(chunkedProgress.uploadedBytes / 1024 / 1024).toFixed(1)} MB / {(chunkedProgress.totalBytes / 1024 / 1024).toFixed(1)} MB
                            </p>
                          )}
                        </div>
                        {isChunkedUploading && (
                          <Button 
                            variant="outline" 
                            onClick={handleAbortUpload}
                            className="w-full"
                          >
                            <X className="w-4 h-4 mr-2" />
                            Cancel Upload
                          </Button>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div
                          className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                            dragActive 
                              ? 'border-primary bg-primary/5' 
                              : 'border-muted-foreground/25 hover:border-primary/50'
                          }`}
                          onDragEnter={handleDrag}
                          onDragLeave={handleDrag}
                          onDragOver={handleDrag}
                          onDrop={handleDrop}
                        >
                          <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                          <p className="text-sm text-muted-foreground mb-4">
                            {supportedFormatsMessage}
                          </p>
                          <p className="text-xs text-muted-foreground mb-4">
                            Max file size: {formatLimit(maxFileSize)}
                          </p>

                          <div className="space-y-2">
                            <Input
                              type="file"
                              onChange={handleFileSelect}
                              accept={allowedTypes.includes('*/*') ? undefined : allowedTypes.join(',')}
                              className="hidden"
                              id="file-upload"
                              disabled={uploading}
                            />
                            <Label htmlFor="file-upload">
                              <Button asChild disabled={uploading}>
                                <span>
                                  <Upload className="w-4 h-4 mr-2" />
                                  Choose File
                                </span>
                              </Button>
                            </Label>
                          </div>
                        </div>

                        {selectedFileForUpload && (
                          <div className="space-y-4 pt-4 border-t">
                            <div className="space-y-2">
                              <Label htmlFor="custom-file-name">File Name (Optional)</Label>
                              <Input
                                id="custom-file-name"
                                placeholder={selectedFileForUpload.name}
                                value={customFileName}
                                onChange={(e) => setCustomFileName(e.target.value)}
                                disabled={uploading}
                              />
                              <p className="text-xs text-muted-foreground">
                                Leave empty to use the original file name: {selectedFileForUpload.name}
                              </p>
                            </div>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <File className="w-4 h-4" />
                              <span className="truncate">{selectedFileForUpload.name}</span>
                              <Badge variant="secondary" className="ml-auto">
                                {formatFileSize(selectedFileForUpload.size)}
                              </Badge>
                              {shouldUseChunkedUpload(selectedFileForUpload) && (
                                <Badge variant="outline" className="text-xs">
                                  Chunked Upload
                                </Badge>
                              )}
                            </div>
                            <Button 
                              onClick={handleFileUpload}
                              className="w-full"
                              disabled={uploading}
                            >
                              <Upload className="w-4 h-4 mr-2" />
                              Upload File
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {showSelectExisting && (
                <TabsContent value="select" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <HardDrive className="w-5 h-5" />
                      Select Existing Media
                    </CardTitle>
                    <CardDescription>
                      Search and select from your uploaded media files
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Search and Filter */}
                    <div className="flex gap-2 items-center">
                      <div className="flex-1">
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                          <Input
                            placeholder="Search files..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-10"
                          />
                        </div>
                      </div>
                      <Select value={selectedType} onValueChange={setSelectedType}>
                        <SelectTrigger className="w-40">
                          <SelectValue placeholder="Filter by type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Types</SelectItem>
                          {allowedTypes.includes('image/*') && (
                            <SelectItem value="image/*">Images</SelectItem>
                          )}
                          {allowedTypes.includes('video/*') && (
                            <SelectItem value="video/*">Videos</SelectItem>
                          )}
                          {allowedTypes.includes('audio/*') && (
                            <SelectItem value="audio/*">Audio</SelectItem>
                          )}
                          {allowedTypes.includes('application/pdf') && (
                            <SelectItem value="application/pdf">PDFs</SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                      {/* View Mode Toggle */}
                      <div className="flex items-center gap-0.5 border border-border rounded-md bg-background overflow-hidden">
                        <Button
                          variant={viewMode === 'grid' ? 'default' : 'ghost'}
                          size="sm"
                          onClick={() => setViewMode('grid')}
                          className="h-9 px-2.5 rounded-r-none"
                          aria-label="Grid view"
                          type="button"
                        >
                          <LayoutGrid className="h-4 w-4" />
                        </Button>
                        <Button
                          variant={viewMode === 'list' ? 'default' : 'ghost'}
                          size="sm"
                          onClick={() => setViewMode('list')}
                          className="h-9 px-2.5 rounded-l-none"
                          aria-label="List view"
                          type="button"
                        >
                          <List className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    {/* Media Grid/List */}
                    <ScrollArea className="h-96">
                      {viewMode === 'grid' ? (
                        <div className="grid grid-cols-2 p-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
                          {filteredFiles.map((file, index) => (
                            <Card
                              key={`${file.id}-${file.uploadedAt}-${index}`}
                              className={`cursor-pointer transition-all hover:shadow-md ${
                                selectedFile?.id === file.id ? 'ring-2 ring-primary' : ''
                              }`}
                              onClick={() => handleExistingFileSelect(file)}
                            >
                              <CardContent className="p-2">
                                <div className="flex flex-col gap-2">
                                  {/* Thumbnail or Icon */}
                                  <div className="relative w-full h-20 bg-muted rounded-lg overflow-hidden flex items-center justify-center">
                                    {file.thumbnailUrl && !thumbnailErrors.has(file.id) ? (
                                      <img 
                                        src={file.thumbnailUrl} 
                                        alt={file.originalName}
                                        className="w-full h-full object-cover"
                                        onError={() => {
                                          // Mark this thumbnail as errored so we show icon instead
                                          setThumbnailErrors(prev => new Set(prev).add(file.id))
                                        }}
                                      />
                                    ) : (
                                      <div className="flex items-center justify-center">
                                        {getFileIcon(file.mimetype)}
                                      </div>
                                    )}
                                    {selectedFile?.id === file.id && (
                                      <div className="absolute top-2 right-2 bg-primary text-primary-foreground rounded-full p-1">
                                        <Check className="w-4 h-4" />
                                      </div>
                                    )}
                                  </div>
                                  
                                  {/* File Info */}
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-medium truncate mb-1" title={file.originalName}>
                                      {file.originalName}
                                    </p>
                                    <div className="flex items-center gap-1 flex-wrap">
                                      <Badge variant="secondary" className="text-[10px] px-1 py-0">
                                        {formatFileSize(file.size)}
                                      </Badge>
                                      <Badge variant="outline" className="text-[10px] px-1 py-0">
                                        {getFileTypeName(file.mimetype, file.originalName)}
                                      </Badge>
                                    </div>
                                  </div>
                                </div>
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                      ) : (
                        <div className="p-2 space-y-2">
                          {filteredFiles.map((file, index) => (
                            <Card
                              key={`${file.id}-${file.uploadedAt}-${index}`}
                              className={`cursor-pointer transition-all hover:shadow-md ${
                                selectedFile?.id === file.id ? 'ring-2 ring-primary bg-primary/5' : ''
                              }`}
                              onClick={() => handleExistingFileSelect(file)}
                            >
                              <CardContent className="p-4">
                                <div className="flex items-center gap-4">
                                  {/* Thumbnail or Icon */}
                                  <div className="relative w-16 h-16 bg-muted rounded-lg overflow-hidden flex items-center justify-center flex-shrink-0">
                                    {file.thumbnailUrl && !thumbnailErrors.has(file.id) ? (
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
                                    {selectedFile?.id === file.id && (
                                      <div className="absolute top-1 right-1 bg-primary text-primary-foreground rounded-full p-0.5">
                                        <Check className="w-3 h-3" />
                                      </div>
                                    )}
                                  </div>
                                  
                                  {/* File Info */}
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                      <p className="text-sm font-medium truncate" title={file.originalName}>
                                        {file.originalName}
                                      </p>
                                      {file.duration && (file.mimetype.startsWith('video/') || file.mimetype.startsWith('audio/')) && (
                                        <Badge variant="secondary" className="text-xs font-normal">
                                          {formatDuration(file.duration)}
                                        </Badge>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                      <Badge variant="secondary" className="text-xs">
                                        {formatFileSize(file.size)}
                                      </Badge>
                                      <Badge variant="outline" className="text-xs">
                                        {getFileTypeName(file.mimetype, file.originalName)}
                                      </Badge>
                                      <div className="flex items-center gap-1">
                                        <Calendar className="w-3 h-3" />
                                        {formatDate(file.uploadedAt)}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                      )}
                      
                      {filteredFiles.length === 0 && (
                        <div className="text-center py-8 text-muted-foreground">
                          <File className="w-12 h-12 mx-auto mb-4 opacity-50" />
                          <p>No files found</p>
                          {searchTerm && <p className="text-sm">Try adjusting your search terms</p>}
                          {!searchTerm && mediaFiles.length > 0 && (
                            <p className="text-sm">No files match the selected file types. Try selecting a different type filter.</p>
                          )}
                        </div>
                      )}
                    </ScrollArea>

                    {/* Selected File Info */}
                    {selectedFile && (
                      <div className="mt-4 p-3 bg-muted rounded-md flex items-center gap-2">
                        <Check className="w-4 h-4 text-primary" />
                        <span className="text-sm text-foreground flex-1 truncate" title={selectedFile.originalName}>
                          Selected: {selectedFile.originalName}
                        </span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
              )}

              {showEnterUrl && (
                <TabsContent value="url" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Globe className="w-5 h-5" />
                      Enter External URL
                    </CardTitle>
                    <CardDescription>{urlTabPlaceholders.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="url-input">
                        {savedMediaUrl && !savedUrlIsHosted ? "Update URL" : "Media URL"}
                      </Label>
                      <Input
                        id="url-input"
                        type="url"
                        placeholder={urlTabPlaceholders.url}
                        value={urlInput}
                        onChange={(e) => setUrlInput(e.target.value)}
                      />
                    </div>

                    <div
                      className={
                        urlFileTypeOptions.length > 1
                          ? "grid grid-cols-2 gap-4"
                          : "space-y-2"
                      }
                    >
                      <div className="space-y-2">
                        <Label htmlFor="url-filename">File Name (Optional)</Label>
                        <Input
                          id="url-filename"
                          placeholder={urlTabPlaceholders.fileName}
                          value={urlFileName}
                          onChange={(e) => setUrlFileName(e.target.value)}
                        />
                      </div>

                      {urlFileTypeOptions.length > 1 ? (
                        <div className="space-y-2">
                          <Label htmlFor="url-type">File Type</Label>
                          <Select value={urlFileType} onValueChange={setUrlFileType}>
                            <SelectTrigger id="url-type">
                              <SelectValue placeholder="Select type" />
                            </SelectTrigger>
                            <SelectContent>
                              {urlFileTypeOptions.map((opt) => (
                                <SelectItem key={opt.value} value={opt.value}>
                                  {opt.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      ) : urlFileTypeOptions.length === 1 ? (
                        <p className="text-xs text-muted-foreground">
                          File type: {urlFileTypeOptions[0].label}
                        </p>
                      ) : null}
                    </div>

                    <Button 
                      onClick={handleUrlSubmit}
                      className="w-full"
                      disabled={!urlInput.trim()}
                    >
                      <Globe className="w-4 h-4 mr-2" />
                      Add URL
                    </Button>
                  </CardContent>
                </Card>
              </TabsContent>
              )}
            </Tabs>
  )

  const dialogFooter = user?.organizationId ? (
    <DialogFooter className="shrink-0 gap-2 border-t bg-background px-6 py-4 sm:justify-end">
      {allowConcurrentUploads && concurrentUploadFinished && concurrentBatchOutcome?.failed === 0 ? (
        <Button onClick={onClose}>
          <Check className="w-4 h-4 mr-2" />
          Done
        </Button>
      ) : allowConcurrentUploads && concurrentUploading ? (
        <Button variant="outline" disabled>
          Uploading...
        </Button>
      ) : (
        <Button variant="outline" onClick={onClose} disabled={concurrentUploading}>
          {allowConcurrentUploads && concurrentBatchOutcome ? 'Close' : 'Cancel'}
        </Button>
      )}
      {activeTab === 'select' && selectedFile && (
        <Button onClick={handleConfirmSelection}>
          <Check className="w-4 h-4 mr-2" />
          Select
        </Button>
      )}
    </DialogFooter>
  ) : null

  if (embedded) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4">{scrollableContent}</div>
        {dialogFooter}
      </div>
    )
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="flex max-h-[min(90vh,100dvh)] max-w-4xl flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="shrink-0 space-y-1.5 px-6 pt-6 pb-2">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4">{scrollableContent}</div>
        {dialogFooter}
      </DialogContent>
    </Dialog>
  )
}

export default MediaManager
