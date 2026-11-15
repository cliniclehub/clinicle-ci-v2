'use server'

import { getCurrentUser } from '@/lib/actions/auth/auth-me-actions'
import { ApiResponse } from '@/lib/types/api-response-schema'
import { apiCaller } from '@/lib/utils/api-caller-helper'
import { getAccessToken, getAuthTokenData, userHasAnyRole } from '@/lib/utils/auth-server-helper'
import { deleteFromR2, listR2Files, readR2ObjectForDownload, renameR2File, updateR2File, uploadToR2 } from '@/lib/utils/cloudflare-r2-helper'
import {
  deleteLocalMedia,
  isLocalMediaStorageEnabled,
  listLocalMediaFiles,
  uploadToLocalMedia,
} from '@/lib/utils/local-media-storage'
import { ORG_MEDIA_MANAGE, PLATFORM_SETTINGS_MANAGE } from '@/lib/types/permission-schema'
import { createServerLogger } from '@/lib/utils/logger-server'
import { isHostedOrgMediaUrl, stripUrlTokenForDisplay } from '@/lib/utils/media-url-display'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'

const logger = createServerLogger('media-manager-actions')

// R2 configuration
const r2MediaServerWorkerUrl = process.env.R2_MEDIA_SERVER_WORKER_URL || 'http://localhost:8787'

function mediaAssetTypeFromContentType(value: string): 'video' | 'audio' | 'pdf' | 'document' | 'image' | 'other' {
  const clean = (value || '').toLowerCase()
  if (clean === 'video' || clean.startsWith('video/')) return 'video'
  if (clean === 'audio' || clean.startsWith('audio/')) return 'audio'
  if (clean === 'pdf' || clean === 'application/pdf') return 'pdf'
  if (clean === 'download' || clean === 'document') return 'document'
  if (clean.startsWith('image/')) return 'image'
  return 'other'
}

function mediaAssetTypeForUpload(contentType: string | null | undefined, fileType: string): 'video' | 'audio' | 'pdf' | 'document' | 'image' | 'other' {
  const contentMediaType = mediaAssetTypeFromContentType(contentType || '')
  if (contentMediaType !== 'other') return contentMediaType
  return mediaAssetTypeFromContentType(fileType)
}

function fallbackMimeTypeForAsset(asset: MediaAssetData): string {
  if (asset.sourceMimeType) return asset.sourceMimeType
  if (asset.mediaType === 'video') return 'video/mp4'
  if (asset.mediaType === 'audio') return 'audio/mpeg'
  if (asset.mediaType === 'pdf') return 'application/pdf'
  if (asset.mediaType === 'image') return 'image/jpeg'
  if (asset.mediaType === 'document') return 'application/octet-stream'
  return 'application/octet-stream'
}

function basenameFromObjectKey(objectKey: string): string {
  const clean = decodeURIComponent((objectKey || '').split('?', 1)[0])
  return clean.split('/').filter(Boolean).pop() || clean || 'media'
}

