// Upload configuration constants
// This file is NOT a server action file, so it can export constants

// Threshold for using chunked upload (10MB)
// Files larger than this will be uploaded in chunks for reliability
export const CHUNKED_UPLOAD_THRESHOLD = 10 * 1024 * 1024

/** Max upload sizes by content kind (bytes). Keep in sync across MediaManager callers. */
export const MAX_UPLOAD_SIZE_BYTES = {
  video: 2 * 1024 * 1024 * 1024, // 2 GB — long recordings
  audio: 100 * 1024 * 1024, // 100 MB
  pdf: 50 * 1024 * 1024, // 50 MB
  download: 200 * 1024 * 1024, // 200 MB
  image: 5 * 1024 * 1024, // 5 MB — logos and public images
  default: 100 * 1024 * 1024, // 100 MB
} as const

/** Org media library accepts images, video, audio, and PDF — use the video cap. */
export const ORG_MEDIA_LIBRARY_MAX_FILE_SIZE_BYTES = MAX_UPLOAD_SIZE_BYTES.video
