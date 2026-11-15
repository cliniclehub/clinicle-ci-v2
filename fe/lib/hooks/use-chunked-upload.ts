"use client"

import {
    abortMultipartUpload,
    ChunkedUploadProgress,
    completeMultipartUpload,
    getPresignedUrl,
    initiateMultipartUpload,
    InitiateUploadParams,
    UploadedPart
} from '@/lib/utils/chunked-upload-service'
import { createClientLogger } from '@/lib/utils/logger-client'
import { CHUNKED_UPLOAD_THRESHOLD } from '@/lib/utils/upload-constants'
import { useCallback, useRef, useState } from 'react'

const logger = createClientLogger('useChunkedUpload')

export interface ChunkedUploadResult {
  key: string
  url: string
  size: number
  etag: string
  mediaAssetId?: string
}

export interface UseChunkedUploadOptions {
  onProgress?: (progress: ChunkedUploadProgress) => void
  onError?: (error: Error) => void
  onSuccess?: (result: ChunkedUploadResult) => void
  maxConcurrentUploads?: number
  maxRetries?: number
}

export interface UseChunkedUploadReturn {
  upload: (file: File, params: Omit<InitiateUploadParams, 'fileName' | 'fileType' | 'fileSize'>) => Promise<ChunkedUploadResult | null>
  abort: () => Promise<void>
  isUploading: boolean
  progress: ChunkedUploadProgress | null
  error: Error | null
  shouldUseChunkedUpload: (file: File) => boolean
}

/**
 * Hook for handling chunked file uploads to R2
 */
