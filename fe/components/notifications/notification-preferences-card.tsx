"use client"

import { Bell } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

/**
 * Placeholder until product features register user-facing notification preferences.
 * Product features can add user-facing notification preferences over time.
 */
export function NotificationPreferencesCard() {
  return (
    <Card>
      <CardHeader className="space-y-2">
        <CardTitle className="flex items-center gap-2">
          <Bell className="h-5 w-5" />
          Notifications
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Business notification preferences will appear here as product features are added.
          Transactional emails such as welcome and password reset are managed by your
          organization.
        </p>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border px-4 py-8 text-sm text-muted-foreground">
          No notification preferences yet.
        </div>
      </CardContent>
    </Card>
  )
}
