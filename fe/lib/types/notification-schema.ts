import { z } from "zod"

export const notificationOffsetMinutesSchema = z
  .number({ invalid_type_error: "Enter minutes as a number." })
  .int("Use a whole number of minutes.")
  .min(0, "Minutes must be 0 or greater.")

export const notificationOffsetInputSchema = z
  .string()
  .trim()
  .transform((value) => value.split(",")[0]?.trim() ?? "")
  .pipe(
    z.union([
      z.literal(""),
      z.coerce
        .number({ invalid_type_error: "Enter minutes as a number." })
        .pipe(notificationOffsetMinutesSchema),
    ])
  )

export const notificationOffsetRequiredInputSchema = z
  .string()
  .trim()
  .min(1, "Minutes before is required.")
  .transform((value) => value.split(",")[0]?.trim() ?? "")
  .pipe(
    z.coerce
      .number({ invalid_type_error: "Enter minutes as a number." })
      .pipe(notificationOffsetMinutesSchema)
  )

export interface NotificationRuleConfig {
  enabled?: boolean
  channels?: string[]
  offsetsMinutes?: number[]
}

export interface NotificationSettings {
  enabled: boolean
  inheritOrgDefaults: boolean
  rules: Record<string, NotificationRuleConfig>
}

export interface NotificationPreferences {
  emailEnabled: boolean
}

export interface NotificationRuleDefinition {
  ruleKey: string
  displayName: string
  description?: string | null
  category: string
  defaultChannels: string[]
  defaultOffsetsMinutes: number[]
  recipientRole: string
  isTimeBased: boolean
  templateKey: string
  isActive: boolean
}

export interface EffectiveNotificationRule {
  ruleKey: string
  enabled: boolean
  channels: string[]
  offsetsMinutes: number[]
  inheritedFrom: string
}

export interface EffectiveNotificationSettings {
  organizationId: string
  enabled: boolean
  rules: EffectiveNotificationRule[]
}

export interface NotificationSchedule {
  id: number
  organizationId: string
  userId?: string | null
  ruleKey: string
  ruleDisplayName?: string | null
  fireAt: string
  eventAt: string
  sourceType: string
  sourceId: string
  status: string
  scheduleMetadata: Record<string, unknown>
  dispatchedAt?: string | null
  createdAt?: string | null
}

export interface NotificationDelivery {
  id: number
  organizationId: string
  userId: string
  userName?: string | null
  userEmail?: string | null
  ruleKey: string
  ruleDisplayName?: string | null
  channel: string
  sourceType: string
  sourceId: string
  scheduleId?: number | null
  fireAt: string
  deliveredAt?: string | null
  status: string
  errorMessage?: string | null
  deliveryMetadata: Record<string, unknown>
  createdAt?: string | null
}

export interface NotificationListQuery {
  status?: string
  excludeStatuses?: string
  ruleKey?: string
  scheduleId?: string
  userId?: string
  page?: number
  pageSize?: number
}

export interface NotificationScheduleList {
  items: NotificationSchedule[]
  total: number
  page: number
  pageSize: number
}

export interface NotificationDeliveryList {
  items: NotificationDelivery[]
  total: number
  page: number
  pageSize: number
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: true,
  inheritOrgDefaults: true,
  rules: {},
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  emailEnabled: true,
}
