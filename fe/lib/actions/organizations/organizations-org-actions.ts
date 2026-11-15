"use server"

import { ORG_CONFIGURATIONS_MANAGE, ORG_SETTINGS_MANAGE } from "@/lib/types/permission-schema"
import { ApiResponse } from "@/lib/types/api-response-schema"
import {
  Organization,
  OrganizationBasicInfo,
  OrganizationBranding,
  OrganizationContact,
  OrganizationLandingPage,
  OrganizationLandingPagePublic,
  OrganizationLegal,
  OrganizationPublic,
  OrganizationUpdatePayload,
} from "@/lib/types/organization-schema"
import { apiCaller } from "@/lib/utils/api-caller-helper"
import { cleanDomain } from "@/lib/utils/domain-name-helper-server"
import { createServerLogger } from "@/lib/utils/logger-server"
import {
  isOrgLookupCacheFresh,
  isUnknownTenantError,
  isUnknownTenantLookupError,
  ORG_WHITELABEL_CACHE_TTL_MS,
} from "@/lib/utils/unknown-tenant"
import { headers } from "next/headers"

type OrgLookupCacheEntry = {
  data: OrganizationPublic | undefined
  timestamp: number
  unknownTenant: boolean
}

const orgCache = new Map<string, OrgLookupCacheEntry>();

// Create base logger for the class
const logger = createServerLogger("OrganizationsActions")

//--------------------------------
// Org Admin methods
//--------------------------------

// Get my organization (any authenticated tenant user)
export async function getMyOrganization(): Promise<ApiResponse<Organization>> {
  const response = await apiCaller.get<Organization>("/organizations/my-organization", {
    requireAuth: true,
  })
  return response
}

// Get public organization data (available to all authenticated users)
export async function getPublicOrganizationData(): Promise<ApiResponse<Organization>> {
  const response = await apiCaller.get<Organization>("/organizations/get-white-label-data-by-domain", {
    requireAuth: true
  })
  return response
}

// Update my organization (Org-level - Org Admin only)
export async function updateMyOrganization(
  data: OrganizationUpdatePayload
): Promise<ApiResponse<Organization>> {
    const response = await apiCaller.patch<Organization>("/organizations/my-organization", data, {
      requireAuth: true,
      requirePermission: [ORG_SETTINGS_MANAGE, ORG_CONFIGURATIONS_MANAGE]
    })
    return response
}

// Section-specific update functions for my organization
export async function updateMyOrganizationBasicInfo(
  data: Omit<OrganizationBasicInfo, "domainKind">
): Promise<ApiResponse<Organization>> {
  return updateMyOrganization(data)
}

export async function updateMyOrganizationBranding(
  data: OrganizationBranding
): Promise<ApiResponse<Organization>> {
  return updateMyOrganization(data)
}

export async function updateMyOrganizationLegal(
  data: OrganizationLegal
): Promise<ApiResponse<Organization>> {
  return updateMyOrganization(data)
}

export async function updateMyOrganizationLandingPage(
  data: OrganizationLandingPage
): Promise<ApiResponse<Organization>> {
  return updateMyOrganization(data)
}

export async function updateMyOrganizationContact(
  data: OrganizationContact
): Promise<ApiResponse<Organization>> {
  return updateMyOrganization(data)
}

// List organizations for dropdown - simplified for org admin use
export async function listOrganizationsDropdown(): Promise<ApiResponse<{ id: string; name: string; code: string }[]>> {
  const response = await apiCaller.get<{ id: string; name: string; code: string }[]>(
    "/organizations/dropdown",
    { requireAuth: true }
  )
  return response
}

// Helper method to get a specific organization when in org admin context
// This uses the platform endpoint but requires org_admin role
export async function listOrganizations(): Promise<ApiResponse<Organization[]>> {
  const response = await apiCaller.get<Organization[]>("/organizations/", {
    requireAuth: true
  })
  return response
}

//*********************************************************
// Public methods
//*********************************************************

export type PublicContactFormPayload = {
  name: string
  email: string
  category: string
  subject: string
  message: string
}

export async function submitPublicContactForm(
  data: PublicContactFormPayload
): Promise<ApiResponse<{ sent: boolean }>> {
  return apiCaller.post<{ sent: boolean }>("/organizations/contact-form", data, {
    requireAuth: false,
  })
}

//---------------------------------
// fetchOrgLandingPageHtmlByDomain
//---------------------------------
export async function fetchOrgLandingPageHtmlByDomain(): Promise<string | null> {
  const methodLogger = logger.forMethod("fetchOrgLandingPageHtmlByDomain")

  const headersList = await headers()
  const host = headersList.get("host") || headersList.get("x-forwarded-host")
  const cleanedDomain = await cleanDomain(host || "")

  try {
    const response = await apiCaller.get<OrganizationLandingPagePublic>(
      "/organizations/get-landing-page-by-domain",
      {
        requireAuth: false,
        logResponse: false,
        logRequest: false,
      }
    )

    if (response.status === "success" && response.data) {
      const html = response.data.landingPageHtml
      return typeof html === "string" ? html : null
    }

    if (isUnknownTenantLookupError(response, { treatNotFoundAsUnknownTenant: true })) {
      methodLogger.info("Unknown tenant domain for landing page lookup", {
        domain: cleanedDomain,
        code: response.status === "error" ? response.code : undefined,
      })
      return null
    }

    methodLogger.warn("No landing page data for domain", { domain: cleanedDomain })
    return null
  } catch (error) {
    if (isUnknownTenantError(error)) {
      methodLogger.info("Unknown tenant domain for landing page lookup", {
        domain: cleanedDomain,
      })
      return null
    }
    methodLogger.error("Failed to fetch organization landing page HTML", error as Error, {
      domain: cleanedDomain,
    })
    return null
  }
}

