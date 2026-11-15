import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  type ListObjectsV2CommandOutput,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import sharp from 'sharp'
import { getPublicMediaUploadKeyPrefix } from '@/lib/utils/public-media-paths'
import {
  decodeR2MetadataValue,
  encodeR2MetadataValue,
} from '@/lib/utils/r2-metadata-encoding'
import { createServerLogger } from '@/lib/utils/logger-server'

export { decodeR2MetadataValue, encodeR2MetadataValue } from '@/lib/utils/r2-metadata-encoding'

const logger = createServerLogger('CloudflareR2Helper')

const r2AccountId = process.env.CLOUDFLARE_ACCOUNT_ID
const r2AccessKeyId = process.env.R2_ACCESS_KEY_ID
const r2SecretAccessKey = process.env.R2_SECRET_ACCESS_KEY
const r2BucketName = process.env.R2_BUCKET_NAME // Private bucket for tenant media
const r2PublicBucketName = process.env.R2_PUBLIC_BUCKET_NAME // Public bucket for images and logos
const r2Endpoint = process.env.R2_ENDPOINT
const r2MediaServerWorkerUrl = process.env.R2_MEDIA_SERVER_WORKER_URL?.replace(/\/$/, '') // Private worker URL
const r2PublicMediaServerWorkerUrl = process.env.R2_PUBLIC_MEDIA_SERVER_WORKER_URL?.replace(/\/$/, '') // Public worker URL (can be same as private)
const mediaSignedLinkExpiresIn = process.env.MEDIA_SIGNED_LINK_EXPIRES_IN

/**
 * Ensures a URL has a protocol (https:// or http://)
 * If the URL doesn't have a protocol, adds https://
 */
function ensureUrlProtocol(url: string): string {
  if (!url) return url
  // If URL already has protocol, return as-is
  if (/^https?:\/\//i.test(url)) {
    return url
  }
  // Add https:// if missing
  return `https://${url}`
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}




// Check if R2 is properly configured
export function isR2Configured(): boolean {
  return !!(r2AccessKeyId && r2SecretAccessKey && r2BucketName)
}

// Check if public R2 is properly configured
export function isR2PublicConfigured(): boolean {
  return !!(r2AccessKeyId && r2SecretAccessKey && r2PublicBucketName)
} 
// Initialize S3 client for R2 (used for both public and private buckets)
const r2Client = new S3Client({
  region: 'auto',
  endpoint: r2Endpoint!,
  credentials: {
    accessKeyId: r2AccessKeyId!,
    secretAccessKey: r2SecretAccessKey!,
  },
})

export interface R2File {
  id: string // always the full key
  key: string
  url: string
  size: number
  mimetype: string
  uploadedAt: string
  originalName: string
  thumbnailUrl?: string // Optional thumbnail URL for images
  duration?: number // Duration in seconds for video and audio files
}

/**
 * Determine if a file key belongs to the public bucket
 * Public paths: orgs/{orgId}/public/images/... or orgs/{orgId}/public/logos/...
 * Private paths: orgs/{orgId}/media/...
 */
function isPublicFileKey(key: string): boolean {
  return key.includes('/public/images/') || key.includes('/public/logos/')
}

/** When listing a bucket, HeadObject must use that same bucket (path alone is not enough for public org prefixes). */
type R2MetadataBucketHint = 'auto' | 'public' | 'private'

function resolvePublicBucketForMetadata(key: string, bucketHint: R2MetadataBucketHint): boolean {
  if (bucketHint === 'public') return true
  if (bucketHint === 'private') return false
  return isPublicFileKey(key)
}

function isHeadObjectMissingError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } }
  if (e.name === 'NotFound' || e.Code === 'NotFound') return true
  if (e.name === 'NoSuchKey' || e.Code === 'NoSuchKey') return true
  if (e.$metadata?.httpStatusCode === 404) return true
  return false
}

type R2ListedObject = NonNullable<ListObjectsV2CommandOutput['Contents']>[number]

function r2FileFromListObject(
  object: R2ListedObject,
  workerUrl: string | undefined,
  isPublic: boolean
): R2File {
  const key = object.Key!
  const workerUrlWithProtocol = workerUrl ? ensureUrlProtocol(workerUrl) : ''
  const url = `${workerUrlWithProtocol}/${key}`
  return {
    id: key,
    key,
    url,
    size: object.Size ?? 0,
    mimetype: 'application/octet-stream',
    uploadedAt: object.LastModified?.toISOString() ?? new Date().toISOString(),
    originalName: object.Key?.split('/').pop() || 'unknown',
  }
}

/**
 * Check if mimetype is an image that can be processed
 */
function isImageMimetype(mimetype: string): boolean {
  return mimetype.startsWith('image/') && 
         ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'].includes(mimetype.toLowerCase())
}

/**
 * Check if mimetype is a PDF
 */
function isPdfMimetype(mimetype: string): boolean {
  return mimetype === 'application/pdf'
}

/**
 * Check if mimetype is a video
 */
