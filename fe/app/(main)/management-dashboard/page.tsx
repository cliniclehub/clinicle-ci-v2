"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useRoles } from "@/lib/contexts/role-context"
import { Menu } from "lucide-react"

export default function ManagementDashboard() {
  const { hasManagementRoles, managementRoles } = useRoles()

  return (
    <div className="flex-1 space-y-4 p-8 pt-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Welcome</h2>
          <p className="text-muted-foreground mt-1">
            Select an action from the left menu bar to get started
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Menu className="h-5 w-5" />
            Getting Started
          </CardTitle>
          <CardDescription>
            Use the navigation menu on the left to access available features
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <p className="text-muted-foreground">
              You have access to management features based on your roles. Navigate using the sidebar menu.
            </p>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground">
              {hasManagementRoles && managementRoles.includes("org_admin") && (
                <li>Manage organization settings, users, email, notifications, and media</li>
              )}
              {hasManagementRoles && managementRoles.includes("super_admin") && (
                <li>Manage platform organizations, users, settings, media, and cron jobs</li>
              )}
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
