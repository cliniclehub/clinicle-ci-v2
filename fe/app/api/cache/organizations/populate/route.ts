import { fetchOrgWhiteLabelDataByDomain } from "@/lib/actions/organizations/organizations-org-actions"
import { requireApiRouteAuth } from "@/lib/utils/api-route-auth"
import { createServerLogger } from "@/lib/utils/logger-server"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const logger = createServerLogger("OrganizationCachePopulateAPI")

export async function POST() {
  const authFailure = await requireApiRouteAuth(["super_admin"])
  if (authFailure) {
    return authFailure
  }

  try {
    const orgData = await fetchOrgWhiteLabelDataByDomain()

    if (orgData) {
      return NextResponse.json({
        success: true,
        populated: 1,
        message: "Cache populated with current organization data",
      })
    }

    return NextResponse.json({
      success: false,
      populated: 0,
      message: "No organization data found for current domain",
    })
  } catch (error) {
    logger.error("Failed to populate organization cache", error as Error)
    return NextResponse.json(
      {
        error: "Failed to populate cache",
        populated: 0,
      },
      { status: 500 }
    )
  }
}