function isVideoMimetype(mimetype: string): boolean {
  return mimetype.startsWith('video/')
}

/**
 * Check if mimetype is an audio file
 */
function isAudioMimetype(mimetype: string): boolean {
  return mimetype.startsWith('audio/')
}

/**
 * Check if a file type supports thumbnail generation
 */
function supportsThumbnail(mimetype: string): boolean {
  return isImageMimetype(mimetype) || isPdfMimetype(mimetype) || isVideoMimetype(mimetype)
}

/**
 * Extract duration from video or audio file using ffprobe
 * Returns duration in seconds, or null if extraction fails
 */
async function extractDuration(filePath: string): Promise<number | null> {
  try {
    const { exec } = require('child_process')
    const { promisify } = require('util')
    const execAsync = promisify(exec)
    
    // Use ffprobe to get duration
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
      { timeout: 30000 } // 30 second timeout
    )
    
    const duration = parseFloat(stdout.trim())
    if (isNaN(duration) || duration <= 0) {
      return null
    }
    
    return Math.round(duration) // Return in seconds as integer
  } catch (error) {
    logger.warn('Failed to extract duration', {
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/**
 * Generate thumbnail for an image
 */
async function generateImageThumbnail(
  imageBuffer: Buffer,
  width: number = 200,
  height: number = 200
): Promise<Buffer> {
  return await sharp(imageBuffer)
    .resize(width, height, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 85 })
    .toBuffer()
}

/**
 * Generate thumbnail for a PDF (first page)
 */
async function generatePdfThumbnail(
  pdfBuffer: Buffer,
  width: number = 200,
  height: number = 200
): Promise<Buffer> {
  // PDF.js is not compatible with Next.js server actions due to browser API dependencies
  // This function will throw an error indicating that PDF thumbnails need to be generated
  // via a Cloudflare Worker or API route
  throw new Error(
    'PDF thumbnail generation is not available in server actions. ' +
    'PDF.js requires browser APIs that are not available in Next.js server action context. ' +
    'Please implement PDF thumbnail generation via a Cloudflare Worker or separate API route.'
  )
}

/**
 * Generate thumbnail based on file type
 */
async function generateThumbnail(
  fileBuffer: Buffer,
  mimetype: string,
  width: number = 200,
  height: number = 200
): Promise<Buffer> {
  if (isImageMimetype(mimetype)) {
    return await generateImageThumbnail(fileBuffer, width, height)
  } else if (isPdfMimetype(mimetype)) {
    return await generatePdfThumbnail(fileBuffer, width, height)
  } else if (isVideoMimetype(mimetype)) {
    // Video thumbnail generation requires ffmpeg
    // For now, we'll skip video thumbnails on upload
    // They can be generated via Cloudflare Worker or external service
    throw new Error('Video thumbnail generation not yet supported. Please use Cloudflare Worker or external service.')
  } else {
    throw new Error(`Thumbnail generation not supported for mimetype: ${mimetype}`)
  }
}

/**
 * Get file metadata from R2
 * @param key - The R2 object key
 * @param bucketHint - When listing a bucket, pass "public" | "private" so HeadObject uses the same bucket as ListObjectsV2.
 */
export async function getR2FileMetadata(
  key: string,
  bucketHint: R2MetadataBucketHint = 'auto'
): Promise<R2File | null> {
  const isPublic = resolvePublicBucketForMetadata(key, bucketHint)
  const bucketName = isPublic ? r2PublicBucketName : r2BucketName
  const workerUrl = isPublic 
    ? (r2PublicMediaServerWorkerUrl || r2MediaServerWorkerUrl) 
    : r2MediaServerWorkerUrl
  
  const command = new HeadObjectCommand({
    Bucket: bucketName!,
    Key: key,
  })

  try {
    const response = await r2Client.send(command)
    
    // Ensure workerUrl has protocol (https://)
    const workerUrlWithProtocol = workerUrl ? ensureUrlProtocol(workerUrl) : ''
    
    // Ensure no double slashes
    const fileUrl = `${workerUrlWithProtocol}/${key}`
    
    // Check if thumbnail exists for supported file types
    let thumbnailUrl: string | undefined
    const contentType = response.ContentType || ''
    if (supportsThumbnail(contentType)) {
      const thumbnailKey = key.replace(/\.[^.]+$/, '_thumb.jpg')
      try {
        // Check if thumbnail exists
        const thumbnailCheck = new HeadObjectCommand({
          Bucket: bucketName!,
          Key: thumbnailKey,
        })
        await r2Client.send(thumbnailCheck)
        thumbnailUrl = `${workerUrlWithProtocol}/${thumbnailKey}`
      } catch {
        // Thumbnail doesn't exist, which is okay
        thumbnailUrl = undefined
      }
    }
    
    // Extract duration from metadata if available
    const duration = response.Metadata?.duration 
      ? parseInt(response.Metadata.duration, 10) 
      : undefined
    
    return {
      id: key,
      key,
      url: fileUrl,
      size: response.ContentLength || 0,
      mimetype: response.ContentType || 'application/octet-stream',
      uploadedAt: response.LastModified?.toISOString() || new Date().toISOString(),
      originalName:
        decodeR2MetadataValue(response.Metadata?.originalname) ||
        key.split('/').pop() ||
        'unknown',
      thumbnailUrl,
      duration,
    }
  } catch (error) {
    if (!isHeadObjectMissingError(error)) {
      logger.error('Error getting R2 file metadata', asError(error), { key })
    }
    return null
  }
}

/**
 * Upload a file to Cloudflare R2
 * @param isPublic - If true, uploads to the public image bucket. Otherwise uploads to private tenant media.
 */
export async function uploadToR2(
  file: Buffer,
  fileName: string,
  mimetype: string,
  originalName: string,
  metadata: {
    orgId: string // Only org ID is required
    uploadedBy?: string
    contentType?: string
    isPublic?: boolean // NEW: indicates if file should go to public bucket
  }
): Promise<R2File> {
  // Determine bucket, worker URL, and key prefix based on isPublic flag
  const isPublic = metadata.isPublic === true
  const bucketName = isPublic ? r2PublicBucketName : r2BucketName
  const workerUrl = isPublic 
    ? (r2PublicMediaServerWorkerUrl || r2MediaServerWorkerUrl) 
    : r2MediaServerWorkerUrl
  
  // Determine key prefix based on isPublic
  // Public bucket: orgs/{orgId}/public/images/ or orgs/{orgId}/public/logos/
  // Private bucket: orgs/{orgId}/media/ or orgs/{orgId}/agreements/
  let keyPrefix: string
  if (isPublic) {
    keyPrefix = getPublicMediaUploadKeyPrefix(metadata.orgId, metadata.contentType)
  } else if (metadata.contentType === 'agreement') {
    keyPrefix = `orgs/${metadata.orgId}/agreements/`
  } else {
    keyPrefix = `orgs/${metadata.orgId}/media/`
  }
  
  const key = `${keyPrefix}${Date.now()}-${fileName}`
  
  // Ensure workerUrl has protocol (https://)
  const workerUrlWithProtocol = workerUrl ? ensureUrlProtocol(workerUrl) : ''
  
  // Extract duration for video and audio files
  let duration: number | null = null
  if (isVideoMimetype(mimetype) || isAudioMimetype(mimetype)) {
    const fs = require('fs').promises
    const path = require('path')
    const os = require('os')
    const tempFilePath = path.join(os.tmpdir(), `duration-${Date.now()}-${originalName}`)
    
    try {
      // Write file to temp location for duration extraction
      await fs.writeFile(tempFilePath, file)
      duration = await extractDuration(tempFilePath)
      logger.info('Extracted duration', { duration, originalName })
    } catch (error) {
      logger.warn('Failed to extract duration, continuing without it', {
        originalName,
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      // Clean up temp file
      await fs.unlink(tempFilePath).catch(() => {})
    }
  }
  
  const command = new PutObjectCommand({
    Bucket: bucketName!,
    Key: key,
    Body: file,
    ContentType: mimetype,
    Metadata: {
      originalName: encodeR2MetadataValue(originalName),
      uploadedAt: new Date().toISOString(),
      orgId: metadata.orgId,
      uploadedBy: metadata.uploadedBy || '',
      contentType: metadata.contentType || '',
      isPublic: isPublic ? 'true' : 'false',
      ...(duration !== null && { duration: duration.toString() }),
    },
  })

  try {
    await r2Client.send(command)
    
    // Ensure workerUrl has protocol (https://)
    const workerUrlWithProtocol = workerUrl ? ensureUrlProtocol(workerUrl) : ''
    
    // Ensure no double slashes
    // Note: For public uploads, we don't append token. For private uploads, token will be added when needed via addTokenToMediaUrlAction
    const fileUrl = `${workerUrlWithProtocol}/${key}`
    
    const fileResult: R2File = {
      id: key,
      key,
      url: fileUrl,
      size: file.length,
      mimetype,
      uploadedAt: new Date().toISOString(),
      originalName,
      ...(duration !== null && { duration }),
    }

    // Generate and upload thumbnail for supported file types (images, PDFs, videos)
    // Skip thumbnail generation for large video files to avoid memory issues
    const MAX_VIDEO_SIZE_FOR_THUMBNAIL = 500 * 1024 * 1024 // 500MB
    const shouldGenerateThumbnail = supportsThumbnail(mimetype) && 
      !(isVideoMimetype(mimetype) && file.length > MAX_VIDEO_SIZE_FOR_THUMBNAIL)
    
    logger.debug('Checking thumbnail generation', {
      mimetype,
      fileName: originalName,
      fileSize: file.length,
      supportsThumbnail: supportsThumbnail(mimetype),
      isVideo: isVideoMimetype(mimetype),
      isImage: isImageMimetype(mimetype),
      isPdf: isPdfMimetype(mimetype),
      willGenerate: shouldGenerateThumbnail,
      skipped: isVideoMimetype(mimetype) && file.length > MAX_VIDEO_SIZE_FOR_THUMBNAIL ? 'Video too large' : false
    })
    
    if (shouldGenerateThumbnail) {
      logger.info('Starting thumbnail generation', { originalName, mimetype })
      try {
        let thumbnailBuffer: Buffer
        
        // For images, use sharp directly (fastest)
        if (isImageMimetype(mimetype)) {
          thumbnailBuffer = await generateThumbnail(file, mimetype, 200, 200)
        } else if (isVideoMimetype(mimetype)) {
          // For videos, check if file is small enough to process
          // Large videos (>500MB) will skip thumbnail generation to avoid memory issues
          const MAX_VIDEO_SIZE = 500 * 1024 * 1024 // 500MB
          
          if (file.length > MAX_VIDEO_SIZE) {
            throw new Error(`Video file too large (${(file.length / 1024 / 1024).toFixed(2)}MB) for thumbnail generation. Maximum size: ${(MAX_VIDEO_SIZE / 1024 / 1024).toFixed(0)}MB`)
          }
          
          // For smaller videos, use file-based processing
          const fs = require('fs').promises
          const path = require('path')
          const os = require('os')
          
          const tempFilePath = path.join(os.tmpdir(), `video-${Date.now()}-${originalName}`)
          
          try {
            // Write file to temp location first (streaming, no full memory load)
            await fs.writeFile(tempFilePath, file)
            
            // Use API route with file path instead of buffer
            let baseUrl = `http://localhost:${process.env.PORT || '3000'}`
            if (process.env.VERCEL_URL) {
              baseUrl = `https://${process.env.VERCEL_URL}`
            } else if (process.env.NEXT_PUBLIC_BASE_URL) {
              baseUrl = process.env.NEXT_PUBLIC_BASE_URL
            }
            
            // Pass file path instead of buffer to avoid memory issues
            const response = await fetch(`${baseUrl}/api/generate-thumbnail`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                filePath: tempFilePath,
                mimetype: mimetype,
                width: 200,
                height: 200,
              }),
            })
            
            if (!response.ok) {
              const errorData = await response.json().catch(() => ({}))
              throw new Error(errorData.error || `API route failed with status ${response.status}`)
            }
            
            const result = await response.json()
            if (!result.success || !result.thumbnail) {
              throw new Error('Thumbnail generation failed: ' + (result.error || 'Unknown error'))
            }
            
            // Convert base64 thumbnail back to buffer
            thumbnailBuffer = Buffer.from(result.thumbnail, 'base64')
          } finally {
            // Clean up temp file
            await fs.unlink(tempFilePath).catch(() => {})
          }
        } else if (isPdfMimetype(mimetype)) {
          // For PDFs, use file-based processing (same approach as videos for consistency)
          const fs = require('fs').promises
          const path = require('path')
          const os = require('os')
          
          const tempFilePath = path.join(os.tmpdir(), `pdf-${Date.now()}-${originalName}`)
          
          try {
            // Write PDF to temp location first
            await fs.writeFile(tempFilePath, file)
            
            // Use API route with file path instead of buffer
            let baseUrl = `http://localhost:${process.env.PORT || '3000'}`
            if (process.env.VERCEL_URL) {
              baseUrl = `https://${process.env.VERCEL_URL}`
            } else if (process.env.NEXT_PUBLIC_BASE_URL) {
              baseUrl = process.env.NEXT_PUBLIC_BASE_URL
            }
            
            // Pass file path instead of buffer to avoid multipart parsing issues
            const response = await fetch(`${baseUrl}/api/generate-thumbnail`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                filePath: tempFilePath,
                mimetype: mimetype,
                width: 200,
                height: 200,
              }),
            })
            
            if (!response.ok) {
              const errorData = await response.json().catch(() => ({}))
              throw new Error(errorData.error || `API route failed with status ${response.status}`)
            }
            
            const result = await response.json()
            if (!result.success || !result.thumbnail) {
              throw new Error('Thumbnail generation failed: ' + (result.error || 'Unknown error'))
            }
            
            // Convert base64 thumbnail back to buffer
            thumbnailBuffer = Buffer.from(result.thumbnail, 'base64')
          } finally {
            // Clean up temp file
            await fs.unlink(tempFilePath).catch(() => {})
          }
        } else {
          throw new Error(`Unsupported file type for thumbnail generation: ${mimetype}`)
        }
        
        logger.info('Thumbnail generated successfully', {
          originalName,
          size: thumbnailBuffer.length,
        })
        
        // Generate thumbnail key: replace extension with _thumb.jpg
        const thumbnailKey = key.replace(/\.[^.]+$/, '_thumb.jpg')
        
        const thumbnailCommand = new PutObjectCommand({
          Bucket: bucketName!,
          Key: thumbnailKey,
          Body: thumbnailBuffer,
          ContentType: 'image/jpeg',
          Metadata: {
            originalName: encodeR2MetadataValue(originalName),
            uploadedAt: new Date().toISOString(),
            orgId: metadata.orgId,
            uploadedBy: metadata.uploadedBy || '',
            contentType: 'thumbnail',
            originalKey: key,
            originalMimetype: mimetype,
            isPublic: isPublic ? 'true' : 'false',
          },
        })

        await r2Client.send(thumbnailCommand)
        logger.info('Thumbnail uploaded successfully', { thumbnailKey })
        
        // Add thumbnail URL to result (public files don't need token, private files will get token when needed)
        fileResult.thumbnailUrl = `${workerUrlWithProtocol}/${thumbnailKey}`
      } catch (thumbnailError) {
        // Log error but don't fail the upload if thumbnail generation fails
        const errorMessage = thumbnailError instanceof Error ? thumbnailError.message : String(thumbnailError)
        logger.warn('Thumbnail generation skipped', {
          originalName,
          mimetype,
          reason: errorMessage,
          note: 'Continuing without thumbnail - upload still succeeded'
        })
        // Continue without thumbnail - upload should succeed even if thumbnail fails
      }
    } else {
      logger.debug('Skipping thumbnail generation', {
        originalName,
        mimetype,
        supportsThumbnail: supportsThumbnail(mimetype)
      })
    }
    
    return fileResult
  } catch (error) {
    logger.error('Error uploading to R2', asError(error), { originalName, mimetype })
    throw new Error('Failed to upload file to R2')
  }
}

