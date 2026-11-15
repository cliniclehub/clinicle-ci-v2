import { promises as fs } from "fs"
import path from "path"

import {
  isLocalMediaStorageEnabled,
  resolveLocalMediaAbsolutePath,
} from "@/lib/utils/local-media-storage"
import { createServerLogger } from "@/lib/utils/logger-server"
import { NextRequest, NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const logger = createServerLogger("LocalMediaAPI")

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
}

async function readSidecarMime(absoluteFilePath: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(`${absoluteFilePath}.json`, "utf8")
    const meta = JSON.parse(raw) as { mimetype?: string }
    return meta.mimetype?.trim() || null
  } catch {
    return null
  }
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  if (!isLocalMediaStorageEnabled()) {
    return NextResponse.json({ message: "Local media storage is disabled" }, { status: 404 })
  }

  const { path: segments } = await context.params
  const key = (segments || []).join("/")
  if (!key) {
    return NextResponse.json({ message: "Missing media path" }, { status: 400 })
  }

  try {
    const absolutePath = resolveLocalMediaAbsolutePath(key)
    const data = await fs.readFile(absolutePath)
    const sidecarMime = await readSidecarMime(absolutePath)
    const contentType =
      sidecarMime || MIME_BY_EXT[path.extname(absolutePath).toLowerCase()] || "application/octet-stream"

    return new NextResponse(data, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600",
        "Content-Length": String(data.byteLength),
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message === "Invalid local media key" || (error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return NextResponse.json({ message: "File not found" }, { status: 404 })
    }
    logger.error("Failed to serve local media", error as Error, { key: key.slice(0, 120) })
    return NextResponse.json({ message: "Failed to serve media" }, { status: 500 })
  }
}
