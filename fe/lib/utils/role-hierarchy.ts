/**
 * Role hierarchy for platform / organization system roles.
 */

import type { RoleId } from "@/lib/types/role-schema"
import { effectiveRoleKeys } from "@/lib/utils/role-implications"

export const MANAGEMENT_ROLE_IDS: RoleId[] = ["org_owner", "org_admin", "super_admin"]

export function hasUserRole(roles: RoleId[]): boolean {
  return roles.includes("user")
}

export function hasManagementRoles(roles: RoleId[]): boolean {
  return effectiveRoleKeys(roles).some((role) =>
    MANAGEMENT_ROLE_IDS.includes(role as RoleId)
  )
}

export function getManagementRoles(roles: RoleId[]): RoleId[] {
  return effectiveRoleKeys(roles).filter((role) =>
    MANAGEMENT_ROLE_IDS.includes(role as RoleId)
  ) as RoleId[]
}

export function getManagementLandingPage(roles: RoleId[]): string {
  const managementRoles = getManagementRoles(roles)
  const targetRole = getHighestPriorityRole(managementRoles)
  return targetRole ? getRoleLandingPage(targetRole) : "/management-dashboard"
}

const ROLE_PRIORITY: Record<RoleId, number> = {
  super_admin: 4,
  org_owner: 3,
  org_admin: 2,
  user: 1,
}

export function getHighestPriorityRole(roles: RoleId[]): RoleId | null {
  if (!roles || roles.length === 0) {
    return null
  }

  let highestRole: RoleId | null = null
  let highestPriority = 0

  for (const role of roles) {
    const priority = ROLE_PRIORITY[role] || 0
    if (priority > highestPriority) {
      highestPriority = priority
      highestRole = role
    }
  }

  return highestRole || roles[0]
}

export function getRoleLandingPage(role: RoleId): string {
  switch (role) {
    case "user":
      return "/dashboard"
    case "org_owner":
    case "org_admin":
      return "/management-dashboard"
    case "super_admin":
      return "/platform-organizations"
    default:
      return "/dashboard"
  }
}

export function normalizeRole(role: string): RoleId {
  if (role === "super_admin") return "super_admin"
  if (role === "org_owner") return "org_owner"
  if (role === "org_admin") return "org_admin"
  if (role === "user") return "user"
  // Custom roles are not system RoleIds; treat as user for UI shell.
  return "user"
}
