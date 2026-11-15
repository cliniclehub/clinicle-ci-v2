/** Expected unknown-host / crawler lookups — not application failures. */

import { normalizeDnsHostname } from "@/lib/utils/org-platform-domain"

export const UNKNOWN_TENANT_SITE_TITLE = "This site isn't available"
export const UNKNOWN_TENANT_HEADING = "This site isn't available"
export const ORG_WHITELABEL_CACHE_TTL_MS = 60 * 60 * 1000
export const UNKNOWN_TENANT_CACHE_TTL_MS = 60 * 1000

export type OrgTenantLookupStatus = "found" | "unknown-tenant" | "unavailable"

export function unknownTenantDescription(hostname: string | null | undefined): string {
  const host = normalizeDnsHostname(hostname || "")
  if (host) {
    return `There's no organization at ${host}. Check the address, or ask an administrator for the correct link.`
  }
  return "There's no organization at this address. Check the link, or ask an administrator for the correct site."
}

/** Local `make run-fe` has no org on localhost; do not brick that workflow. */
export function shouldBypassUnknownTenantPage(hostname: string | null | undefined): boolean {
  const host = normalizeDnsHostname(hostname || "")
  if (!host) {
    return true
  }
  return host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1"
}

export function shouldReplaceAppWithUnknownTenantPage(input: {
  lookupStatus: OrgTenantLookupStatus
  hostname: string | null | undefined
}): boolean {
  if (input.lookupStatus !== "unknown-tenant") {
    return false
  }
  return !shouldBypassUnknownTenantPage(input.hostname)
}

export function isUnknownTenantNotFoundMessage(message: string | null | undefined): boolean {
  const msg = (message || "").trim().toLowerCase()
  if (!msg.includes("not found")) {
    return false
  }
  return msg.includes("domain '") || msg.includes('domain "') || msg.includes("for domain")
}

export function isUnknownTenantError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }
  return isUnknownTenantNotFoundMessage(error.message)
}

export function isUnknownTenantLookupError(
  input: { code?: number | null; message?: string | null; status?: string | null } | null | undefined,
  options?: { treatNotFoundAsUnknownTenant?: boolean }
): boolean {
  if (!input) {
    return false
  }
  if (isUnknownTenantNotFoundMessage(input.message)) {
    return true
  }
  return Boolean(
    options?.treatNotFoundAsUnknownTenant && input.status === "error" && input.code === 404
  )
}

export function isOrgLookupCacheFresh(
  cachedAt: number,
  unknownTenant: boolean,
  now: number = Date.now()
): boolean {
  const ttl = unknownTenant ? UNKNOWN_TENANT_CACHE_TTL_MS : ORG_WHITELABEL_CACHE_TTL_MS
  return now - cachedAt < ttl
}
