"use client"

import { getRoleLandingPage, normalizeRole } from "@/lib/utils/role-hierarchy"

/**
 * Same-origin relative return paths only (middleware/login already use this rule).
 */
export function sanitizeReturnUrl(raw: string | null | undefined): string | null {
  if (raw == null || typeof raw !== "string") return null
  const t = raw.trim()
  if (!t.startsWith("/")) return null
  if (t.startsWith("//")) return null
  return t
}

/**
 * Append returnUrl query param for onboarding handoff. Preserves existing query on `path`.
 */
export function withReturnUrl(path: string, returnUrl: string | null | undefined): string {
  const safe = sanitizeReturnUrl(returnUrl ?? null)
  if (!safe) return path
  const sep = path.includes("?") ? "&" : "?"
  return `${path}${sep}returnUrl=${encodeURIComponent(safe)}`
}

export type ResolvePostAuthRedirectParams = {
  user?: { roles?: string[] } | null
  organization?: unknown
  phoneVerificationStatus?: unknown
  returnUrl?: string | null
}

export function resolvePostAuthRedirect({
  returnUrl,
  user,
}: ResolvePostAuthRedirectParams): string {
  const safe = sanitizeReturnUrl(returnUrl ?? null)
  if (safe) return safe
  const role = user?.roles?.[0] ? normalizeRole(user.roles[0]) : "user"
  return getRoleLandingPage(role)
}
