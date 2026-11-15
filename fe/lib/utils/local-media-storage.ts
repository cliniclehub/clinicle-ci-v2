import { promises as fs } from "fs"
import path from "path"

import { createServerLogger } from "@/lib/utils/logger-server"
import { getPublicMediaUploadKeyPrefix } from "@/lib/utils/public-media-paths"

const logger = createServerLogger("LocalMediaStorage")

export type LocalMediaFile = {
  id: string
  key: string
  url: string
  size: number
  mimetype: string
  uploadedAt: string
  originalName: string
  thumbnailUrl?: string
}

function storageRoot(): string {
  const configured = process.env.LOCAL_MEDIA_ROOT?.trim()
  if (configured) {
    return path.resolve(configured)
  }
  // Repo-root local-media/ (sibling of fe/) so volumes are easy later.
  return path.resolve(process.cwd(), "..", "local-media")
}

export function isLocalMediaStorageEnabled(): boolean {
  const mode = (process.env.MEDIA_STORAGE || "").trim().toLowerCase()
  return mode === "local" || mode === "disk" || mode === "filesystem"
}

/** Public URL path stored on organization.logo_url / favicon_url. */
export function localMediaPublicUrl(key: string): string {
  const clean = key.replace(/^\/+/, "")
  return `/api/local-media/${clean}`
}

export function resolveLocalMediaAbsolutePath(key: string): string {
  const clean = key.replace(/^\/+/, "")
  if (!clean.startsWith("orgs/") || clean.includes("..") || path.isAbsolute(clean)) {
    throw new Error("Invalid local media key")
  }
  const absolutePath = path.resolve(storageRoot(), clean)
  const root = path.resolve(storageRoot())
  if (!absolutePath.startsWith(root + path.sep) && absolutePath !== root) {
    throw new Error("Invalid local media key")
  }
  return absolutePath
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
}

async function writeSidecar(
  absoluteFilePath: string,
  meta: {
    originalName: string
    mimetype: string
    uploadedAt: string
    orgId: string
    contentType?: string
  }
): Promise<void> {
  await fs.writeFile(`${absoluteFilePath}.json`, JSON.stringify(meta, null, 2), "utf8")
}

async function readSidecar(
  absoluteFilePath: string
): Promise<{ originalName?: string; mimetype?: string; uploadedAt?: string } | null> {
  try {
    const raw = await fs.readFile(`${absoluteFilePath}.json`, "utf8")
    return JSON.parse(raw) as { originalName?: string; mimetype?: string; uploadedAt?: string }
  } catch {
    return null
  }
}

export async function uploadToLocalMedia(
  file: Buffer,
  fileName: string,
  mimetype: string,
  originalName: string,
  metadata: {
    orgId: string
    uploadedBy?: string
    contentType?: string
    isPublic?: boolean
  }
): Promise<LocalMediaFile> {
  if (!metadata.isPublic) {
    throw new Error(
      "Local media storage currently supports public branding uploads only (logo/favicon)"
    )
  }

  const keyPrefix = getPublicMediaUploadKeyPrefix(metadata.orgId, metadata.contentType)
  const key = `${keyPrefix}${Date.now()}-${fileName}`
  const absolutePath = resolveLocalMediaAbsolutePath(key)
  await ensureDir(path.dirname(absolutePath))
  await fs.writeFile(absolutePath, file)

  const uploadedAt = new Date().toISOString()
  await writeSidecar(absolutePath, {
    originalName,
    mimetype,
    uploadedAt,
    orgId: metadata.orgId,
    contentType: metadata.contentType,
  })

  logger.info("Uploaded local media file", { key, size: file.length, orgId: metadata.orgId })

  return {
    id: key,
    key,
    url: localMediaPublicUrl(key),
    size: file.length,
    mimetype,
    uploadedAt,
    originalName,
  }
}

export async function listLocalMediaFiles(
  orgId: string,
  prefix = "",
  isPublic = false
): Promise<LocalMediaFile[]> {
  if (!isPublic) {
    return []
  }

  const relativeDir = path.posix.join(`orgs/${orgId}`, prefix.replace(/^\/+|\/+$/g, ""))
  const targetDir = resolveLocalMediaAbsolutePath(relativeDir)

  let entries: string[] = []
  try {
    entries = await fs.readdir(targetDir)
  } catch {
    return []
  }

  const files: LocalMediaFile[] = []
  for (const name of entries) {
    if (name.endsWith(".json")) continue
    const absolutePath = path.join(targetDir, name)
    const stat = await fs.stat(absolutePath)
    if (!stat.isFile()) continue

    const key = `${relativeDir}/${name}`.replace(/\/+/g, "/")
    const meta = await readSidecar(absolutePath)
    files.push({
      id: key,
      key,
      url: localMediaPublicUrl(key),
      size: stat.size,
      mimetype: meta?.mimetype || "application/octet-stream",
      uploadedAt: meta?.uploadedAt || stat.mtime.toISOString(),
      originalName: meta?.originalName || name,
    })
  }

  files.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))
  return files
}

export async function deleteLocalMedia(key: string): Promise<void> {
  const absolutePath = resolveLocalMediaAbsolutePath(key)
  await fs.unlink(absolutePath).catch(() => undefined)
  await fs.unlink(`${absolutePath}.json`).catch(() => undefined)
}
