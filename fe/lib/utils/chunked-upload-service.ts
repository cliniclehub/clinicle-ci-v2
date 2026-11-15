"use server"

import { ApiResponse } from '@/lib/types/api-response-schema'
import { apiCaller } from '@/lib/utils/api-caller-helper'
import { createServerLogger } from '@/lib/utils/logger-server'

const logger = createServerLogger('ChunkedUploadService')

// Types for multipart upload
export interface InitiateUploadParams {
  fileName: string
  fileType: string
  fileSize: number
  isPublic?: boolean
  contentType?: string
}

export interface InitiateUploadResponse {
  uploadId: string
  key: string
  bucket: string
  chunkSize: number
  totalParts: number
}

export interface PresignedUrlResponse {
  presignedUrl: string
  partNumber: number
  expiresIn: number
}

export interface UploadedPart {
  partNumber: number
  etag: string
}

export interface CompleteUploadResponse {
  key: string
  url: string
  size: number
  etag: string
  mimetype?: string
  mediaAssetId?: string
}

export interface ChunkedUploadProgress {
  uploadedParts: number
  totalParts: number
  uploadedBytes: number
  totalBytes: number
  percentage: number
}

// Note: CHUNKED_UPLOAD_THRESHOLD is defined in upload-constants.ts
// Import it from there for client-side usage

/**
 * Initiate a multipart upload
 */
export async function initiateMultipartUpload(
  params: InitiateUploadParams
): Promise<ApiResponse<InitiateUploadResponse>> {
  const methodLogger = logger.forMethod('initiateMultipartUpload')
  
  methodLogger.info('Initiating multipart upload', {
    fileName: params.fileName,
    fileSize: params.fileSize,
    isPublic: params.isPublic
  })
  
  const response = await apiCaller.post<InitiateUploadResponse>(
    '/media/multipart/initiate/',
    {
      file_name: params.fileName,
      file_type: params.fileType,
      file_size: params.fileSize,
      is_public: params.isPublic || false,
      content_type: params.contentType
    },
    { requireAuth: true }
  )
  
  return response
}

/**
 * Get a presigned URL for uploading a specific part
 */
export async function getPresignedUrl(
  uploadId: string,
  key: string,
  partNumber: number,
  isPublic: boolean = false
): Promise<ApiResponse<PresignedUrlResponse>> {
  const response = await apiCaller.post<PresignedUrlResponse>(
    '/media/multipart/presigned-url/',
    {
      upload_id: uploadId,
      key: key,
      part_number: partNumber,
      is_public: isPublic
    },
    { requireAuth: true }
  )
  
  return response
}

/**
 * Get multiple presigned URLs in batch
 */
export async function getPresignedUrlsBatch(
  uploadId: string,
  key: string,
  partNumbers: number[],
  isPublic: boolean = false
): Promise<ApiResponse<{ urls: PresignedUrlResponse[] }>> {
  const response = await apiCaller.post<{ urls: PresignedUrlResponse[] }>(
    '/media/multipart/presigned-urls/batch/',
    {
      upload_id: uploadId,
      key: key,
      part_numbers: partNumbers,
      is_public: isPublic
    },
    { requireAuth: true }
  )
  
  return response
}

/**
 * Complete a multipart upload
 */
export async function completeMultipartUpload(
  uploadId: string,
  key: string,
  parts: UploadedPart[],
  isPublic: boolean = false,
  metadata?: Record<string, string>
): Promise<ApiResponse<CompleteUploadResponse>> {
  const methodLogger = logger.forMethod('completeMultipartUpload')
  
  methodLogger.info('Completing multipart upload', {
    uploadId,
    key,
    partsCount: parts.length
  })
  
  const response = await apiCaller.post<CompleteUploadResponse>(
    '/media/multipart/complete/',
    {
      upload_id: uploadId,
      key: key,
      parts: parts.map(p => ({
        part_number: p.partNumber,
        etag: p.etag
      })),
      is_public: isPublic,
      metadata: metadata
    },
    { requireAuth: true }
  )
  
  return response
}

/**
 * Abort a multipart upload
 */
export async function abortMultipartUpload(
  uploadId: string,
  key: string,
  isPublic: boolean = false
): Promise<ApiResponse<{ success: boolean; message: string }>> {
  const methodLogger = logger.forMethod('abortMultipartUpload')
  
  methodLogger.info('Aborting multipart upload', { uploadId, key })
  
  const response = await apiCaller.post<{ success: boolean; message: string }>(
    '/media/multipart/abort/',
    {
      upload_id: uploadId,
      key: key,
      is_public: isPublic
    },
    { requireAuth: true }
  )
  
  return response
}
