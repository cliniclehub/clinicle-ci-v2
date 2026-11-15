/** Canonical permission keys (mirrors backend catalog). */

export const PLATFORM_ORGANIZATIONS_READ = "platform.organizations.read"
export const PLATFORM_ORGANIZATIONS_WRITE = "platform.organizations.write"
export const PLATFORM_USERS_READ = "platform.users.read"
export const PLATFORM_USERS_WRITE = "platform.users.write"
export const PLATFORM_SETTINGS_MANAGE = "platform.settings.manage"

export const ORG_USERS_READ = "org.users.read"
export const ORG_USERS_WRITE = "org.users.write"
export const ORG_SETTINGS_MANAGE = "org.settings.manage"
export const ORG_CONFIGURATIONS_MANAGE = "org.configurations.manage"
export const ORG_MEDIA_MANAGE = "org.media.manage"
export const ORG_EMAIL_MANAGE = "org.email.manage"
export const ORG_NOTIFICATIONS_MANAGE = "org.notifications.manage"

export const ORG_PERMISSION_CATALOG = [
  {
    key: ORG_USERS_READ,
    label: "View organization users",
  },
  {
    key: ORG_USERS_WRITE,
    label: "Manage organization users",
  },
  {
    key: ORG_SETTINGS_MANAGE,
    label: "Manage site settings",
  },
  {
    key: ORG_CONFIGURATIONS_MANAGE,
    label: "Manage configurations",
  },
  {
    key: ORG_MEDIA_MANAGE,
    label: "Manage media",
  },
  {
    key: ORG_EMAIL_MANAGE,
    label: "Manage email",
  },
  {
    key: ORG_NOTIFICATIONS_MANAGE,
    label: "Manage notifications",
  },
] as const

/** Enrich permission DTOs for the Role Builder catalog UI. */
export function toPermissionCatalogItem(permission: {
  key: string
  label: string
  description?: string | null
  scope?: string
}) {
  const parts = permission.key.split(".")
  const domain = permission.scope || parts[0] || "org"
  const resource = parts[1] || "general"
  const action = parts[2] || "manage"
  const riskLevel =
    permission.key.endsWith(".write") || permission.key.endsWith(".manage")
      ? permission.key.includes("users") || permission.key.includes("organizations")
        ? "high"
        : "elevated"
      : "normal"
  return {
    key: permission.key,
    label: permission.label,
    description: permission.description ?? null,
    domain,
    resource,
    action,
    riskLevel: riskLevel as "normal" | "elevated" | "high",
  }
}

export type PermissionKey = (typeof ORG_PERMISSION_CATALOG)[number]["key"] | string

export function hasPermission(
  permissions: readonly string[] | undefined | null,
  key: string
): boolean {
  return Boolean(permissions?.includes(key))
}

export function hasAnyPermission(
  permissions: readonly string[] | undefined | null,
  keys: readonly string[]
): boolean {
  return keys.some((key) => hasPermission(permissions, key))
}

/** Prefer permission-based landing when available. */
export function getPermissionLandingPage(permissions: readonly string[]): string {
  if (hasPermission(permissions, PLATFORM_ORGANIZATIONS_READ)) {
    return "/platform-organizations"
  }
  if (hasPermission(permissions, PLATFORM_USERS_READ)) {
    return "/platform-users"
  }
  if (hasPermission(permissions, ORG_USERS_READ)) {
    return "/organization-users"
  }
  if (hasPermission(permissions, ORG_SETTINGS_MANAGE)) {
    return "/organization-settings"
  }
  if (hasPermission(permissions, ORG_EMAIL_MANAGE)) {
    return "/organization-email-manager"
  }
  if (hasAnyPermission(permissions, [
    ORG_MEDIA_MANAGE,
    ORG_CONFIGURATIONS_MANAGE,
    ORG_NOTIFICATIONS_MANAGE,
  ])) {
    return "/dashboard-org-admin"
  }
  return "/dashboard"
}
