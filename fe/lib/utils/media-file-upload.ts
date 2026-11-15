import { uploadFileAction, type MediaFile } from '@/lib/actions/media-manager/media-manager-actions'
import {
  abortMultipartUpload,
  type ChunkedUploadProgress,
  completeMultipartUpload,
  getPresignedUrl,
  initiateMultipartUpload,
  type UploadedPart,
} from '@/lib/utils/chunked-upload-service'
import { CHUNKED_UPLOAD_THRESHOLD } from '@/lib/utils/upload-constants'

export function shouldUseChunkedMediaUpload(file: File): boolean {
  return file.size > CHUNKED_UPLOAD_THRESHOLD
}

export interface UploadMediaLibraryFileOptions {
  isPublic?: boolean
  contentType?: string
  fileName?: string
  onProgress?: (progress: ChunkedUploadProgress) => void
  maxConcurrentChunkUploads?: number
  maxChunkRetries?: number
}

async function uploadChunkWithRetry(
  presignedUrl: string,
  chunk: Blob,
  partNumber: number,
  maxRetries: number,
): Promise<string> {
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await fetch(presignedUrl, {
        method: 'PUT',
        body: chunk,
        headers: { 'Content-Type': 'application/octet-stream' },
      })
      if (!response.ok) {
        throw new Error(`Upload failed with status ${response.status}`)
      }
      const etag = response.headers.get('ETag') || response.headers.get('etag')
      if (!etag) {
        throw new Error('No ETag in upload response')
      }
      return etag.replace(/"/g, '')
    } catch (error) {
      if (attempt >= maxRetries) {
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000))
    }
  }
  throw new Error(`Failed to upload part ${partNumber}`)
}

async function uploadMediaFileChunked(
  file: File,
  options: UploadMediaLibraryFileOptions,
): Promise<MediaFile> {
  const {
    isPublic = false,
    contentType = 'media',
    fileName,
    onProgress,
    maxConcurrentChunkUploads = 3,
    maxChunkRetries = 3,
  } = options

  const displayName = (fileName?.trim() || file.name).trim()
  const initiateResponse = await initiateMultipartUpload({
    fileName: displayName,
    fileType: file.type,
    fileSize: file.size,
    isPublic,
    contentType,
  })

  if (initiateResponse.status !== 'success' || !initiateResponse.data) {
    throw new Error(initiateResponse.message || 'Failed to initiate upload')
  }

  const { uploadId, key, chunkSize, totalParts } = initiateResponse.data
  const uploadedParts: UploadedPart[] = []
  let uploadedBytes = 0

  const reportProgress = (uploadedPartCount: number) => {
    onProgress?.({
      uploadedParts: uploadedPartCount,
      totalParts,
      uploadedBytes,
      totalBytes: file.size,
      percentage: Math.round((uploadedBytes / file.size) * 100),
    })
  }

  try {
    for (let batchStart = 0; batchStart < totalParts; batchStart += maxConcurrentChunkUploads) {
      const batchEnd = Math.min(batchStart + maxConcurrentChunkUploads, totalParts)
      const batchResults = await Promise.all(
        Array.from({ length: batchEnd - batchStart }, async (_, offset) => {
          const partIndex = batchStart + offset
          const partNumber = partIndex + 1
          const start = partIndex * chunkSize
          const end = Math.min(start + chunkSize, file.size)
          const chunk = file.slice(start, end)

          const urlResponse = await getPresignedUrl(uploadId, key, partNumber, isPublic)
          if (urlResponse.status !== 'success' || !urlResponse.data) {
            throw new Error(`Failed to get presigned URL for part ${partNumber}`)
          }

          const etag = await uploadChunkWithRetry(
            urlResponse.data.presignedUrl,
            chunk,
            partNumber,
            maxChunkRetries,
          )
          uploadedBytes += chunk.size
          return { partNumber, etag }
        }),
      )
      uploadedParts.push(...batchResults)
      reportProgress(uploadedParts.length)
    }

    const completeResponse = await completeMultipartUpload(
      uploadId,
      key,
      uploadedParts,
      isPublic,
    )
    if (completeResponse.status !== 'success' || !completeResponse.data) {
      throw new Error(completeResponse.message || 'Failed to complete upload')
    }

    const result = completeResponse.data
    return {
      id: result.key,
      originalName: displayName,
      url: result.url,
      size: result.size,
      mimetype: file.type,
      uploadedAt: new Date().toISOString(),
      mediaAssetId: result.mediaAssetId,
    }
  } catch (error) {
    try {
      await abortMultipartUpload(uploadId, key, isPublic)
    } catch {
      // Best-effort cleanup
    }
    throw error
  }
}

async function uploadMediaFileDirect(
  file: File,
  options: UploadMediaLibraryFileOptions,
): Promise<MediaFile> {
  const { isPublic = false, contentType = 'media', fileName, onProgress } = options
  const displayName = (fileName?.trim() || file.name).trim()

  onProgress?.({
    uploadedParts: 0,
    totalParts: 1,
    uploadedBytes: 0,
    totalBytes: file.size,
    percentage: 0,
  })

  const formData = new FormData()
  formData.append('file', file)
  formData.append('fileName', displayName)
  formData.append('contentType', contentType)
  if (isPublic) {
    formData.append('isPublic', 'true')
  }

  const response = await uploadFileAction(formData)

  onProgress?.({
    uploadedParts: 1,
    totalParts: 1,
    uploadedBytes: file.size,
    totalBytes: file.size,
    percentage: 100,
  })

  return response
}

/** Upload one media library file (chunked or direct). Safe to run concurrently. */
export async function uploadMediaLibraryFile(
  file: File,
  options: UploadMediaLibraryFileOptions = {},
): Promise<MediaFile> {
  if (shouldUseChunkedMediaUpload(file)) {
    return uploadMediaFileChunked(file, options)
  }
  return uploadMediaFileDirect(file, options)
}