function mediaAssetToFile(asset: MediaAssetData): MediaFile {
  const sourceObjectKey = asset.sourceObjectKey
  const url =
    asset.sourceUrl ||
    `${r2MediaServerWorkerUrl.replace(/\/$/, '')}/${sourceObjectKey}`
  const mimetype = fallbackMimeTypeForAsset(asset)
  const originalName = asset.displayName?.trim() || basenameFromObjectKey(sourceObjectKey)
  return {
    id: sourceObjectKey,
    originalName,
    url,
    size: asset.sourceSizeBytes ?? 0,
    mimetype,
    uploadedAt: asset.createdAt,
    mediaAssetId: asset.id,
    sourceObjectKey,
    mediaType: asset.mediaType,
    assetStatus: asset.status,
    hlsStatus: asset.mediaType === 'video' ? asset.status : null,
    hlsPrefix: asset.hlsPrefix ?? null,
    masterManifestKey: asset.masterManifestKey ?? null,
    usageCount: asset.usageCount ?? 0,
    outputSizeBytes: asset.outputSizeBytes ?? null,
    segmentCount: asset.segmentCount ?? null,
    segmentLengthSeconds: asset.segmentLengthSeconds ?? null,
    renditionCount: asset.renditions?.length ?? 0,
    renditions: asset.renditions ?? [],
    errorMessage: asset.errorMessage ?? null,
    failureCount: asset.failureCount ?? 0,
    transcodeCpuSeconds: asset.transcodeCpuSeconds ?? null,
    transcodeWallSeconds: asset.transcodeWallSeconds ?? null,
    progressStage: asset.progressStage ?? null,
    progressPercent: asset.progressPercent ?? null,
    progressCurrentSegment: asset.progressCurrentSegment ?? null,
    progressTotalSegments: asset.progressTotalSegments ?? null,
    progressCurrentRendition: asset.progressCurrentRendition ?? null,
    progressTotalRenditions: asset.progressTotalRenditions ?? null,
    processingStartedAt: asset.processingStartedAt ?? null,
    processedAt: asset.processedAt ?? null,
    updatedAt: asset.updatedAt,
    sourceWidth: asset.sourceWidth ?? null,
    sourceHeight: asset.sourceHeight ?? null,
    thumbnailUrl: asset.thumbnailUrl ?? undefined,
    duration: asset.durationSeconds ?? undefined,
  }
}

/** Shared org/role gate for Media Manager file downloads. */
export async function assertCanDownloadMediaFile(fileId: string): Promise<void> {
  const token = await getAccessToken()
  if (!token) {
    throw new Error('Unauthorized')
  }

  const pathParts = fileId.split('/')
  const orgIdIndex = pathParts.indexOf('orgs')

  if (orgIdIndex === -1 || orgIdIndex + 1 >= pathParts.length) {
    throw new Error('Invalid file path')
  }

  const fileOrgId = pathParts[orgIdIndex + 1]
  const userOrgId = await getCurrentUserOrgId()
  const isSuperAdmin = await userHasAnyRole(['super_admin'])

  if (!isSuperAdmin && userOrgId !== fileOrgId) {
    throw new Error('Access denied - file belongs to different organization')
  }

  const hasRequiredRole = await userHasAnyRole([
    'org_admin',
    'super_admin',
  ])
  if (!hasRequiredRole) {
    throw new Error('Access denied - insufficient permissions')
  }
}

export async function streamMediaFileDownload(fileId: string) {
  await assertCanDownloadMediaFile(fileId)
  return readR2ObjectForDownload(fileId)
}

// Helper function to get current user's organization ID securely
async function getCurrentUserOrgId(): Promise<string> {
  try {
    const userResponse = await getCurrentUser()
    if (userResponse.status !== 'success' || !userResponse.data) {
      throw new Error('Failed to get current user information')
    }
    
    const orgId = userResponse.data.organizationId
    if (!orgId) {
      throw new Error('User does not have an organization assigned')
    }
    
    return orgId
  } catch (error) {
    logger.error('Error getting current user organization ID:', error as Error)
    throw new Error('Failed to get organization information')
  }
}

export interface UploadResult {
  id: string
  key: string
  url: string
  size: number
  mimetype: string
  uploadedAt: string
  originalName: string
  mediaAssetId?: string
  thumbnailUrl?: string
}

export interface MediaFile {
  id: string
  originalName: string
  url: string
  size: number
  mimetype: string
  uploadedAt: string
  mediaAssetId?: string
  sourceObjectKey?: string
  mediaType?: 'video' | 'audio' | 'pdf' | 'document' | 'image' | 'other'
  assetStatus?: 'uploaded' | 'processing' | 'ready' | 'failed'
  hlsStatus?: 'uploaded' | 'processing' | 'ready' | 'failed' | null
  hlsPrefix?: string | null
  masterManifestKey?: string | null
  usageCount?: number
  outputSizeBytes?: number | null
  segmentCount?: number | null
  segmentLengthSeconds?: number | null
  renditionCount?: number
  renditions?: Array<Record<string, unknown>>
  errorMessage?: string | null
  failureCount?: number
  transcodeCpuSeconds?: number | null
  transcodeWallSeconds?: number | null
  progressStage?: string | null
  progressPercent?: number | null
  progressCurrentSegment?: number | null
  progressTotalSegments?: number | null
  progressCurrentRendition?: number | null
  progressTotalRenditions?: number | null
  processingStartedAt?: string | null
  processedAt?: string | null
  updatedAt?: string
  sourceWidth?: number | null
  sourceHeight?: number | null
  thumbnailUrl?: string
  duration?: number // Duration in seconds for video and audio files
  isPublic?: boolean
}

