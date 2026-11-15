"use client"

import { FormattedOrganization, OrganizationPublic } from "@/lib/types/organization-schema"
import { createClientLogger } from "@/lib/utils/logger-client"
import {
  fetchOrgWhiteLabelDataCached,
  invalidateOrgWhiteLabelClientCache,
} from "@/lib/utils/cached-client-requests"
import { isUnknownTenantError } from "@/lib/utils/unknown-tenant"
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"

const logger = createClientLogger("OrgWhiteLabelProvider")

export interface OrgWhiteLabelContextValue {
  org: FormattedOrganization | undefined
  isLoading: boolean
  logoUrl: string
  faviconUrl: string
  name: string
  supportEmail: string
  privacyNotice: string | undefined
  termsOfUse: string | undefined
  primaryColor: string
  secondaryColor: string
  accentColor: string
  trackingScripts: OrganizationPublic["trackingScripts"]
  refreshOrg: () => Promise<void>
}

const OrgWhiteLabelContext = createContext<OrgWhiteLabelContextValue | undefined>(undefined)

export function OrgWhiteLabelProvider({ children }: { children: React.ReactNode }) {
  const [org, setOrg] = useState<FormattedOrganization | undefined>()
  const [isLoading, setIsLoading] = useState(true)

  const loadOrg = useCallback(async (force = false) => {
    if (force) {
      invalidateOrgWhiteLabelClientCache()
    }
    try {
      const data = await fetchOrgWhiteLabelDataCached()
      setOrg(data as FormattedOrganization | undefined)
    } catch (error) {
      if (isUnknownTenantError(error)) {
        logger.info("Unknown tenant domain; using fallback branding")
      } else {
        logger.error("Failed to load organization white-label data", error as Error)
      }
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadOrg()
  }, [loadOrg])

  const refreshOrg = useCallback(async () => {
    setIsLoading(true)
    await loadOrg(true)
  }, [loadOrg])

  const value = useMemo<OrgWhiteLabelContextValue>(
    () => ({
      org,
      isLoading,
      logoUrl: org?.logoUrl || "",
      faviconUrl: org?.faviconUrl || "",
      name: org?.name || "",
      supportEmail: org?.supportEmail?.trim() || "",
      privacyNotice: org?.privacyPolicy,
      termsOfUse: org?.termsOfUse,
      primaryColor: org?.primaryColor || org?.siteTheme?.colors?.primary || "#3b82f6",
      secondaryColor: org?.secondaryColor || org?.siteTheme?.colors?.secondary || "#6b7280",
      accentColor: org?.siteTheme?.colors?.accent || "#10b981",
      trackingScripts: org?.trackingScripts,
      refreshOrg,
    }),
    [org, isLoading, refreshOrg]
  )

  return (
    <OrgWhiteLabelContext.Provider value={value}>{children}</OrgWhiteLabelContext.Provider>
  )
}

export function useOrgWhiteLabelContext(): OrgWhiteLabelContextValue {
  const context = useContext(OrgWhiteLabelContext)
  if (!context) {
    throw new Error("useOrgWhiteLabelContext must be used within OrgWhiteLabelProvider")
  }
  return context
}
