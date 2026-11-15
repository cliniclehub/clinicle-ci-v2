/* ---- */
/* Role Types and Constants                                              */
/* ---- */

export type RoleId = "super_admin" | "org_owner" | "org_admin" | "user"

export type RoleLabel =
  | "Super Admin"
  | "Organization Owner"
  | "Organization Admin"
  | "User"

export interface Role {
  id: RoleId
  label: RoleLabel
  description?: string
}

export const ROLES: Record<RoleId, Role> = {
  super_admin: {
    id: "super_admin",
    label: "Super Admin",
    description: "Full platform access and management across all organizations",
  },
  org_owner: {
    id: "org_owner",
    label: "Organization Owner",
    description:
      "Full organization management plus assigning organization admins. Only a platform super admin can grant this role.",
  },
  org_admin: {
    id: "org_admin",
    label: "Organization Admin",
    description:
      "Organization management: settings, users, email, notifications, and media. Cannot assign Organization Admins or manage Organization Owner accounts.",
  },
  user: {
    id: "user",
    label: "User",
    description: "Organization user with access to the dashboard and personal settings",
  },
}

export const ROLE_IDS: RoleId[] = Object.keys(ROLES) as RoleId[]

export const ROLE_LABELS: RoleLabel[] = Object.values(ROLES).map((role) => role.label)

export const getRoleById = (id: RoleId): Role => ROLES[id]

export const getRoleByLabel = (label: RoleLabel): Role => {
  return Object.values(ROLES).find((role) => role.label === label)!
}

export const getRoleLabel = (id: RoleId): RoleLabel => ROLES[id].label

export const getRoleId = (label: RoleLabel): RoleId => {
  return Object.values(ROLES).find((role) => role.label === label)!.id
}

export const isValidRoleId = (id: string): id is RoleId => {
  return id in ROLES
}

export const isValidRoleLabel = (label: string): label is RoleLabel => {
  return ROLE_LABELS.includes(label as RoleLabel)
}

export const ROLE_HIERARCHY: Record<RoleId, RoleId[]> = {
  super_admin: ["super_admin", "org_owner", "org_admin", "user"],
  org_owner: ["org_admin", "user"],
  org_admin: ["user"],
  user: ["user"],
}

export function canManageUserRoles(roles: RoleId[]): boolean {
  return (
    roles.includes("org_owner") ||
    roles.includes("org_admin") ||
    roles.includes("super_admin")
  )
}

/** Org Owner accounts are platform-managed; org staff cannot mutate them. */
export function isOrgOwnerAccount(roles: string[] | undefined | null): boolean {
  return Boolean(roles?.includes("org_owner"))
}

/**
 * Whether the viewer may mutate an org-scoped user account (edit / password / delete).
 * Org Owner targets are never mutable from organization-user pages.
 */
export function canManageOrgUserAccount(
  viewerRoles: string[],
  targetRoles: string[] | undefined | null
): boolean {
  if (isOrgOwnerAccount(targetRoles)) return false
  return canManageUserRoles(viewerRoles as RoleId[])
}

/**
 * Whether the viewer may change role assignments for a target user on org routes.
 * Only org owners (and platform) may assign or edit org_admin.
 */
export function canEditOrgUserRoles(
  viewerRoles: string[],
  targetRoles: string[] | undefined | null
): boolean {
  if (isOrgOwnerAccount(targetRoles)) return false
  if (viewerRoles.includes("super_admin") || viewerRoles.includes("org_owner")) {
    return true
  }
  if (!viewerRoles.includes("org_admin")) return false
  // Org admins may only assign/edit non-admin roles.
  return !Boolean(targetRoles?.includes("org_admin"))
}

export const canManageRole = (managerRole: RoleId, targetRole: RoleId): boolean => {
  return ROLE_HIERARCHY[managerRole]?.includes(targetRole) || false
}

export const getManageableRoles = (role: RoleId): RoleId[] => {
  return ROLE_HIERARCHY[role] || []
}

export type UserRole = "SuperUser" | "OrgOwner" | "OrgAdmin" | "User"

export const mapLegacyRoleToNew = (legacyRole: UserRole): RoleId => {
  const mapping: Record<UserRole, RoleId> = {
    SuperUser: "super_admin",
    OrgOwner: "org_owner",
    OrgAdmin: "org_admin",
    User: "user",
  }
  return mapping[legacyRole]
}

export const mapNewRoleToLegacy = (newRole: RoleId): UserRole => {
  const mapping: Record<RoleId, UserRole> = {
    super_admin: "SuperUser",
    org_owner: "OrgOwner",
    org_admin: "OrgAdmin",
    user: "User",
  }
  return mapping[newRole]
}