export interface MediaAssetData {
  id: string
  organizationId: string
  sourceObjectKey: string
  displayName?: string | null
  sourceUrl?: string | null
  mediaType: 'video' | 'audio' | 'pdf' | 'document' | 'image' | 'other'
  sourceMimeType?: string | null
  sourceSizeBytes?: number | null
  sourceWidth?: number | null
  sourceHeight?: number | null
  hlsPrefix?: string | null
  masterManifestKey?: string | null
  thumbnailKey?: string | null
  thumbnailUrl?: string | null
  status: 'uploaded' | 'processing' | 'ready' | 'failed'
  durationSeconds?: number | null
  renditions: Array<Record<string, unknown>>
  errorMessage?: string | null
  failureCount?: number
  transcodeCpuSeconds?: number | null
  transcodeWallSeconds?: number | null
  outputSizeBytes?: number | null
  segmentCount?: number | null
  segmentLengthSeconds?: number | null
  usageCount?: number
  progressStage?: string | null
  progressPercent?: number | null
  progressCurrentSegment?: number | null
  progressTotalSegments?: number | null
  progressCurrentRendition?: number | null
  progressTotalRenditions?: number | null
  processingStartedAt?: string | null
  processedAt?: string | null
  createdAt: string
  updatedAt: string
}

export interface MediaAssetDeleteData {
  assetId: string
  sourceObjectKey: string
  deletedSourceObject: boolean
  deletedHlsObjects: number
}

export interface MediaAssetRenameData {
  asset: MediaAssetData
  oldSourceObjectKey: string
  newSourceObjectKey: string
  oldDisplayName?: string | null
  newDisplayName: string
  renamedThumbnail: boolean
}

export interface MediaLibraryReconcileItem {
  action: string
  objectKey: string
  assetId?: string
  displayName: string
  dbSizeBytes?: number
  r2SizeBytes?: number
  error?: string
}

export interface MediaLibraryReconcileData {
  dryRun: boolean
  r2Scanned: number
  dbScanned: number
  matched: number
  r2Only: number
  dbOnly: number
  sizeRefresh: number
  created: number
  updated: number
  errors: number
  items: MediaLibraryReconcileItem[]
}

export async function reconcileMediaLibraryAction(
  options: { dryRun?: boolean } = {}
): Promise<ApiResponse<MediaLibraryReconcileData>> {
  const dryRun = options.dryRun !== false
  const params = new URLSearchParams()
  params.set('dryRun', dryRun ? 'true' : 'false')
  return apiCaller.post<MediaLibraryReconcileData>(
    `/media/assets/reconcile?${params.toString()}`,
    {},
    {
      requireAuth: true,
      requirePermission: [ORG_MEDIA_MANAGE, PLATFORM_SETTINGS_MANAGE],
    }
  )
}