/**
 * Get a signed URL for downloading a file (if bucket is private)
 */
export async function getSignedDownloadUrl(key: string, expiresIn = parseInt(mediaSignedLinkExpiresIn || '3600')): Promise<string> {
  // Determine if this is a public or private file based on the key
  const isPublic = isPublicFileKey(key)
  const bucketName = isPublic ? r2PublicBucketName : r2BucketName
  
  const command = new GetObjectCommand({
    Bucket: bucketName!,
    Key: key,
  })

  const url = await getSignedUrl(r2Client, command, { expiresIn })
  return url
}

export interface R2DownloadObject {
  body: ReadableStream<Uint8Array>
  contentType: string
  contentLength: number | null
  originalName: string
}

/**
 * Stream one object from R2 for trusted server-side downloads (e.g. Media Manager).
 * Bypasses the private worker so local/dev JWT secret drift cannot break admin downloads.
 */
export async function readR2ObjectForDownload(key: string): Promise<R2DownloadObject> {
  if (!isR2Configured()) {
    throw new Error('R2 is not configured')
  }

  const isPublic = isPublicFileKey(key)
  const bucketName = isPublic ? r2PublicBucketName : r2BucketName
  if (!bucketName) {
    throw new Error('R2 bucket is not configured')
  }

  const metadata = await getR2FileMetadata(key, isPublic ? 'public' : 'private')
  if (!metadata) {
    throw new Error('File not found')
  }

  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: key,
  })
  const response = await r2Client.send(command)
  if (!response.Body) {
    throw new Error('File not found')
  }

  const body = response.Body.transformToWebStream() as ReadableStream<Uint8Array>
  const originalName =
    metadata.originalName?.trim() || key.split('/').filter(Boolean).pop() || 'download'

  return {
    body,
    contentType: response.ContentType || metadata.mimetype || 'application/octet-stream',
    contentLength: response.ContentLength ?? metadata.size ?? null,
    originalName,
  }
}

