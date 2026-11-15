/** Stored `org_owner` satisfies `org_admin` capability checks. */

export const ORG_OWNER_ROLE = "org_owner"
export const ORG_ADMIN_ROLE = "org_admin"

export function effectiveRoleKeys(storedRoles: readonly string[] | undefined | null): string[] {
  const roles = Array.from(new Set(storedRoles ?? []))
  if (roles.includes(ORG_OWNER_ROLE) && !roles.includes(ORG_ADMIN_ROLE)) {
    roles.push(ORG_ADMIN_ROLE)
  }
  return roles
}

export function hasEffectiveRole(
  storedRoles: readonly string[] | undefined | null,
  roleKey: string
): boolean {
  return effectiveRoleKeys(storedRoles).includes(roleKey)
}