export async function uploadFileAction(formData: FormData): Promise<UploadResult> {
  try {
    const file = formData.get('file') as File

    const tokenData = await getAuthTokenData()
    if (!tokenData) {
      throw new Error('Unauthorized')
    }
    
    // Get organization ID securely from current user
    const orgId = await getCurrentUserOrgId()
    
    const contentType = formData.get('contentType') as string
    const isPublic = formData.get('isPublic') === 'true' // NEW: Check if this is a public upload
    
    if (!file) {
      throw new Error('No file uploaded')
    }

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    
    // Use custom file name if provided, otherwise use the uploaded file's name
    const customFileName = formData.get('fileName') as string
    const originalFileExt = path.extname(file.name)
    
    let originalName: string
    if (customFileName?.trim()) {
      // If custom name is provided, ensure it has the correct extension
      const customName = customFileName.trim()
      const customExt = path.extname(customName)
      originalName = customExt ? customName : `${customName}${originalFileExt}`
    } else {
      originalName = file.name
    }
    
    const ext = path.extname(originalName)
    const fileName = uuidv4() + ext

    const fileMetadata = isLocalMediaStorageEnabled() && isPublic
      ? await uploadToLocalMedia(buffer, fileName, file.type, originalName, {
          orgId,
          uploadedBy: tokenData.sub,
          contentType: contentType || 'media',
          isPublic: true,
        })
      : await uploadToR2(buffer, fileName, file.type, originalName, {
          orgId,
          uploadedBy: tokenData.sub,
          contentType: contentType || 'media',
          isPublic: isPublic // NEW: Pass isPublic flag to uploadToR2
        })

    let mediaAssetId: string | undefined
    if (!isPublic) {
      try {
        const mediaAsset = await createMediaAssetForUploadAction({
          sourceObjectKey: fileMetadata.key,
          sourceMimeType: file.type,
          sourceSizeBytes: fileMetadata.size,
          mediaType: mediaAssetTypeForUpload(contentType, file.type),
        })
        mediaAssetId = mediaAsset.id
      } catch (assetError) {
        logger.warn('Failed to create media asset tracking row after upload', {
          fileId: fileMetadata.id,
          error: assetError instanceof Error ? assetError.message : String(assetError),
        })
      }
    }

    logger.info('File uploaded successfully', {
      fileId: fileMetadata.id,
      fileName: originalName,
      mimetype: file.type,
      hasThumbnail: !!fileMetadata.thumbnailUrl,
      size: fileMetadata.size
    })

    return {
      ...fileMetadata,
      mediaAssetId,
    }
  } catch (error) {
    logger.error('Upload error:', error as Error, {
      fileName: (formData.get('file') as File)?.name,
      mimetype: (formData.get('file') as File)?.type
    })
    throw new Error('Upload failed')
  }
}

export async function listMediaFilesAction(prefix = '', isPublic = false): Promise<MediaFile[]> {
  const methodLogger = logger.forMethod('listMediaFilesAction')
  
  try {
    const tokenData = await getAuthTokenData()
    if (!tokenData) {
      throw new Error('Unauthorized')
    }

    // Check if user has required role
    const hasRequiredRole = await userHasAnyRole(['org_admin', 'super_admin'])
    if (!hasRequiredRole) {
      throw new Error('Access denied - insufficient permissions')
    }
    
    // Get access token to append to URLs
    const token = await getAccessToken()
    
    // Get organization ID securely from current user
    const orgId = await getCurrentUserOrgId()
    
    methodLogger.debug('Listing media files', { orgId, prefix, isPublic })

    if (!isPublic) {
      const response = await apiCaller.get<{ assets: MediaAssetData[] }>(
        '/media/assets?limit=500',
        {
          requireAuth: true,
          requirePermission: [ORG_MEDIA_MANAGE, PLATFORM_SETTINGS_MANAGE],
          cache: 'no-store',
        }
      )
      if (response.status === 'error' || !response.data) {
        throw new Error(response.message || 'Failed to load media assets')
      }
      const cleanPrefix = prefix.trim().replace(/^\/+/, '')
      return response.data.assets
        .filter((asset) => !cleanPrefix || asset.sourceObjectKey.includes(cleanPrefix))
        .map(mediaAssetToFile)
    }

  const files = isLocalMediaStorageEnabled()
    ? await listLocalMediaFiles(orgId, prefix, isPublic)
    : await listR2Files(orgId, prefix, isPublic)
    
  methodLogger.debug('Files found', { count: files.length })

  const mapped = files.map((file) => ({
    ...file,
    mediaType: mediaAssetTypeFromContentType(file.mimetype),
    isPublic,
    usageCount: 0,
  }))

  return mapped
  } catch (error) {
    methodLogger.error('Error listing media files', error as Error)
    throw new Error('Failed to load media files')
  }
}

