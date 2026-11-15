"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"

import { NotificationSettingsEditor } from "@/components/notifications/notification-settings-editor"
import {
  getOrgNotificationSettings,
  listNotificationRules,
  updateOrgNotificationSettings,
} from "@/lib/actions/notifications/notification-actions"
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  NotificationRuleDefinition,
  NotificationSettings,
} from "@/lib/types/notification-schema"
import { Organization } from "@/lib/types/organization-schema"
import { handleApiErrorResponse } from "@/lib/utils/api-error-handler"
import { createClientLogger } from "@/lib/utils/logger-client"

const logger = createClientLogger("NotificationSettingsSection")

interface NotificationSettingsSectionProps {
  organization?: Organization
  onDirtyChange?: (isDirty: boolean) => void
  onCancel?: () => void
}

export function NotificationSettingsSection({
  organization,
  onDirtyChange,
  onCancel,
}: NotificationSettingsSectionProps) {
  const [rules, setRules] = useState<NotificationRuleDefinition[]>([])
  const [settings, setSettings] = useState<NotificationSettings>(DEFAULT_NOTIFICATION_SETTINGS)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true
    const load = async () => {
      if (!organization?.id) {
        setLoading(false)
        return
      }
      try {
        const [rulesResponse, settingsResponse] = await Promise.all([
          listNotificationRules(),
          getOrgNotificationSettings(),
        ])
        if (!mounted) return
        if (handleApiErrorResponse(rulesResponse, "Failed to load notification rules")) return
        if (handleApiErrorResponse(settingsResponse, "Failed to load notification settings")) return
        if (rulesResponse.status !== "success" || settingsResponse.status !== "success") return
        setRules(rulesResponse.data || [])
        setSettings(settingsResponse.data || DEFAULT_NOTIFICATION_SETTINGS)
      } catch (error) {
        logger.error("Failed to load notification settings", error as Error)
        toast.error("Failed to load notification settings")
      } finally {
        if (mounted) setLoading(false)
      }
    }
    void load()
    return () => {
      mounted = false
    }
  }, [organization?.id])

  const handleSave = async (nextSettings: NotificationSettings) => {
    const response = await updateOrgNotificationSettings(nextSettings)
    if (handleApiErrorResponse(response, "Failed to save notification settings")) {
      throw new Error(response.message)
    }
    if (response.status !== "success") return
    setSettings(response.data || nextSettings)
  }

  if (!organization?.id) {
    return (
      <div className="rounded-md border p-6 text-sm text-muted-foreground">
        Notification settings will be available after creating the organization.
      </div>
    )
  }

  if (loading) {
    return <div className="rounded-md border p-6 text-sm text-muted-foreground">Loading...</div>
  }

  return (
    <NotificationSettingsEditor
      variant="section"
      title="Notifications"
      description="Business notification rules will appear here as product features are added. Transactional emails such as user welcome are managed in Email Manager."
      rules={rules}
      settings={settings}
      onSave={handleSave}
      onDirtyChange={onDirtyChange}
      onCancel={onCancel}
    />
  )
}
