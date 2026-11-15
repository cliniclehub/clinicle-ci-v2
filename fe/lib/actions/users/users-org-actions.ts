"use server"

import { ORG_USERS_READ, ORG_USERS_WRITE } from "@/lib/types/permission-schema"
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

// List users with pagination and filters (Org-level - Org Admin only)
export async function listUsers(params: {
  page?: number
  pageSize?: number
  search?: string
  role?: string
  isLocked?: boolean
  sortBy?: string
  sortOrder?: "asc" | "desc"
  filters?: FilterState
}): Promise<ApiResponse<User[]>> {
    const queryParams = new URLSearchParams()
    if (params.page) queryParams.append("page", params.page.toString())
    if (params.pageSize) queryParams.append("pageSize", params.pageSize.toString())
    if (params.search) queryParams.append("search", params.search)
    if (params.role) queryParams.append("role", params.role)
    if (params.isLocked !== undefined) queryParams.append("isLocked", params.isLocked.toString())
    if (params.sortBy) queryParams.append("sortBy", params.sortBy)
    if (params.sortOrder) queryParams.append("sortOrder", params.sortOrder)
    if (params.filters && params.filters.groups.length > 0) {
        queryParams.append("filters", encodeFilters(params.filters))
    }

    const response = await apiCaller.get<User[]>(
      `/users/org?${queryParams.toString()}`,
      {
        requireAuth: true,
        requirePermission: ORG_USERS_READ,
        logRequest: false,
        logResponse: false,
      }
    )
    return response
}

// Get single user (Org-level - Org Admin only)
export async function getUser(id: string): Promise<ApiResponse<User>> {
    const response = await apiCaller.get<User>(`/users/org/${id}`, {
        requireAuth: true,
        requirePermission: ORG_USERS_READ,
        cache: "no-store",
    })
    return response
}

// Create user (Org-level - Org Admin only)
export async function createUser(data: UserCreateForm): Promise<ApiResponse<User>> {
    const { roleKeys, confirmPassword: _confirmPassword, ...rest } = data
    const response = await apiCaller.post<User>(
      "/users/org",
      {
        ...rest,
        roles: roleKeys?.length ? roleKeys : ["user"],
      },
      { requireAuth: true, requirePermission: ORG_USERS_WRITE }
    )
    return response
}

// Update user (Org-level - Org Admin only)
export async function updateUser(
  id: string,
  data: Partial<UserEditForm> & { confirmPassword?: string }
): Promise<ApiResponse<User>> {
  const response = await apiCaller.put<User>(`/users/org/${id}`, data, { requireAuth: true, requirePermission: ORG_USERS_WRITE })
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

// Delete user (Org-level - Org Admin only)
export async function deleteUser(id: string): Promise<ApiResponse<void>> {
  const response = await apiCaller.delete<void>(`/users/org/${id}`, { requireAuth: true, requirePermission: ORG_USERS_WRITE })
  return response
}

// Bulk create users (Org-level - Org Admin only)
export interface BulkUserCreateItem {
  email: string
  firstName: string
  lastName: string
  password: string
  phoneNumber?: string
  /** When present, replaces org roles for the row (comma-separated source). Omit when Roles column is not mapped. */
  roles?: string[]
}

export interface BulkUserCreateRequest {
  users: BulkUserCreateItem[]
}

export interface BulkUserCreateResult {
  userId: string | null
  email: string
  success: boolean
  error: string | null
  status: string | null
}

export interface BulkUserCreateResponse {
  successCount: number
  errorCount: number
  results: BulkUserCreateResult[]
}

export async function bulkCreateUsers(data: BulkUserCreateRequest): Promise<ApiResponse<BulkUserCreateResponse>> {
  const response = await apiCaller.post<BulkUserCreateResponse>(
    "/users/org/bulk",
    {
      users: data.users.map(u => {
        const row: Record<string, unknown> = {
          email: u.email,
          first_name: u.firstName,
          last_name: u.lastName,
          password: u.password,
        }
        if (u.phoneNumber != null && String(u.phoneNumber).trim() !== "") {
          row.phone_number = String(u.phoneNumber).trim()
        }
        if (u.roles !== undefined) {
          row.roles = u.roles
        }
        return row
      }),
    },
    { requireAuth: true, requirePermission: ORG_USERS_WRITE }
  )
  return response
}

// Lock/unlock user (Org-level - Org Admin only)
export async function toggleUserLock(
  id: string,
  locked: boolean
): Promise<ApiResponse<User>> {
    const response = await apiCaller.patch<User>(`/users/org/${id}/lock`, { locked }, { requireAuth: true, requirePermission: ORG_USERS_WRITE })
  return response
}

// Reset user password (Org-level - Org Admin only)
export async function resetUserPassword(
  id: string,
  newPassword: string
): Promise<ApiResponse<void>> {
  const response = await apiCaller.post<void>(`/users/org/${id}/reset-password`, { password: newPassword }, { requireAuth: true, requirePermission: ORG_USERS_WRITE })
  return response
}

// Get available roles
export async function getAvailableRoles(): Promise<ApiResponse<string[]>> {
  const response = await apiCaller.get<string[]>("/roles/", { requireAuth: true, requirePermission: ORG_USERS_WRITE })
  return response
}

// Update user roles (Org-level - Org Admin only)
export async function updateUserRoles(
  id: string,
  roleKeys: string[]
): Promise<ApiResponse<User>> {
  // Use the existing updateUser endpoint with only roles data
  const response = await apiCaller.put<User>(`/users/org/${id}`, { roles: roleKeys }, { requireAuth: true, requirePermission: ORG_USERS_WRITE })
  return response
}

// Admin change user password (Org-level - Org Admin only)
export async function changeUserPassword(
  userId: string,
  newPassword: string
): Promise<ApiResponse<void>> {
  const response = await apiCaller.post<void>(`/users/org/${userId}/change-password`, {
    newPassword: newPassword
  }, { requireAuth: true, requirePermission: ORG_USERS_WRITE })
  return response
}

// Get user statistics (Org-level - Org Admin only)
export async function getUserStatistics(): Promise<ApiResponse<{
  totalUsers: number
  activeUsers: number
  lockedUsers: number
}>> {
  const response = await apiCaller.get<{
    totalUsers: number
    activeUsers: number
    lockedUsers: number
  }>("/users/statistics", { 
    requireAuth: true, 
    requirePermission: ORG_USERS_READ
  })
  return response
}