// New function for super admin access - bypasses org membership check
export async function listMediaFilesForSuperAdmin(orgId: string, prefix = '', isPublic = false): Promise<MediaFile[]> {
  const methodLogger = logger.forMethod('listMediaFilesForSuperAdmin')
  
  try {
    const tokenData = await getAuthTokenData()
    if (!tokenData) {
      throw new Error('Unauthorized')
    }
    
    // Only super admin can access any organization's files
    const isSuperAdmin = await userHasAnyRole(['super_admin'])
    if (!isSuperAdmin) {
      throw new Error('Access denied - Super admin role required')
    }
    
    // Get access token to append to URLs
    const token = await getAccessToken()
    
    methodLogger.debug('Listing media files for super admin', { orgId, prefix, isPublic })
    
    const files = isLocalMediaStorageEnabled() && isPublic
      ? await listLocalMediaFiles(orgId, prefix, isPublic)
      : await listR2Files(orgId, prefix, isPublic)
    
    methodLogger.debug('Files found', { count: files.length })
    
    return files
  } catch (error) {
    methodLogger.error('Error listing media files for super admin', error as Error)
    throw new Error('Failed to load media files')
  }
}

/**
 * Resolve an authenticated private R2 worker URL via scoped media tokens.
 */
export async function addTokenToMediaUrlAction(
  mediaUrl: string,
  options: SignMediaAccessOptions = {},
): Promise<string> {
  try {
    const token = await getAccessToken()
    if (!token) {
      throw new Error('Unauthorized')
    }

    const baseUrl = isHostedOrgMediaUrl(mediaUrl)
      ? stripUrlTokenForDisplay(mediaUrl)
      : mediaUrl

    return signMediaAccessAction(baseUrl, options)
  } catch (error) {
    logger.error('Error adding token to media URL', error as Error, {
      mediaUrl: stripUrlTokenForDisplay(mediaUrl),
    })
    throw new Error('Failed to add token to media URL')
  }
}

export interface MediaSignAccessResponse {
  playbackUrl: string
  objectKey: string
  expiresIn: number
  expiresAt: string
  delivery?: 'object'
}

export interface SignMediaAccessOptions {
  assetId?: string
  objectKey?: string
}

export async function createMediaAssetForUploadAction(params: {
  sourceObjectKey: string
  mediaType?: 'video' | 'audio' | 'pdf' | 'document' | 'image' | 'other'
  sourceMimeType?: string
  sourceSizeBytes?: number
}): Promise<MediaAssetData> {
  const response = await apiCaller.post<MediaAssetData>(
    '/media/assets',
    {
      sourceObjectKey: params.sourceObjectKey,
      mediaType: params.mediaType,
      sourceMimeType: params.sourceMimeType,
      sourceSizeBytes: params.sourceSizeBytes,
    },
    { requireAuth: true }
  )
  if (response.status === 'error' || !response.data) {
    throw new Error(response.message || 'Failed to create media asset')
  }
  return response.data
}

export async function deleteMediaAssetAction(assetId: string): Promise<MediaAssetDeleteData> {
  const response = await apiCaller.delete<MediaAssetDeleteData>(
    `/media/assets/${assetId}`,
    {
      requireAuth: true,
      requirePermission: [ORG_MEDIA_MANAGE, PLATFORM_SETTINGS_MANAGE],
    }
  )
  if (response.status === 'error' || !response.data) {
    throw new Error(response.message || 'Failed to delete media asset')
  }
  return response.data
}

export async function getMediaAssetAction(assetId: string): Promise<MediaFile> {
  const response = await apiCaller.get<MediaAssetData>(
    `/media/assets/${assetId}`,
    {
      requireAuth: true,
      requirePermission: [ORG_MEDIA_MANAGE, PLATFORM_SETTINGS_MANAGE],
      cache: 'no-store',
    }
  )
  if (response.status === 'error' || !response.data) {
    throw new Error(response.message || 'Failed to load media asset')
  }
  return mediaAssetToFile(response.data)
}

