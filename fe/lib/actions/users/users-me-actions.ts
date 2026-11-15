"use server"

import { ApiResponse } from "@/lib/types/api-response-schema"
import {
  User,
  UserBasicInfo,
  UserEditForm
} from "@/lib/types/user-schema"
import { apiCaller } from "@/lib/utils/api-caller-helper"

// Get the signed-in user from /users/me (no ID needed - uses token)
export async function getCurrentUser(): Promise<ApiResponse<User>> {
  const response = await apiCaller.get<User>("/users/me", {
    requireAuth: true,
    cache: "no-store",
  })
  return response
}

// Update the signed-in user via /users/me
export async function updateCurrentUser(
  data: Partial<UserEditForm>
): Promise<ApiResponse<User>> {
  // SECURITY: Strip out roles and organizationId to prevent users from changing them
  // The backend should also enforce this, but we add client-side protection as well
  const { roles, organizationId, ...safeData } = data as any
  
  if (roles) {
    console.warn("Attempted to update roles through the current user endpoint. This is not allowed.")
  }
  
  if (organizationId) {
    console.warn("Attempted to update organizationId through the current user endpoint. This is not allowed.")
  }

  const response = await apiCaller.put<User>("/users/me", safeData, { requireAuth: true })
  return response
}

// Update current user basic info
export async function updateCurrentUserBasicInfo(
  data: Omit<UserBasicInfo, 'confirmPassword'>
): Promise<ApiResponse<User>> {
  // SECURITY: Ensure no roles or organizationId are included in basic info updates
  const { roles, organizationId, ...safeData } = data as any
  return updateCurrentUser(safeData)
}

// Change current user password
export async function changeCurrentUserPassword(
  currentPassword: string,
  newPassword: string
): Promise<ApiResponse<void>> {
  const response = await apiCaller.post<void>("/users/me/change-password", {
    currentPassword: currentPassword,
    newPassword: newPassword
  }, { requireAuth: true })
  return response
}

// Create first password for OAuth-only current user
export async function setCurrentUserPassword(
  newPassword: string
): Promise<ApiResponse<void>> {
  const response = await apiCaller.post<void>("/users/me/set-password", {
    newPassword
  }, { requireAuth: true })
  return response
}