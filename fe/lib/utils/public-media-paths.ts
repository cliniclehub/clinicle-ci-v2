/** Public R2 subfolders under orgs/{orgId}/ */

export type PublicMediaSubfolder = "logos" | "images"

export function resolvePublicMediaSubfolder(contentType?: string | null): PublicMediaSubfolder | null {
  if (contentType === "logo" || contentType === "favicon") {
    return "logos"
  }
  if (contentType === "public-image" || contentType === "image") {
    return "images"
  }
  return null
}

/** Prefix passed to listMediaFilesAction for public bucket scoping. */
export function getPublicMediaListPrefix(contentType?: string | null): string {
  const subfolder = resolvePublicMediaSubfolder(contentType)
  return subfolder ? `${subfolder}/` : ""
}

/** Full R2 key prefix for public uploads. */
export function getPublicMediaUploadKeyPrefix(orgId: string, contentType?: string | null): string {
  const subfolder = resolvePublicMediaSubfolder(contentType) ?? "images"
  return `orgs/${orgId}/public/${subfolder}/`
}