export function useChunkedUpload(options: UseChunkedUploadOptions = {}): UseChunkedUploadReturn {
  const {
    onProgress,
    onError,
    onSuccess,
    maxConcurrentUploads = 3,
    maxRetries = 3
  } = options

  const [isUploading, setIsUploading] = useState(false)
  const [progress, setProgress] = useState<ChunkedUploadProgress | null>(null)
  const [error, setError] = useState<Error | null>(null)
  
  // Track current upload for abort functionality
  const currentUploadRef = useRef<{
    uploadId: string
    key: string
    isPublic: boolean
    aborted: boolean
  } | null>(null)

  const updateProgress = useCallback((update: Partial<ChunkedUploadProgress>) => {
    setProgress(prev => {
      if (!prev) return null
      const newProgress = { ...prev, ...update }
      newProgress.percentage = Math.round((newProgress.uploadedBytes / newProgress.totalBytes) * 100)
      onProgress?.(newProgress)
      return newProgress
    })
  }, [onProgress])

  /**
   * Upload a single chunk with retry logic
   */
  const uploadChunk = useCallback(async (
    presignedUrl: string,
    chunk: Blob,
    partNumber: number,
    retryCount = 0
  ): Promise<string> => {
    try {
      // Check if upload was aborted
      if (currentUploadRef.current?.aborted) {
        throw new Error('Upload aborted')
      }

      const response = await fetch(presignedUrl, {
        method: 'PUT',
        body: chunk,
        headers: {
          'Content-Type': 'application/octet-stream'
        }
      })

      if (!response.ok) {
        throw new Error(`Upload failed with status ${response.status}`)
      }

      // Get ETag from response headers
      // IMPORTANT: CORS must have "exposeHeaders": ["ETag"] for browser to read this
      const etag = response.headers.get('ETag') || response.headers.get('etag')
      
      if (!etag) {
        // Log all available headers for debugging
        const headers: Record<string, string> = {}
        response.headers.forEach((value, key) => {
          headers[key] = value
        })
        logger.error(`No ETag in response for part ${partNumber}. Available headers:`, undefined, headers)
        throw new Error(`No ETag in response - CORS may not be exposing ETag header. Check R2 bucket CORS configuration.`)
      }

      return etag.replace(/"/g, '') // Remove quotes from ETag
    } catch (err) {
      if (retryCount < maxRetries && !currentUploadRef.current?.aborted) {
        logger.warn(`Chunk ${partNumber} upload failed, retrying (${retryCount + 1}/${maxRetries})`, { error: err })
        // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, retryCount) * 1000))
        return uploadChunk(presignedUrl, chunk, partNumber, retryCount + 1)
      }
      throw err
    }
  }, [maxRetries])

  /**
   * Main upload function
   */
  const upload = useCallback(async (
    file: File,
    params: Omit<InitiateUploadParams, 'fileName' | 'fileType' | 'fileSize'>
  ): Promise<ChunkedUploadResult | null> => {
    const methodLogger = logger.forMethod('upload')
    
    setIsUploading(true)
    setError(null)
    setProgress({
      uploadedParts: 0,
      totalParts: 0,
      uploadedBytes: 0,
      totalBytes: file.size,
      percentage: 0
    })

    try {
      // 1. Initiate multipart upload
      methodLogger.info('Starting chunked upload', {
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type
      })

      const initiateResponse = await initiateMultipartUpload({
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
        ...params
      })

      if (initiateResponse.status !== 'success' || !initiateResponse.data) {
        throw new Error(initiateResponse.message || 'Failed to initiate upload')
      }

      const { uploadId, key, chunkSize, totalParts } = initiateResponse.data
      
      // Store current upload info for abort
      currentUploadRef.current = {
        uploadId,
        key,
        isPublic: params.isPublic || false,
        aborted: false
      }

      setProgress(prev => prev ? { ...prev, totalParts } : null)

      methodLogger.info('Multipart upload initiated', {
        uploadId,
        key,
        chunkSize,
        totalParts
      })

      // 2. Upload chunks with concurrency control
      const uploadedParts: UploadedPart[] = []
      let uploadedBytes = 0

      // Process chunks in batches for parallel uploads
      for (let batchStart = 0; batchStart < totalParts; batchStart += maxConcurrentUploads) {
        // Check if aborted
        if (currentUploadRef.current?.aborted) {
          throw new Error('Upload aborted')
        }

        const batchEnd = Math.min(batchStart + maxConcurrentUploads, totalParts)
        const batchPromises: Promise<UploadedPart>[] = []

        for (let partIndex = batchStart; partIndex < batchEnd; partIndex++) {
          const partNumber = partIndex + 1
          const start = partIndex * chunkSize
          const end = Math.min(start + chunkSize, file.size)
          const chunk = file.slice(start, end)

          batchPromises.push(
            (async () => {
              // Get presigned URL for this part
              const urlResponse = await getPresignedUrl(
                uploadId,
                key,
                partNumber,
                params.isPublic || false
              )

              if (urlResponse.status !== 'success' || !urlResponse.data) {
                throw new Error(`Failed to get presigned URL for part ${partNumber}`)
              }

              // Upload the chunk
              const etag = await uploadChunk(
                urlResponse.data.presignedUrl,
                chunk,
                partNumber
              )

              // Update progress
              uploadedBytes += chunk.size
              updateProgress({
                uploadedParts: uploadedParts.length + 1,
                uploadedBytes
              })

              return { partNumber, etag }
            })()
          )
        }

        // Wait for batch to complete
        const batchResults = await Promise.all(batchPromises)
        uploadedParts.push(...batchResults)

        setProgress(prev => prev ? {
          ...prev,
          uploadedParts: uploadedParts.length
        } : null)
      }

      // 3. Complete the multipart upload
      methodLogger.info('Completing multipart upload', {
        uploadId,
        key,
        partsCount: uploadedParts.length
      })

      const completeResponse = await completeMultipartUpload(
        uploadId,
        key,
        uploadedParts,
        params.isPublic || false
      )

      if (completeResponse.status !== 'success' || !completeResponse.data) {
        throw new Error(completeResponse.message || 'Failed to complete upload')
      }

      const result: ChunkedUploadResult = completeResponse.data
      
      methodLogger.info('Upload completed successfully', {
        key: result.key,
        url: result.url,
        size: result.size
      })

      setProgress(prev => prev ? { ...prev, percentage: 100 } : null)
      onSuccess?.(result)
      
      return result

    } catch (err) {
      const errorObj = err instanceof Error ? err : new Error(String(err))
      methodLogger.error('Upload failed', errorObj)
      setError(errorObj)
      onError?.(errorObj)
      
      // Attempt to abort the upload if it was started
      if (currentUploadRef.current && !currentUploadRef.current.aborted) {
        try {
          await abortMultipartUpload(
            currentUploadRef.current.uploadId,
            currentUploadRef.current.key,
            currentUploadRef.current.isPublic
          )
        } catch (abortErr) {
          methodLogger.warn('Failed to abort upload', { error: abortErr })
        }
      }
      
      return null
    } finally {
      setIsUploading(false)
      currentUploadRef.current = null
    }
  }, [maxConcurrentUploads, uploadChunk, updateProgress, onSuccess, onError])

  /**
   * Abort current upload
   */
  const abort = useCallback(async () => {
    if (currentUploadRef.current) {
      currentUploadRef.current.aborted = true
      
      try {
        await abortMultipartUpload(
          currentUploadRef.current.uploadId,
          currentUploadRef.current.key,
          currentUploadRef.current.isPublic
        )
      } catch (err) {
        logger.warn('Failed to abort upload', { error: err })
      }
    }
  }, [])

  /**
   * Check if a file should use chunked upload
   */
  const shouldUseChunkedUpload = useCallback((file: File): boolean => {
    return file.size > CHUNKED_UPLOAD_THRESHOLD
  }, [])

  return {
    upload,
    abort,
    isUploading,
    progress,
    error,
    shouldUseChunkedUpload
  }
}