/**
 * Update/replace a file in R2 with the same key
 */
export async function updateR2File(
  key: string,
  file: Buffer,
  mimetype: string,
  originalName: string,
  metadata: {
    orgId: string
    uploadedBy?: string
    contentType?: string
  }
): Promise<R2File> {
  // Extract duration for video and audio files
  let duration: number | null = null
  if (isVideoMimetype(mimetype) || isAudioMimetype(mimetype)) {
    const fs = require('fs').promises
    const path = require('path')
    const os = require('os')
    const tempFilePath = path.join(os.tmpdir(), `duration-update-${Date.now()}-${originalName}`)
    
    try {
      // Write file to temp location for duration extraction
      await fs.writeFile(tempFilePath, file)
      duration = await extractDuration(tempFilePath)
      logger.info('Extracted duration for update', { duration, originalName, key })
    } catch (error) {
      logger.warn('Failed to extract duration for update, continuing without it', {
        originalName,
        key,
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      // Clean up temp file
      await fs.unlink(tempFilePath).catch(() => {})
    }
  }
  
  // Determine if this is a public or private file based on the key
  const isPublic = isPublicFileKey(key)
  const bucketName = isPublic ? r2PublicBucketName : r2BucketName
  const workerUrl = isPublic 
    ? (r2PublicMediaServerWorkerUrl || r2MediaServerWorkerUrl) 
    : r2MediaServerWorkerUrl
  
  // Ensure workerUrl has protocol (https://)
  const workerUrlWithProtocol = workerUrl ? ensureUrlProtocol(workerUrl) : ''
  
  // Use the same key to replace the existing file
  const command = new PutObjectCommand({
    Bucket: bucketName!,
    Key: key,
    Body: file,
    ContentType: mimetype,
    Metadata: {
      originalName: encodeR2MetadataValue(originalName),
      uploadedAt: new Date().toISOString(),
      orgId: metadata.orgId,
      uploadedBy: metadata.uploadedBy || '',
      contentType: metadata.contentType || '',
      isPublic: isPublic ? 'true' : 'false',
      ...(duration !== null && { duration: duration.toString() }),
    },
  })

  try {
    await r2Client.send(command)
    
    // Ensure no double slashes
    // Note: For public files, we don't append token. For private files, token will be added when needed via addTokenToMediaUrlAction
    const fileUrl = `${workerUrlWithProtocol}/${key}`
    
    const fileResult: R2File = {
      id: key,
      key,
      url: fileUrl,
      size: file.length,
      mimetype,
      uploadedAt: new Date().toISOString(),
      originalName,
      ...(duration !== null && { duration }),
    }

    // Delete old thumbnail if it exists
    const oldThumbnailKey = key.replace(/\.[^.]+$/, '_thumb.jpg')
    try {
      await deleteFromR2(oldThumbnailKey)
    } catch {
      // Old thumbnail might not exist, which is okay
    }

    // Generate and upload new thumbnail for supported file types (images, PDFs, videos)
    // Skip thumbnail generation for large video files to avoid memory issues
    const MAX_VIDEO_SIZE_FOR_THUMBNAIL = 500 * 1024 * 1024 // 500MB
    const shouldGenerateThumbnail = supportsThumbnail(mimetype) && 
      !(isVideoMimetype(mimetype) && file.length > MAX_VIDEO_SIZE_FOR_THUMBNAIL)
    
    logger.debug('Checking thumbnail generation for update', {
      mimetype,
      fileName: originalName,
      fileSize: file.length,
      supportsThumbnail: supportsThumbnail(mimetype),
      isVideo: isVideoMimetype(mimetype),
      isImage: isImageMimetype(mimetype),
      isPdf: isPdfMimetype(mimetype),
      willGenerate: shouldGenerateThumbnail,
      skipped: isVideoMimetype(mimetype) && file.length > MAX_VIDEO_SIZE_FOR_THUMBNAIL ? 'Video too large' : false
    })
    
    if (shouldGenerateThumbnail) {
      logger.info('Starting thumbnail generation for update', { originalName, mimetype, key })
      try {
        let thumbnailBuffer: Buffer
        
        // For images, use sharp directly (fastest)
        if (isImageMimetype(mimetype)) {
          thumbnailBuffer = await generateThumbnail(file, mimetype, 200, 200)
        } else if (isVideoMimetype(mimetype)) {
          // For videos, check if file is small enough to process
          const MAX_VIDEO_SIZE = 500 * 1024 * 1024 // 500MB
          
          if (file.length > MAX_VIDEO_SIZE) {
            throw new Error(`Video file too large (${(file.length / 1024 / 1024).toFixed(2)}MB) for thumbnail generation. Maximum size: ${(MAX_VIDEO_SIZE / 1024 / 1024).toFixed(0)}MB`)
          }
          
          // For smaller videos, use file-based processing
          const fs = require('fs').promises
          const path = require('path')
          const os = require('os')
          
          const tempFilePath = path.join(os.tmpdir(), `video-update-${Date.now()}-${originalName}`)
          
          try {
            // Write file to temp location
            await fs.writeFile(tempFilePath, file)
            
            // Use API route with file path instead of buffer
            let baseUrl = `http://localhost:${process.env.PORT || '3000'}`
            if (process.env.VERCEL_URL) {
              baseUrl = `https://${process.env.VERCEL_URL}`
            } else if (process.env.NEXT_PUBLIC_BASE_URL) {
              baseUrl = process.env.NEXT_PUBLIC_BASE_URL
            }
            
            // Pass file path instead of buffer to avoid memory issues
            const response = await fetch(`${baseUrl}/api/generate-thumbnail`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                filePath: tempFilePath,
                mimetype: mimetype,
                width: 200,
                height: 200,
              }),
            })
            
            if (!response.ok) {
              const errorData = await response.json().catch(() => ({}))
              throw new Error(errorData.error || `API route failed with status ${response.status}`)
            }
            
            const result = await response.json()
            if (!result.success || !result.thumbnail) {
              throw new Error('Thumbnail generation failed: ' + (result.error || 'Unknown error'))
            }
            
            // Convert base64 thumbnail back to buffer
            thumbnailBuffer = Buffer.from(result.thumbnail, 'base64')
          } finally {
            // Clean up temp file
            await fs.unlink(tempFilePath).catch(() => {})
          }
        } else if (isPdfMimetype(mimetype)) {
          // For PDFs, use file-based processing (same approach as videos for consistency)
          const fs = require('fs').promises
          const path = require('path')
          const os = require('os')
          
          const tempFilePath = path.join(os.tmpdir(), `pdf-${Date.now()}-${originalName}`)
          
          try {
            // Write PDF to temp location first
            await fs.writeFile(tempFilePath, file)
            
            // Use API route with file path instead of buffer
            let baseUrl = `http://localhost:${process.env.PORT || '3000'}`
            if (process.env.VERCEL_URL) {
              baseUrl = `https://${process.env.VERCEL_URL}`
            } else if (process.env.NEXT_PUBLIC_BASE_URL) {
              baseUrl = process.env.NEXT_PUBLIC_BASE_URL
            }
            
            // Pass file path instead of buffer to avoid multipart parsing issues
            const response = await fetch(`${baseUrl}/api/generate-thumbnail`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                filePath: tempFilePath,
                mimetype: mimetype,
                width: 200,
                height: 200,
              }),
            })
            
            if (!response.ok) {
              const errorData = await response.json().catch(() => ({}))
              throw new Error(errorData.error || `API route failed with status ${response.status}`)
            }
            
            const result = await response.json()
            if (!result.success || !result.thumbnail) {
              throw new Error('Thumbnail generation failed: ' + (result.error || 'Unknown error'))
            }
            
            // Convert base64 thumbnail back to buffer
            thumbnailBuffer = Buffer.from(result.thumbnail, 'base64')
          } finally {
            // Clean up temp file
            await fs.unlink(tempFilePath).catch(() => {})
          }
        } else {
          throw new Error(`Unsupported file type for thumbnail generation: ${mimetype}`)
        }
        
        logger.info('Thumbnail generated successfully for update', {
          originalName,
          key,
          size: thumbnailBuffer.length,
        })
        
        // Generate thumbnail key: replace extension with _thumb.jpg
        const thumbnailKey = key.replace(/\.[^.]+$/, '_thumb.jpg')
        
        const thumbnailCommand = new PutObjectCommand({
          Bucket: bucketName!,
          Key: thumbnailKey,
          Body: thumbnailBuffer,
          ContentType: 'image/jpeg',
          Metadata: {
            originalName: encodeR2MetadataValue(originalName),
            uploadedAt: new Date().toISOString(),
            orgId: metadata.orgId,
            uploadedBy: metadata.uploadedBy || '',
            contentType: 'thumbnail',
            originalKey: key,
            originalMimetype: mimetype,
            isPublic: isPublic ? 'true' : 'false',
          },
        })

        await r2Client.send(thumbnailCommand)
        logger.info('Thumbnail uploaded successfully for update', { thumbnailKey })
        
        // Add thumbnail URL to result (public files don't need token, private files will get token when needed)
        fileResult.thumbnailUrl = `${workerUrlWithProtocol}/${thumbnailKey}`
      } catch (thumbnailError) {
        // Log error but don't fail the update if thumbnail generation fails
        const errorMessage = thumbnailError instanceof Error ? thumbnailError.message : String(thumbnailError)
        logger.warn('Thumbnail generation skipped for update', {
          originalName,
          key,
          mimetype,
          reason: errorMessage,
          note: 'Continuing without thumbnail - update still succeeded'
        })
        // Continue without thumbnail - update should succeed even if thumbnail fails
      }
    }
    
    return fileResult
  } catch (error) {
    logger.error('Error updating file in R2', asError(error), { key, originalName, mimetype })
    throw new Error('Failed to update file in R2')
  }
}

