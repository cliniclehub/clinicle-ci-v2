/** Shared middleware route ACL prefixes and helpers (used by middleware + tests). */

import {
  ORG_CONFIGURATIONS_MANAGE,
  ORG_EMAIL_MANAGE,
  ORG_MEDIA_MANAGE,
  ORG_NOTIFICATIONS_MANAGE,
  ORG_SETTINGS_MANAGE,
  ORG_USERS_READ,
  ORG_USERS_WRITE,
  PLATFORM_ORGANIZATIONS_READ,
  PLATFORM_SETTINGS_MANAGE,
  PLATFORM_USERS_READ,
  hasAnyPermission,
} from "@/lib/types/permission-schema"
import { effectiveRoleKeys } from "@/lib/utils/role-implications"

export const PUBLIC_ROUTE_PREFIXES = [
  "/login",
  "/register",
  "/verify-email",
  "/forgot-password",
  "/reset-password",
  "/privacy-policy",
  "/terms-of-use",
  "/site-landing",
  "/unauthorized",
  "/contact",
] as const

export const PROTECTED_ROUTE_PREFIXES = [
  "/dashboard",
  "/dashboard-org-admin",
  "/dashboard-super-admin",

  "/organization-users",
  "/organization-settings",
  "/organization-email-manager",
  "/organization-media-manager",
  "/organization-notifications",
  "/organization-roles",
  "/management-dashboard",

  "/chat",
  "/task-board",
  "/teams",
  "/org-graph",
  "/meetings",
  "/scheduled",
  "/review-queue",
  "/pending-edits",
  "/worktrees",
  "/agents",
  "/workflows",
  "/knowledge-base",
  "/memory",
  "/alerts",
  "/analytics",
  "/system",
  "/logs",

  "/platform-organizations",
  "/platform-users",
  "/platform-settings",
  "/platform-media-manager",
  "/platform-cron-jobs",
  "/platform-api-tools",

  "/profile",
  "/verify-phone",
  "/settings",
  "/notifications",
  "/notfications",
  "/chat-with-us",
  "/help",
  "/admin",
] as const

/** True when pathname is exactly prefix or a nested path under it (not a sibling like /chat-with-us). */
export function pathMatchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

export function isPublicMiddlewareRoute(pathname: string): boolean {
  return PUBLIC_ROUTE_PREFIXES.some((prefix) => pathMatchesPrefix(pathname, prefix))
}

export function isProtectedMiddlewareRoute(pathname: string): boolean {
  return PROTECTED_ROUTE_PREFIXES.some((prefix) => pathMatchesPrefix(pathname, prefix))
}

export function middlewareRequiresAuth(pathname: string): boolean {
  return isProtectedMiddlewareRoute(pathname) && !isPublicMiddlewareRoute(pathname)
}

