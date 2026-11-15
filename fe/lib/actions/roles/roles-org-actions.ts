"use server"

import { ApiResponse } from "@/lib/types/api-response-schema"
import { ORG_USERS_WRITE } from "@/lib/types/permission-schema"
import { apiCaller } from "@/lib/utils/api-caller-helper"

export interface PermissionDto {
  id: number
  key: string
  label: string
  description?: string | null
  scope: string
}

export interface RoleDto {
  id: number
  key: string
  label: string
  isSystem: boolean
  organizationId?: string | null
  permissions: string[]
  createdAt?: string
  updatedAt?: string
}

export async function listOrgPermissions(): Promise<ApiResponse<PermissionDto[]>> {
  return apiCaller.get<PermissionDto[]>("/roles/permissions", {
    requireAuth: true,
    requirePermission: ORG_USERS_WRITE,
  })
}

export async function listAssignableRoles(): Promise<ApiResponse<RoleDto[]>> {
  return apiCaller.get<RoleDto[]>("/roles/assignable", {
    requireAuth: true,
    requirePermission: ORG_USERS_WRITE,
  })
}

/** Roles page: system org roles (incl. org_owner) + custom roles. */
export async function listManagedRoles(): Promise<ApiResponse<RoleDto[]>> {
  return apiCaller.get<RoleDto[]>("/roles/manage", {
    requireAuth: true,
    requirePermission: ORG_USERS_WRITE,
  })
}

export async function createCustomRole(data: {
  label: string
  permissions: string[]
}): Promise<ApiResponse<RoleDto>> {
  return apiCaller.post<RoleDto>("/roles/custom", data, {
    requireAuth: true,
    requirePermission: ORG_USERS_WRITE,
  })
}

export async function updateCustomRole(
  roleId: number,
  data: { label?: string; permissions?: string[] }
): Promise<ApiResponse<RoleDto>> {
  return apiCaller.patch<RoleDto>(`/roles/custom/${roleId}`, data, {
    requireAuth: true,
    requirePermission: ORG_USERS_WRITE,
  })
}

export async function deleteCustomRole(roleId: number): Promise<ApiResponse<{ deleted: boolean }>> {
  return apiCaller.delete<{ deleted: boolean }>(`/roles/custom/${roleId}`, {
    requireAuth: true,
    requirePermission: ORG_USERS_WRITE,
  })
}