/**
 * Rename a file in R2 (updates metadata only, keeps same file content)
 * This function copies the object to itself with updated metadata using CopyObjectCommand
 */
export async function renameR2File(key: string, newName: string): Promise<R2File> {
  try {
    // First, get the current file metadata
    const currentMetadata = await getR2FileMetadata(key)
    if (!currentMetadata) {
      throw new Error('File not found')
    }

    // Determine if this is a public or private file based on the key
    const isPublic = isPublicFileKey(key)
    const bucketName = isPublic ? r2PublicBucketName : r2BucketName
    
    // Get the actual file object
    const getCommand = new GetObjectCommand({
      Bucket: bucketName!,
      Key: key,
    })
    
    const fileObject = await r2Client.send(getCommand)
    
    // Extract orgId from metadata (case-insensitive)
    const orgId = fileObject.Metadata?.orgid || fileObject.Metadata?.orgId || ''
    const uploadedBy = fileObject.Metadata?.uploadedby || fileObject.Metadata?.uploadedBy || ''
    const contentType = fileObject.Metadata?.contenttype || fileObject.Metadata?.contentType || 'media'
    const duration = fileObject.Metadata?.duration || fileObject.Metadata?.Duration || null

    // Copy object to itself with updated metadata
    const copyCommand = new CopyObjectCommand({
      Bucket: bucketName!,
      CopySource: `${bucketName}/${key}`,
      Key: key,
      ContentType: currentMetadata.mimetype,
      Metadata: {
        originalName: encodeR2MetadataValue(newName),
        uploadedAt: fileObject.Metadata?.uploadedat || fileObject.Metadata?.uploadedAt || new Date().toISOString(),
        orgId: orgId,
        uploadedBy: uploadedBy,
        contentType: contentType,
        ...(duration && { duration: duration }),
      },
      MetadataDirective: 'REPLACE', // Replace existing metadata
    })

    await r2Client.send(copyCommand)

    // Also update thumbnail metadata if it exists
    const thumbnailKey = key.replace(/\.[^.]+$/, '_thumb.jpg')
    try {
      const thumbnailCheck = new HeadObjectCommand({
        Bucket: bucketName!,
        Key: thumbnailKey,
      })
      await r2Client.send(thumbnailCheck)
      
      // Thumbnail exists, update its metadata too
      const thumbnailCopyCommand = new CopyObjectCommand({
        Bucket: bucketName!,
        CopySource: `${bucketName}/${thumbnailKey}`,
        Key: thumbnailKey,
        ContentType: 'image/jpeg',
        Metadata: {
          originalName: encodeR2MetadataValue(newName),
          uploadedAt: fileObject.Metadata?.uploadedat || fileObject.Metadata?.uploadedAt || new Date().toISOString(),
          orgId: orgId,
          uploadedBy: uploadedBy,
          contentType: 'thumbnail',
          originalKey: key,
          originalMimetype: currentMetadata.mimetype,
        },
        MetadataDirective: 'REPLACE',
      })
      await r2Client.send(thumbnailCopyCommand)
    } catch {
      // Thumbnail doesn't exist, which is okay
    }

    // Determine worker URL based on whether file is public
    const workerUrl = isPublic 
      ? (r2PublicMediaServerWorkerUrl || r2MediaServerWorkerUrl || '') 
      : (r2MediaServerWorkerUrl || '')
    
    // Ensure workerUrl has protocol (https://)
    const workerUrlWithProtocol = workerUrl ? ensureUrlProtocol(workerUrl) : ''
    
    // Return updated file metadata
    return {
      id: key,
      key,
      url: workerUrlWithProtocol ? `${workerUrlWithProtocol}/${key}` : key,
      size: currentMetadata.size,
      mimetype: currentMetadata.mimetype,
      uploadedAt: currentMetadata.uploadedAt,
      originalName: newName,
      thumbnailUrl: currentMetadata.thumbnailUrl,
      duration: currentMetadata.duration,
    }
  } catch (error) {
    logger.error('Error renaming file in R2', asError(error), { key, newName })
    throw new Error('Failed to rename file in R2')
  }
}

