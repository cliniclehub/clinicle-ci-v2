import { clearOrganizationCache, getOrganizationCacheInfo } from "@/lib/actions/organizations/organizations-org-actions"
import { requireApiRouteAuth } from "@/lib/utils/api-route-auth"
import { createServerLogger } from "@/lib/utils/logger-server"
import { NextRequest, NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const logger = createServerLogger("OrganizationCacheAPI")

export async function GET() {
  const authFailure = await requireApiRouteAuth(["super_admin"])
  if (authFailure) {
    return authFailure
  }

  try {
    const cacheInfo = await getOrganizationCacheInfo()
    return NextResponse.json(cacheInfo)
  } catch (error) {
    logger.error("Failed to get organization cache info", error as Error)
    return NextResponse.json({ error: "Failed to get cache info" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const authFailure = await requireApiRouteAuth(["super_admin"])
  if (authFailure) {
    return authFailure
  }

  try {
    const { searchParams } = new URL(request.url)
    const domain = searchParams.get("domain")

    const result = await clearOrganizationCache(domain || undefined)
    return NextResponse.json({ success: true, result })
  } catch (error) {
    logger.error("Failed to clear organization cache", error as Error)
    return NextResponse.json({ error: "Failed to clear cache" }, { status: 500 })
  }
}