//---------------------------------
// lookupOrgWhiteLabelByDomain / fetchOrgWhiteLabelDataByDomain
//---------------------------------
export type OrgWhiteLabelLookupResult =
  | { status: "found"; data: OrganizationPublic }
  | { status: "unknown-tenant" }
  | { status: "unavailable" }

function lookupResultFromCache(
  cached: OrgLookupCacheEntry
): OrgWhiteLabelLookupResult {
  if (cached.unknownTenant) {
    return { status: "unknown-tenant" }
  }
  if (cached.data) {
    return { status: "found", data: cached.data }
  }
  return { status: "unavailable" }
}

export async function lookupOrgWhiteLabelByDomain(): Promise<OrgWhiteLabelLookupResult> {
    const methodLogger = logger.forMethod("lookupOrgWhiteLabelByDomain")
    methodLogger.debug("Starting domain lookup")
    
    const headersList = await headers();
    const host = headersList.get('host') || headersList.get('x-forwarded-host');
    const domain = host || '';
    const cleanedDomain = await cleanDomain(domain)
    methodLogger.debug(`retrieved domain from headers is: ${cleanedDomain}`)
    
    const cached = orgCache.get(cleanedDomain);
    if (
      cached &&
      isOrgLookupCacheFresh(cached.timestamp, cached.unknownTenant)
    ) {
      methodLogger.debug("Cache hit for organization data - getting from cache ")
      return lookupResultFromCache(cached);
    }

    methodLogger.debug("Cache miss for organization data - getting from API");
    
    try {
      const response = await apiCaller.get<OrganizationPublic>("/organizations/get-white-label-data-by-domain", {
        requireAuth: false,
        logResponse: false,
        logRequest: false
      })
      
      if (response.status === "success" && response.data) {
        const data: OrganizationPublic = response.data;
        
        const formattedData = {
          ...data,
          logoUrl: data.logoUrl,
          faviconUrl: data.faviconUrl,
        }
        
        orgCache.set(cleanedDomain || '', {
          data: formattedData,
          timestamp: Date.now(),
          unknownTenant: false,
        });
        return { status: "found", data: formattedData }
      }

      if (isUnknownTenantLookupError(response, { treatNotFoundAsUnknownTenant: true })) {
        methodLogger.info("Unknown tenant domain", {
          code: response.status === "error" ? response.code : undefined,
          message: response.status === "error" ? response.message : undefined,
          domain: cleanedDomain,
        })
        orgCache.set(cleanedDomain || "", {
          data: undefined,
          timestamp: Date.now(),
          unknownTenant: true,
        })
        return { status: "unknown-tenant" }
      }

      if (response.status === "error") {
        methodLogger.warn("Error fetching organization data", {
          code: response.code,
          message: response.message,
          domain: cleanedDomain
        })
      } else {
        methodLogger.warn("No organization found for domain", { cleanedDomain });
      }
      return { status: "unavailable" }
    } catch (error: any) {
      if (isUnknownTenantError(error)) {
        methodLogger.info("Unknown tenant domain", {
          domain: cleanedDomain,
          errorMessage: error?.message,
        })
        orgCache.set(cleanedDomain || "", {
          data: undefined,
          timestamp: Date.now(),
          unknownTenant: true,
        })
        return { status: "unknown-tenant" }
      }
      methodLogger.error("Unexpected error fetching organization data", error as Error, {
        domain: cleanedDomain,
        errorMessage: error?.message
      })
      return { status: "unavailable" }
    }
}

export async function fetchOrgWhiteLabelDataByDomain(): Promise<OrganizationPublic | undefined> {
  const result = await lookupOrgWhiteLabelByDomain()
  return result.status === "found" ? result.data : undefined
}

//---------------------------------
// Cache Management Functions
//---------------------------------

export interface CacheInfo {
  totalEntries: number
  domains: string[]
  cacheSize: number
  ttl: number
  lastCleared?: Date
}

export async function getOrganizationCacheInfo(): Promise<CacheInfo> {
  const methodLogger = logger.forMethod("getOrganizationCacheInfo")
  
  const domains = Array.from(orgCache.keys())
  const totalEntries = orgCache.size
  const cacheSize = JSON.stringify(orgCache).length // Rough estimate of cache size in bytes
  
  methodLogger.info(`Cache info retrieved: ${totalEntries} entries, ${domains.length} domains`)
  
  return {
    totalEntries,
    domains,
    cacheSize,
    ttl: ORG_WHITELABEL_CACHE_TTL_MS,
  }
}

export async function clearOrganizationCache(domain?: string): Promise<{ cleared: number, domains: string[] }> {
  const methodLogger = logger.forMethod("clearOrganizationCache")
  
  if (domain) {
    // Clear specific domain
    const wasDeleted = orgCache.delete(domain)
    methodLogger.info(`Cleared cache for domain: ${domain}, deleted: ${wasDeleted}`)
    return {
      cleared: wasDeleted ? 1 : 0,
      domains: [domain]
    }
  } else {
    // Clear all cache
    const domains = Array.from(orgCache.keys())
    const clearedCount = orgCache.size
    orgCache.clear()
    methodLogger.info(`Cleared entire cache: ${clearedCount} entries`)
    return {
      cleared: clearedCount,
      domains
    }
  }
}
