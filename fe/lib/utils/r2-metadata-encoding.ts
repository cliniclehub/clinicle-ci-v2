/**
 * R2/S3 user metadata becomes HTTP headers (x-amz-meta-*), which must be ASCII.
 * macOS screenshots often use U+202F before AM/PM and break PutObject otherwise.
 */
export function encodeR2MetadataValue(value: string): string {
  return encodeURIComponent(value)
}

/** Inverse of encodeR2MetadataValue; tolerates older unencoded metadata. */
export function decodeR2MetadataValue(value: string | undefined | null): string {
  if (!value) return ""
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
