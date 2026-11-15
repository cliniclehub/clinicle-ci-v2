"use client"

import { useRoles } from "@/lib/contexts/role-context"
import { createClientLogger } from "@/lib/utils/logger-client"
import { getDefaultLandingPage } from "@/lib/utils/navigation-helper"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect } from "react"

export default function UnauthorizedPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { activeRole } = useRoles()
  const landingPage = getDefaultLandingPage(activeRole)
  
  const requestedPage = searchParams.get("requested")
  const userRoles = searchParams.get("role")?.split(",") || []
  
  const logger = createClientLogger("UnauthorizedPage")
  
  useEffect(() => {
    if (requestedPage) {
      logger.warn("Unauthorized access attempt", {
        requestedPage,
        userRoles,
        activeRole,
      })
      console.log(`[UnauthorizedPage] User with roles [${userRoles.join(", ")}] tried to access: ${requestedPage}`)
    }
  }, [requestedPage, userRoles, activeRole, logger])

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-red-600 mb-4">Access Denied</h1>
        <p className="text-muted-foreground mb-4">
          You don't have permission to access this page.
        </p>
        {requestedPage && (
          <p className="text-sm text-muted-foreground mb-4">
            Attempted to access: <code className="bg-muted px-2 py-1 rounded">{requestedPage}</code>
          </p>
        )}
        <Link 
          href={landingPage}
          className="text-blue-600 hover:text-blue-800 underline"
        >
          Return to Homepage
        </Link>
      </div>
    </div>
  );
}
