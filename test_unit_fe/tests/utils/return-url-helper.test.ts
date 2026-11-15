import { describe, expect, it } from "vitest"

import {
  resolvePostAuthRedirect,
  sanitizeReturnUrl,
  withReturnUrl,
} from "@/lib/utils/return-url-helper"

describe("return-url-helper", () => {
  it("sanitizes same-origin relative return URLs", () => {
    expect(sanitizeReturnUrl("/organization-users")).toBe("/organization-users")
    expect(sanitizeReturnUrl("//evil.com")).toBeNull()
    expect(sanitizeReturnUrl("https://evil.com")).toBeNull()
    expect(withReturnUrl("/login", "/x")).toContain("returnUrl=%2Fx")
    expect(withReturnUrl("/login?a=1", "/x")).toContain("&returnUrl=")
  })

  it("prefers a safe return URL over the role landing page", () => {
    expect(resolvePostAuthRedirect({ returnUrl: "/safe", user: { roles: ["org_admin"] } })).toBe(
      "/safe"
    )
    expect(resolvePostAuthRedirect({ returnUrl: "https://evil.com", user: null })).toBe("/dashboard")
  })

  it("falls back to the role landing page", () => {
    expect(resolvePostAuthRedirect({ user: { roles: ["org_admin"] } })).toBe("/management-dashboard")
    expect(resolvePostAuthRedirect({ user: { roles: ["super_admin"] } })).toBe(
      "/platform-organizations"
    )
    expect(resolvePostAuthRedirect({})).toBe("/dashboard")
  })
})
