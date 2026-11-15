import { streamMediaFileDownload } from "@/lib/actions/media-manager/media-manager-actions"
import { createServerLogger } from "@/lib/utils/logger-server"
import { NextRequest, NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const logger = createServerLogger("MediaManagerDownloadAPI")

function contentDispositionAttachment(filename: string): string {
  const safe = filename.replace(/["\r\n]/g, "_")
  const encoded = encodeURIComponent(filename)
  return `attachment; filename="${safe}"; filename*=UTF-8''${encoded}`
}

export async function GET(request: NextRequest) {
  const objectKey = request.nextUrl.searchParams.get("objectKey")?.trim()
  if (!objectKey) {
    return NextResponse.json({ message: "objectKey is required" }, { status: 400 })
  }

  try {
    const { body, contentType, contentLength, originalName } =
      await streamMediaFileDownload(objectKey)

    const headers = new Headers({
      "Content-Type": contentType,
      "Content-Disposition": contentDispositionAttachment(originalName),
      "Cache-Control": "private, no-store",
    })
    if (contentLength != null) {
      headers.set("Content-Length", String(contentLength))
    }

    return new NextResponse(body, { status: 200, headers })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Download failed"
    logger.error("Media manager download failed", error as Error, {
      objectKey: objectKey.slice(0, 120),
    })

    if (message === "Unauthorized") {
      return NextResponse.json({ message: "Sign in required to download media." }, { status: 401 })
    }
    if (message === "File not found") {
      return NextResponse.json({ message: "File not found" }, { status: 404 })
    }
    if (message.startsWith("Access denied")) {
      return NextResponse.json({ message }, { status: 403 })
    }

    return NextResponse.json({ message: "Failed to download file" }, { status: 500 })
  }
}