export async function renameMediaAssetAction(assetId: string, fileName: string): Promise<MediaFile> {
  const response = await apiCaller.patch<MediaAssetRenameData>(
    `/media/assets/${assetId}/rename`,
    { fileName },
    {
      requireAuth: true,
      requirePermission: [ORG_MEDIA_MANAGE, PLATFORM_SETTINGS_MANAGE],
    }
  )
  if (response.status === 'error' || !response.data) {
    throw new Error(response.message || 'Failed to rename media asset')
  }
  return mediaAssetToFile(response.data.asset)
}

export async function signMediaAccessDetailsAction(
  mediaUrl: string | null,
  options: SignMediaAccessOptions = {}
): Promise<MediaSignAccessResponse> {
  try {
    const cleanUrl = mediaUrl ? stripUrlTokenForDisplay(mediaUrl) : null
    const response = await apiCaller.post<MediaSignAccessResponse>(
      '/media/sign-access',
      {
        mediaUrl: cleanUrl,
        objectKey: options.objectKey,
        assetId: options.assetId,
      },
      { requireAuth: true, logRequest: false, logResponse: false }
    )

    if (response.status === 'error' || !response.data?.playbackUrl) {
      throw new Error(response.message || 'Failed to sign media URL')
    }

    return response.data
  } catch (error) {
    logger.error('Error signing media access URL', error as Error, {
      mediaUrl: mediaUrl ? stripUrlTokenForDisplay(mediaUrl) : null,
    })
    throw new Error('Failed to sign media access URL')
  }
}

export async function signMediaAccessAction(
  mediaUrl: string,
  options: SignMediaAccessOptions = {},
): Promise<string> {
  const response = await signMediaAccessDetailsAction(mediaUrl, options)
  return response.playbackUrl
}

export async function getMediaDownloadUrlAction(fileId: string): Promise<string> {
  try {
    await assertCanDownloadMediaFile(fileId)

    const token = await getAccessToken()
    if (!token) {
      throw new Error('Unauthorized')
    }

    const workerUrl = r2MediaServerWorkerUrl.replace(/\/$/, '')
    return signMediaAccessAction(`${workerUrl}/${fileId}`)
  } catch (error) {
    logger.error('Error generating media URL', error as Error, { fileId })
    throw new Error('Failed to generate media URL')
  }
}

export async function deleteMediaFileAction(fileId: string): Promise<void> {
  try {
    const tokenData = await getAuthTokenData()
    if (!tokenData) {
      throw new Error('Unauthorized')
    }

    // Check if user has required role
    const hasRequiredRole = await userHasAnyRole(['org_admin', 'super_admin'])
    if (!hasRequiredRole) {
      throw new Error('Access denied - insufficient permissions')
    }

    // Extract org ID from file path
    const pathParts = fileId.split('/')
    const orgIdIndex = pathParts.indexOf('orgs')
    
    if (orgIdIndex === -1 || orgIdIndex + 1 >= pathParts.length) {
      throw new Error('Invalid file path')
    }
    
    const fileOrgId = pathParts[orgIdIndex + 1]
    
    // Get current user's organization ID securely
    const userOrgId = await getCurrentUserOrgId()
    
    // Verify user belongs to the same org as the file (unless super admin)
    const isSuperAdmin = await userHasAnyRole(['super_admin'])
    if (!isSuperAdmin && userOrgId !== fileOrgId) {
      throw new Error('Access denied - file belongs to different organization')
    }

    // Delete the file
    if (isLocalMediaStorageEnabled()) {
      await deleteLocalMedia(fileId)
    } else {
      await deleteFromR2(fileId)
      // Also delete thumbnail if it exists
      const thumbnailKey = fileId.replace(/\.[^.]+$/, '_thumb.jpg')
      try {
        await deleteFromR2(thumbnailKey)
      } catch {
        // Thumbnail might not exist, which is okay
      }
    }

    logger.info('File deleted successfully', {
      fileId,
      deletedBy: tokenData.sub
    })
  } catch (error) {
    logger.error('Error deleting file:', error as Error, {
      fileId
    })
    throw new Error('Failed to delete file')
  }
}

