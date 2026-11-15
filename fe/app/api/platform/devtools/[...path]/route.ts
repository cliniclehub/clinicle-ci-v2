import { getAccessToken, userHasAnyRole } from "@/lib/utils/auth-server-helper"
import { NextRequest, NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const BACKEND_PATHS: Record<string, string> = {
  docs: "/api/docs",
  redoc: "/api/redoc",
  "openapi.json": "/api/openapi.json",
  health: "/api/v1/health",
  "health/database": "/api/v1/health/database",
  "health/pool": "/api/v1/health/pool",
}

function backendOrigin(): string {
  const defaultBaseUrl = process.env.NEXT_PUBLIC_BACKEND_API_URL || "http://localhost:8000"
  return defaultBaseUrl.replace(/\/api\/v1\/?$/, "").replace(/\/$/, "")
}

function rewriteDocsHtml(html: string): string {
  return html.replaceAll("/api/openapi.json", "/api/platform/devtools/openapi.json")
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  const isSuperAdmin = await userHasAnyRole(["super_admin"])
  if (!isSuperAdmin) {
    return NextResponse.json({ message: "Forbidden" }, { status: 403 })
  }

  const token = await getAccessToken()
  if (!token) {
    return NextResponse.json({ message: "Sign in required" }, { status: 401 })
  }

  const { path: pathSegments } = await context.params
  const resourcePath = pathSegments.join("/")
  const backendPath = BACKEND_PATHS[resourcePath]
  if (!backendPath) {
    return NextResponse.json({ message: "Not found" }, { status: 404 })
  }

  const backendRes = await fetch(`${backendOrigin()}${backendPath}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  })

  if (!backendRes.ok) {
    const body = await backendRes.text()
    return new NextResponse(body, {
      status: backendRes.status,
      headers: { "Content-Type": backendRes.headers.get("Content-Type") || "text/plain" },
    })
  }

  const contentType = backendRes.headers.get("Content-Type") || ""

  if (resourcePath === "docs" || resourcePath === "redoc") {
    const html = rewriteDocsHtml(await backendRes.text())
    return new NextResponse(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    })
  }

  if (contentType.includes("application/json")) {
    return NextResponse.json(await backendRes.json())
  }

  return new NextResponse(await backendRes.text(), {
    status: 200,
    headers: { "Content-Type": contentType },
  })
}
