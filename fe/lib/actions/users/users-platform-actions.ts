"use server"

import { PLATFORM_USERS_READ, PLATFORM_USERS_WRITE } from "@/lib/types/permission-schema"
import { ApiResponse } from "@/lib/types/api-response-schema"
import { FilterState, encodeFilters } from "@/lib/types/filter-schema"
import {
    User,
    UserBasicInfo,
    UserCreateForm,
    UserEditForm,
    UserRole
} from "@/lib/types/user-schema"
import { apiCaller } from "@/lib/utils/api-caller-helper"

// List users with pagination and filters (Platform-level - Super Admin only)
export async function listUsers(params: {
  page?: number
  pageSize?: number
  search?: string
  organizationId?: string
  role?: string
  isLocked?: boolean
  sortBy?: string
  sortOrder?: "asc" | "desc"
  filters?: FilterState
}): Promise<ApiResponse<User[]>> {
    const queryParams = new URLSearchParams()
    if (params.page) queryParams.append("page", params.page.toString())
    if (params.pageSize) queryParams.append("page_size", params.pageSize.toString())
    if (params.search) queryParams.append("search", params.search)
    if (params.organizationId) queryParams.append("organizationId", params.organizationId)
    if (params.role) queryParams.append("role", params.role)
    if (params.isLocked !== undefined) queryParams.append("isLocked", params.isLocked.toString())
    if (params.sortBy) queryParams.append("sort_by", params.sortBy)
    if (params.sortOrder) queryParams.append("sort_order", params.sortOrder)
    if (params.filters && params.filters.groups.length > 0) {
        queryParams.append("filters", encodeFilters(params.filters))
    }

    const response = await apiCaller.get<User[]>(
      `/users/platform?${queryParams.toString()}`,
      { requireAuth: true, requirePermission: PLATFORM_USERS_WRITE }
    )
    return response
}

// Get single user (Platform-level - Super Admin only)
export async function getUser(id: string): Promise<ApiResponse<User>> {
    const response = await apiCaller.get<User>(`/users/platform/${id}`, {
        requireAuth: true,
        requirePermission: PLATFORM_USERS_READ,
        cache: "no-store",
    })
    return response
}

// Create user (Platform-level - Super Admin only)
export async function createUser(data: UserCreateForm): Promise<ApiResponse<User>> {
    const { roleKeys, confirmPassword: _confirmPassword, ...rest } = data
    const response = await apiCaller.post<User>(
      "/users/platform",
      {
        ...rest,
        roles: roleKeys?.length ? roleKeys : ["user"],
      },
      { requireAuth: true, requirePermission: PLATFORM_USERS_READ }
    )
    return response
}

// Create org owner user (Platform-level - Super Admin only)
// This creates a user with org_owner role. Org owners assign org_admin accounts.
// sendVerificationEmail: if false, skips email verification and marks email as verified
export async function createOrgOwnerUser(data: {
  organizationId: string
  email: string
  firstName: string
  lastName: string
  password: string
  sendVerificationEmail: boolean
}): Promise<ApiResponse<User>> {
  const response = await apiCaller.post<User>(
    "/users/platform",
    {
      email: data.email,
      firstName: data.firstName,
      lastName: data.lastName,
      password: data.password,
      organizationId: data.organizationId,
      roles: ["org_owner"],
      skipEmailVerification: !data.sendVerificationEmail,
    },
    { requireAuth: true, requirePermission: PLATFORM_USERS_WRITE }
  )
  return response
}

/** @deprecated Prefer createOrgOwnerUser */
export const createOrgAdminUser = createOrgOwnerUser

// Update user (Platform-level - Super Admin only)
export async function updateUser(
  id: string,
  data: Partial<UserEditForm> & { confirmPassword?: string }
): Promise<ApiResponse<User>> {
  const response = await apiCaller.put<User>(`/users/platform/${id}`, data, { requireAuth: true, requirePermission: PLATFORM_USERS_WRITE })
  return response
}

// Section-specific update functions
export async function updateUserBasicInfo(
  id: string,
  data: Omit<UserBasicInfo, 'confirmPassword'>
): Promise<ApiResponse<User>> {
  return updateUser(id, data)
}

export async function updateUserRole(
  id: string,
  data: UserRole
): Promise<ApiResponse<User>> {
  return updateUser(id, data)
}

// Delete user (Platform-level - Super Admin only)
export async function deleteUser(id: string): Promise<ApiResponse<void>> {
  const response = await apiCaller.delete<void>(`/users/platform/${id}`, { requireAuth: true, requirePermission: PLATFORM_USERS_WRITE })
  return response
}

// Lock/unlock user (Platform-level - Super Admin only)
export async function toggleUserLock(
  id: string,
  locked: boolean
): Promise<ApiResponse<User>> {
    const response = await apiCaller.patch<User>(`/users/platform/${id}/lock`, { locked }, { requireAuth: true, requirePermission: PLATFORM_USERS_WRITE })
  return response
}

// Reset user password (Platform-level - Super Admin only)
export async function resetUserPassword(
  id: string,
  newPassword: string
): Promise<ApiResponse<void>> {
  const response = await apiCaller.post<void>(`/users/platform/${id}/reset-password`, { password: newPassword }, { requireAuth: true, requirePermission: PLATFORM_USERS_WRITE })
  return response
}

// Get available roles
export async function getAvailableRoles(): Promise<ApiResponse<string[]>> {
  const response = await apiCaller.get<string[]>("/roles/", { requireAuth: true, requirePermission: PLATFORM_USERS_READ })
  return response
}

// Update user roles (Platform-level - Super Admin only)
export async function updateUserRoles(
  id: string,
  roleKeys: string[]
): Promise<ApiResponse<User>> {
  // Use the existing updateUser endpoint with only roles data
  const response = await apiCaller.put<User>(`/users/platform/${id}`, { roles: roleKeys }, { requireAuth: true, requirePermission: PLATFORM_USERS_READ })
  return response
}

// Admin change user password (Platform-level - Super Admin only)
export async function changeUserPassword(
  userId: string,
  newPassword: string
): Promise<ApiResponse<void>> {
  const response = await apiCaller.post<void>(`/users/platform/${userId}/change-password`, {
    newPassword: newPassword
  }, { requireAuth: true, requirePermission: PLATFORM_USERS_READ })
  return response
}

