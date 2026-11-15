"use server"

import { ApiResponse } from "@/lib/types/api-response-schema"
import {
  EffectiveNotificationSettings,
  NotificationDeliveryList,
  NotificationListQuery,
  NotificationPreferences,
  NotificationRuleDefinition,
  NotificationScheduleList,
  NotificationSettings,
} from "@/lib/types/notification-schema"
import { ORG_NOTIFICATIONS_MANAGE } from "@/lib/types/permission-schema"
import { apiCaller } from "@/lib/utils/api-caller-helper"

export async function listNotificationRules(): Promise<ApiResponse<NotificationRuleDefinition[]>> {
  return apiCaller.get<NotificationRuleDefinition[]>("/notifications/rules", {
    requireAuth: true,
  })
}

export async function getOrgNotificationSettings(): Promise<ApiResponse<NotificationSettings>> {
  return apiCaller.get<NotificationSettings>("/notifications/org-settings", {
    requireAuth: true,
    requirePermission: ORG_NOTIFICATIONS_MANAGE,
  })
}

export async function updateOrgNotificationSettings(
  settings: NotificationSettings
): Promise<ApiResponse<NotificationSettings>> {
  return apiCaller.patch<NotificationSettings>("/notifications/org-settings", settings, {
    requireAuth: true,
    requirePermission: ORG_NOTIFICATIONS_MANAGE,
  })
}

export async function getEffectiveNotificationSettings(): Promise<ApiResponse<EffectiveNotificationSettings>> {
  return apiCaller.get<EffectiveNotificationSettings>("/notifications/effective-settings", {
    requireAuth: true,
    requirePermission: ORG_NOTIFICATIONS_MANAGE,
  })
}

export async function getMyNotificationPreferences(): Promise<ApiResponse<NotificationPreferences>> {
  return apiCaller.get<NotificationPreferences>("/notifications/preferences/me", {
    requireAuth: true,
  })
}

export async function updateMyNotificationPreferences(
  preferences: NotificationPreferences
): Promise<ApiResponse<NotificationPreferences>> {
  return apiCaller.patch<NotificationPreferences>("/notifications/preferences/me", preferences, {
    requireAuth: true,
  })
}

export async function listNotificationSchedules(
  query: NotificationListQuery = {}
): Promise<ApiResponse<NotificationScheduleList>> {
  const endpoint = apiCaller.createEndpoint("/notifications/schedules", query)
  return apiCaller.get<NotificationScheduleList>(endpoint, {
    requireAuth: true,
    requirePermission: ORG_NOTIFICATIONS_MANAGE,
  })
}

export async function listNotificationDeliveries(
  query: NotificationListQuery = {}
): Promise<ApiResponse<NotificationDeliveryList>> {
  const endpoint = apiCaller.createEndpoint("/notifications/deliveries", query)
  return apiCaller.get<NotificationDeliveryList>(endpoint, {
    requireAuth: true,
    requirePermission: ORG_NOTIFICATIONS_MANAGE,
  })
}