export async function updateMediaFileAction(fileId: string, formData: FormData): Promise<UploadResult> {
  try {
    const file = formData.get('file') as File

    const tokenData = await getAuthTokenData()
    if (!tokenData) {
      throw new Error('Unauthorized')
    }

    // Check if user has required role
    const hasRequiredRole = await userHasAnyRole(['org_admin', 'super_admin'])
    if (!hasRequiredRole) {
      throw new Error('Access denied - insufficient permissions')
    }

    // Extract org ID from file path
    const pathParts = fileId.split('/')
    const orgIdIndex = pathParts.indexOf('orgs')
    
    if (orgIdIndex === -1 || orgIdIndex + 1 >= pathParts.length) {
      throw new Error('Invalid file path')
    }
    
    const fileOrgId = pathParts[orgIdIndex + 1]
    
    // Get current user's organization ID securely
    const userOrgId = await getCurrentUserOrgId()
    
    // Verify user belongs to the same org as the file (unless super admin)
    const isSuperAdmin = await userHasAnyRole(['super_admin'])
    if (!isSuperAdmin && userOrgId !== fileOrgId) {
      throw new Error('Access denied - file belongs to different organization')
    }
    
    if (!file) {
      throw new Error('No file uploaded')
    }
    
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    
    // Use custom file name if provided, otherwise use the uploaded file's name
    const customFileName = formData.get('fileName') as string
    const originalName = customFileName?.trim() || file.name

    // Update the file using the same key (fileId)
    const fileMetadata = await updateR2File(fileId, buffer, file.type, originalName, {
      orgId: userOrgId,
      uploadedBy: tokenData.sub,
      contentType: (formData.get('contentType') as string) || 'media'
    })

    logger.info('File updated successfully', {
      fileId: fileMetadata.id,
      fileName: originalName,
      mimetype: file.type,
      hasThumbnail: !!fileMetadata.thumbnailUrl,
      size: fileMetadata.size,
      updatedBy: tokenData.sub
    })

    return fileMetadata
  } catch (error) {
    logger.error('Update error:', error as Error, {
      fileId,
      fileName: (formData.get('file') as File)?.name,
      mimetype: (formData.get('file') as File)?.type
    })
    throw new Error('Update failed')
  }
}

export async function renameMediaFileAction(fileId: string, newName: string): Promise<UploadResult> {
  try {
    const tokenData = await getAuthTokenData()
    if (!tokenData) {
      throw new Error('Unauthorized')
    }

    // Check if user has required role
    const hasRequiredRole = await userHasAnyRole(['org_admin', 'super_admin'])
    if (!hasRequiredRole) {
      throw new Error('Access denied - insufficient permissions')
    }

    // Validate new name
    if (!newName || !newName.trim()) {
      throw new Error('File name cannot be empty')
    }

    // Extract org ID from file path
    const pathParts = fileId.split('/')
    const orgIdIndex = pathParts.indexOf('orgs')
    
    if (orgIdIndex === -1 || orgIdIndex + 1 >= pathParts.length) {
      throw new Error('Invalid file path')
    }
    
    const fileOrgId = pathParts[orgIdIndex + 1]
    
    // Get current user's organization ID securely
    const userOrgId = await getCurrentUserOrgId()
    
    // Verify user belongs to the same org as the file (unless super admin)
    const isSuperAdmin = await userHasAnyRole(['super_admin'])
    if (!isSuperAdmin && userOrgId !== fileOrgId) {
      throw new Error('Access denied - file belongs to different organization')
    }

    // Rename the file (updates metadata only)
    const fileMetadata = await renameR2File(fileId, newName.trim())

    logger.info('File renamed successfully', {
      fileId: fileMetadata.id,
      oldName: 'previous',
      newName: fileMetadata.originalName,
      renamedBy: tokenData.sub
    })

    return fileMetadata
  } catch (error) {
    logger.error('Rename error:', error as Error, {
      fileId,
      newName
    })
    throw new Error('Failed to rename file')
  }
}