/** Convert `app/(main)/.../page.tsx` to a URL pathname (route groups omitted). */
export function pageFilePathToRoutePath(pageFilePath: string): string {
  const withoutAppRoot = pageFilePath
    .replace(/^app\/\(main\)\//, "")
    .replace(/\/page\.tsx$/, "")
  const segments = withoutAppRoot.split("/").filter((segment) => {
    return !(segment.startsWith("(") && segment.endsWith(")"))
  })
  const normalized = `/${segments.join("/")}`.replace(/\/+/g, "/")
  return normalized === "/" ? "/" : normalized.replace(/\/$/, "") || "/"
}

/** Shared org-admin console surface (existing admin + Clinicle Intelligence placeholders). */
const ORG_ADMIN_SURFACE_PERMISSIONS = [
  ORG_USERS_READ,
  ORG_SETTINGS_MANAGE,
  ORG_CONFIGURATIONS_MANAGE,
  ORG_MEDIA_MANAGE,
  ORG_EMAIL_MANAGE,
  ORG_NOTIFICATIONS_MANAGE,
] as const

/** Clinicle Intelligence UI placeholders — not covered by platform ST UI harness. */
export const INTELLIGENCE_PLACEHOLDER_PREFIXES = [
  "/chat",
  "/task-board",
  "/teams",
  "/org-graph",
  "/meetings",
  "/scheduled",
  "/review-queue",
  "/pending-edits",
  "/worktrees",
  "/agents",
  "/workflows",
  "/knowledge-base",
  "/memory",
  "/alerts",
  "/analytics",
  "/system",
  "/logs",
] as const

/** Permission-first route gates (any listed permission grants access). */
export const MIDDLEWARE_PERMISSION_PREFIX_RULES: Record<string, readonly string[]> = {
  "/platform-organizations": [PLATFORM_ORGANIZATIONS_READ],
  "/platform-users": [PLATFORM_USERS_READ],
  "/platform-settings": [PLATFORM_SETTINGS_MANAGE],
  "/platform-media-manager": [PLATFORM_SETTINGS_MANAGE],
  "/platform-cron-jobs": [PLATFORM_SETTINGS_MANAGE],
  "/platform-api-tools": [PLATFORM_SETTINGS_MANAGE],
  "/dashboard-super-admin": [PLATFORM_ORGANIZATIONS_READ, PLATFORM_USERS_READ, PLATFORM_SETTINGS_MANAGE],

  "/organization-users": [ORG_USERS_READ],
  "/organization-settings": [ORG_SETTINGS_MANAGE, ORG_CONFIGURATIONS_MANAGE],
  "/organization-media-manager": [ORG_MEDIA_MANAGE],
  "/organization-email-manager": [ORG_EMAIL_MANAGE],
  "/organization-notifications": [ORG_NOTIFICATIONS_MANAGE],
  "/organization-roles": [ORG_USERS_WRITE],
  "/management-dashboard": ORG_ADMIN_SURFACE_PERMISSIONS,
  "/dashboard-org-admin": ORG_ADMIN_SURFACE_PERMISSIONS,
  ...Object.fromEntries(
    INTELLIGENCE_PLACEHOLDER_PREFIXES.map((prefix) => [prefix, ORG_ADMIN_SURFACE_PERMISSIONS])
  ),
}

/** Legacy role allowlists. Prefer permission rules; shared pages are auth-only. */
export const MIDDLEWARE_ROLE_PATTERN_RULES: ReadonlyArray<{
  pattern: RegExp
  roles: readonly string[]
}> = []

/**
 * Shared authenticated pages must not require system role keys (`user` /
 * `org_admin` / `super_admin`). Org custom roles use keys like `c_<hex>` and
 * would otherwise be redirected to /unauthorized.
 *
 * Only keep role gates for surfaces that are intentionally system-role-only.
 */
export const MIDDLEWARE_ROLE_PREFIX_RULES: Record<string, readonly string[]> = {
  "/admin": ["org_owner", "org_admin", "super_admin"],
}

const SORTED_PERMISSION_PREFIXES = Object.keys(MIDDLEWARE_PERMISSION_PREFIX_RULES).sort(
  (a, b) => b.length - a.length
)
const SORTED_ROLE_PREFIXES = Object.keys(MIDDLEWARE_ROLE_PREFIX_RULES).sort(
  (a, b) => b.length - a.length
)

export function getMiddlewarePermissionAllowlist(
  pathname: string
): readonly string[] | null {
  for (const prefix of SORTED_PERMISSION_PREFIXES) {
    if (pathMatchesPrefix(pathname, prefix)) {
      return MIDDLEWARE_PERMISSION_PREFIX_RULES[prefix]
    }
  }
  return null
}

export function getMiddlewareRoleAllowlist(pathname: string): readonly string[] | null {
  for (const { pattern, roles } of MIDDLEWARE_ROLE_PATTERN_RULES) {
    if (pattern.test(pathname)) {
      return roles
    }
  }

  for (const prefix of SORTED_ROLE_PREFIXES) {
    if (pathMatchesPrefix(pathname, prefix)) {
      return MIDDLEWARE_ROLE_PREFIX_RULES[prefix]
    }
  }

  return null
}

export function userHasMiddlewareRouteAccess(
  pathname: string,
  userRoles: readonly string[],
  userPermissions: readonly string[] = []
): boolean {
  const permissionAllowlist = getMiddlewarePermissionAllowlist(pathname)
  if (permissionAllowlist) {
    return hasAnyPermission(userPermissions, permissionAllowlist)
  }
  const allowlist = getMiddlewareRoleAllowlist(pathname)
  if (!allowlist) {
    return true
  }
  const effective = effectiveRoleKeys(userRoles)
  return allowlist.some((role) => effective.includes(role))
}
