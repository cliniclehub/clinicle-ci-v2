import { afterEach, describe, expect, it, vi } from "vitest"

import {
  buildPlatformDomain,
  extractPlatformHostname,
  getCustomDomainParentZone,
  getCustomDomainSubdomainLabel,
  inferOrgDomainKind,
  isLocalPlatformEnv,
  isPlatformHostname,
  isValidCustomDomain,
  isValidPlatformHostnameInput,
  normalizeDnsHostname,
  resolvePlatformCnameTarget,
  resolvePlatformBaseDomain,
} from "@/lib/utils/org-platform-domain"

describe("org-platform-domain", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("normalizes hostnames and resolves env bases", () => {
    vi.stubEnv("NEXT_PUBLIC_PLATFORM_PROD_DOMAIN", "example.com")
    vi.stubEnv("NEXT_PUBLIC_PLATFORM_TEST_DOMAIN", "test.example.com")
    vi.stubEnv("NEXT_PUBLIC_PLATFORM_INT_DOMAIN", "integration.example.com")
    vi.stubEnv("NEXT_PUBLIC_PLATFORM_LOCAL_DOMAIN", "example.local")
    vi.stubEnv("NEXT_PUBLIC_PLATFORM_CNAME_TARGET", "app.example.com")

    expect(normalizeDnsHostname("HTTPS://Foo.Example.com:443/path")).toBe("foo.example.com")
    expect(normalizeDnsHostname("")).toBe("")
    expect(resolvePlatformBaseDomain("production")).toBe("example.com")
    expect(resolvePlatformBaseDomain("test")).toBe("test.example.com")
    expect(resolvePlatformBaseDomain("integration")).toBe("integration.example.com")
    expect(resolvePlatformBaseDomain("dev")).toBe("example.local")
    expect(resolvePlatformCnameTarget("prod")).toBe("app.example.com")
    expect(isLocalPlatformEnv("local")).toBe(true)
    expect(isLocalPlatformEnv("production")).toBe(false)
  })

  it("classifies and builds platform domains", () => {
    vi.stubEnv("NEXT_PUBLIC_PLATFORM_BASE_DOMAIN", "platform.example")

    expect(isPlatformHostname("acme.platform.example")).toBe(true)
    expect(isPlatformHostname("platform.example")).toBe(true)
    expect(isPlatformHostname("tenant.customer.example")).toBe(false)
    expect(isPlatformHostname("")).toBe(false)
    expect(inferOrgDomainKind("acme.platform.example")).toBe("platform")
    expect(inferOrgDomainKind("customer.example")).toBe("custom")
    expect(buildPlatformDomain("", "production")).toBe("")
    expect(buildPlatformDomain("acme", "production")).toBe("acme.platform.example")
    expect(buildPlatformDomain("acme.platform.example", "production")).toBe("acme.platform.example")
    expect(extractPlatformHostname("acme.platform.example", "production")).toBe("acme")
    expect(extractPlatformHostname(null)).toBe("")
    expect(extractPlatformHostname("custom.customer.example")).toBe("custom.customer.example")
    expect(getCustomDomainSubdomainLabel("www.customer.example")).toBe("www")
    expect(getCustomDomainSubdomainLabel("customer.example")).toBe("@")
    expect(getCustomDomainSubdomainLabel("")).toBe("")
    expect(getCustomDomainParentZone("www.customer.example")).toBe("customer.example")
    expect(getCustomDomainParentZone("customer.example")).toBe("customer.example")
    expect(getCustomDomainParentZone("")).toBe("")
    expect(isValidPlatformHostnameInput("acme", "production")).toBe(true)
    expect(isValidPlatformHostnameInput("Bad Host!", "production")).toBe(false)
    expect(isValidPlatformHostnameInput("acme.platform.example", "production")).toBe(true)
    expect(isValidCustomDomain("tenant.customer.example")).toBe(true)
    expect(isValidCustomDomain("not a domain")).toBe(false)
  })
})
