"use client"

import { useRoles } from "@/lib/contexts/role-context"
import { getRoleLandingPage } from "@/lib/utils/role-hierarchy"
import { useRouter } from "next/navigation"
import { useEffect } from "react"

export default function Dashboard() {
  const { activeRole, isLoading: rolesLoading } = useRoles()
  const router = useRouter()

  useEffect(() => {
    if (rolesLoading) return

    if (!activeRole || activeRole === "user") {
      return
    }

    router.replace(getRoleLandingPage(activeRole))
  }, [activeRole, rolesLoading, router])

  if (rolesLoading || (activeRole && activeRole !== "user")) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <h3 className="text-lg font-medium text-foreground mb-2">Loading Dashboard...</h3>
          <p className="text-muted-foreground">Redirecting to your workspace.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 space-y-4 p-8 pt-6">
      <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
      <p className="text-muted-foreground">Welcome to your workspace.</p>
    </div>
  )
}
