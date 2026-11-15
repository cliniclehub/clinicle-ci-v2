'use client'

import { useAuth } from "@/lib/contexts/auth-context"
import { useRoles } from "@/lib/contexts/role-context"
import { getDefaultLandingPage } from "@/lib/utils/navigation-helper"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

export default function Home() {
  const router = useRouter()
  const { isAuthenticated, isLoading } = useAuth()
  const { activeRole, isLoading: rolesLoading } = useRoles()
  const [hasRedirected, setHasRedirected] = useState(false)

  useEffect(() => {
    if (isLoading || rolesLoading) return // Wait for auth state and roles to load

    if (isAuthenticated && !hasRedirected) {
      // Authenticated: use the active role when known; otherwise use the generic dashboard.
      setHasRedirected(true)
      const landingPage = getDefaultLandingPage(activeRole)
      router.push(landingPage)
    } else if (!isAuthenticated && !hasRedirected) {
      // Unauthenticated users go to landing page
      setHasRedirected(true)
      router.push("/site-landing")
    }
  }, [isAuthenticated, isLoading, rolesLoading, router, hasRedirected, activeRole])

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500 mx-auto mb-4"></div>
        <h1 className="text-2xl font-bold text-foreground mb-2">Loading...</h1>
        <p className="text-muted-foreground">Please wait...</p>
      </div>
    </div>
  )
}
