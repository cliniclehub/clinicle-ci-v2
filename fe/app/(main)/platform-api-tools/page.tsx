"use client"

import { PlatformApiToolsPanel } from "@/components/platform-api-tools/platform-api-tools-panel"
import { useRoles } from "@/lib/contexts/role-context"
import { getDefaultLandingPage } from "@/lib/utils/navigation-helper"
import { useRouter } from "next/navigation"
import { useEffect } from "react"

export default function PlatformApiToolsPage() {
  const { activeRole } = useRoles()
  const router = useRouter()

  useEffect(() => {
    if (activeRole && activeRole !== "super_admin") {
      router.push(getDefaultLandingPage(activeRole))
    }
  }, [activeRole, router])

  if (activeRole !== "super_admin") {
    return null
  }

  return (
    <div className="flex-1 space-y-4 p-8 pt-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">API Tools</h2>
        <p className="text-muted-foreground mt-1">
          API documentation and health monitoring (super-admin only)
        </p>
      </div>
      <PlatformApiToolsPanel />
    </div>
  )
}
