"use client"

import { fetchOrgWhiteLabelDataByDomain } from "@/lib/actions/organizations/organizations-org-actions"
import { getCurrentUser } from "@/lib/actions/users/users-me-actions"
import { ApiResponse } from "@/lib/types/api-response-schema"
import { OrganizationPublic } from "@/lib/types/organization-schema"
import { User } from "@/lib/types/user-schema"

const ORG_CACHE_TTL_MS = 5 * 60 * 1000
const PROFILE_CACHE_TTL_MS = 60 * 1000

let orgPromise: Promise<OrganizationPublic | undefined> | null = null
let orgCache: { data: OrganizationPublic | undefined; at: number } | null = null

let profilePromise: Promise<ApiResponse<User>> | null = null
let profileCache: { data: ApiResponse<User>; at: number } | null = null

export function invalidateOrgWhiteLabelClientCache(): void {
  orgCache = null
  orgPromise = null
}

export function invalidateCurrentUserClientCache(): void {
  profileCache = null
  profilePromise = null
}

/**
 * Deduplicates concurrent white-label fetches across components (sidebar, theme, tracking, etc.).
 * Server action still has its own domain cache; this avoids duplicate server-action round-trips per page.
 */
export async function fetchOrgWhiteLabelDataCached(): Promise<OrganizationPublic | undefined> {
  if (orgCache && Date.now() - orgCache.at < ORG_CACHE_TTL_MS) {
    return orgCache.data
  }

  if (!orgPromise) {
    orgPromise = fetchOrgWhiteLabelDataByDomain()
      .then((data) => {
        orgCache = { data, at: Date.now() }
        return data
      })
      .finally(() => {
        orgPromise = null
      })
  }

  return orgPromise
}

/**
 * Deduplicates concurrent /users/me calls (e.g. React Strict Mode double mount).
 */
export async function getCurrentUserCached(): Promise<ApiResponse<User>> {
  if (profileCache && Date.now() - profileCache.at < PROFILE_CACHE_TTL_MS) {
    return profileCache.data
  }

  if (!profilePromise) {
    profilePromise = getCurrentUser()
      .then((response) => {
        profileCache = { data: response, at: Date.now() }
        return response
      })
      .finally(() => {
        profilePromise = null
      })
  }

  return profilePromise
}
