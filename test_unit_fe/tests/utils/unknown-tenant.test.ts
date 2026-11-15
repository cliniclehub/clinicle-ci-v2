import { describe, expect, it } from "vitest"

import {
  isOrgLookupCacheFresh,
  isUnknownTenantError,
  isUnknownTenantLookupError,
  isUnknownTenantNotFoundMessage,
  ORG_WHITELABEL_CACHE_TTL_MS,
  shouldBypassUnknownTenantPage,
  shouldReplaceAppWithUnknownTenantPage,
  UNKNOWN_TENANT_CACHE_TTL_MS,
  unknownTenantDescription,
} from "@/lib/utils/unknown-tenant"

describe("unknown-tenant", () => {
  it("classifies domain-not-found messages", () => {
    expect(isUnknownTenantNotFoundMessage("Domain 'spam.example' not found")).toBe(true)
    expect(isUnknownTenantNotFoundMessage('Domain "spam.example" not found')).toBe(true)
    expect(isUnknownTenantNotFoundMessage("Organization not found for domain")).toBe(true)
    expect(isUnknownTenantNotFoundMessage("Organization not found")).toBe(false)
    expect(isUnknownTenantNotFoundMessage("Course not found")).toBe(false)
    expect(isUnknownTenantError(new Error("Domain 'x' not found"))).toBe(true)
    expect(isUnknownTenantError("Domain 'x' not found")).toBe(false)
  })

  it("treats dedicated lookup 404s as unknown tenant when requested", () => {
    expect(
      isUnknownTenantLookupError(
        { status: "error", code: 404, message: "Domain 'x' not found" }
      )
    ).toBe(true)
    expect(
      isUnknownTenantLookupError({ status: "error", code: 404, message: "Not found" })
    ).toBe(false)
    expect(
      isUnknownTenantLookupError(
        { status: "error", code: 404, message: "Not found" },
        { treatNotFoundAsUnknownTenant: true }
      )
    ).toBe(true)
    expect(
      isUnknownTenantLookupError(
        { status: "error", code: 500, message: "boom" },
        { treatNotFoundAsUnknownTenant: true }
      )
    ).toBe(false)
  })

  it("uses a short TTL for unknown-tenant cache entries", () => {
    const now = 1_000_000
    expect(isOrgLookupCacheFresh(now - 30_000, true, now)).toBe(true)
    expect(isOrgLookupCacheFresh(now - UNKNOWN_TENANT_CACHE_TTL_MS, true, now)).toBe(false)
    expect(isOrgLookupCacheFresh(now - 30_000, false, now)).toBe(true)
    expect(
      isOrgLookupCacheFresh(now - ORG_WHITELABEL_CACHE_TTL_MS + 1, false, now)
    ).toBe(true)
    expect(isOrgLookupCacheFresh(now - ORG_WHITELABEL_CACHE_TTL_MS, false, now)).toBe(false)
  })

  it("replaces the app for unresolved platform hosts, not localhost or outages", () => {
    expect(shouldBypassUnknownTenantPage("localhost:3000")).toBe(true)
    expect(shouldBypassUnknownTenantPage("127.0.0.1")).toBe(true)
    expect(shouldBypassUnknownTenantPage("")).toBe(true)
    expect(shouldBypassUnknownTenantPage("foo.midad.co")).toBe(false)
    expect(
      shouldReplaceAppWithUnknownTenantPage({
        lookupStatus: "unknown-tenant",
        hostname: "anything.midad.co",
      })
    ).toBe(true)
    expect(
      shouldReplaceAppWithUnknownTenantPage({
        lookupStatus: "unknown-tenant",
        hostname: "localhost",
      })
    ).toBe(false)
    expect(
      shouldReplaceAppWithUnknownTenantPage({
        lookupStatus: "unavailable",
        hostname: "anything.midad.co",
      })
    ).toBe(false)
    expect(
      shouldReplaceAppWithUnknownTenantPage({
        lookupStatus: "found",
        hostname: "suhba.midad.co",
      })
    ).toBe(false)
    expect(unknownTenantDescription("anything.midad.co")).toContain("anything.midad.co")
  })
})