/**
 * Delete a file from R2
 */
export async function deleteFromR2(key: string): Promise<void> {
  // Determine if this is a public or private file based on the key
  const isPublic = isPublicFileKey(key)
  const bucketName = isPublic ? r2PublicBucketName : r2BucketName
  
  const command = new DeleteObjectCommand({
    Bucket: bucketName!,
    Key: key,
  })

  try {
    await r2Client.send(command)
  } catch (error) {
    logger.error('Error deleting from R2', asError(error), { key })
    throw new Error('Failed to delete file from R2')
  }
}

/**
 * List files in R2 bucket with org filtering
 * @param orgId - Organization ID to filter files
 * @param prefix - Optional prefix to filter files
 * @param isPublic - If true, lists files from public bucket. If false, lists from private bucket.
 */
export async function listR2Files(orgId: string, prefix = '', isPublic = false): Promise<R2File[]> {
  const bucketName = isPublic ? r2PublicBucketName : r2BucketName
  const workerUrl = isPublic 
    ? (r2PublicMediaServerWorkerUrl || r2MediaServerWorkerUrl) 
    : r2MediaServerWorkerUrl
  
  // Determine prefix based on isPublic
  // Public bucket: orgs/{orgId}/public/ (contains images/ and logos/)
  // Private bucket: orgs/{orgId}/media/
  let fullPrefix: string
  if (isPublic) {
    // Scope public listings to the organization's public subtree.
    fullPrefix = `orgs/${orgId}/public/${prefix}`
  } else {
    fullPrefix = `orgs/${orgId}/media/${prefix}`
  }
  
  const command = new ListObjectsV2Command({
    Bucket: bucketName!,
    Prefix: fullPrefix,
  })

  try {
    const response = await r2Client.send(command)
    
    if (!response.Contents) {
      return []
    }

    const bucketHint: R2MetadataBucketHint = isPublic ? 'public' : 'private'
    const filesWithMetadata = await Promise.all(
      response.Contents.map(async (object) => {
        // Skip thumbnail files
        if (object.Key?.endsWith('_thumb.jpg')) {
          return null
        }

        const metadata = await getR2FileMetadata(object.Key!, bucketHint)
        if (metadata) {
          return metadata
        }
        // Head can 404 (race) or fail while list still returned the key — use list row
        return r2FileFromListObject(object, workerUrl, isPublic)
      })
    )

    return filesWithMetadata.filter((file): file is R2File => file !== null)
  } catch (error) {
    logger.error('Error listing R2 files', asError(error), { orgId, prefix, isPublic })
    throw new Error('Failed to list files from R2')
  }
}
