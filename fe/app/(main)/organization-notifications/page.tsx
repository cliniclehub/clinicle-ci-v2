"use client"

import { NotificationActivityPanel } from "@/components/notifications/notification-activity-panel"

export default function OrganizationNotificationsPage() {
  return (
    <div className="flex-1 space-y-4 p-8 pt-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Notifications</h2>
        <p className="text-muted-foreground mt-1">
          Review scheduled reminders and delivery outcomes for your organization.
        </p>
      </div>
      <NotificationActivityPanel />
    </div>
  )
}
