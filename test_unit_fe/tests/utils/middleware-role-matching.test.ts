import { describe, expect, it } from "vitest"

import {
  ORG_EMAIL_MANAGE,
  ORG_USERS_READ,
} from "@/lib/types/permission-schema"
import {
  getMiddlewarePermissionAllowlist,
  getMiddlewareRoleAllowlist,
  userHasMiddlewareRouteAccess,
} from "@/lib/utils/middleware-route-policy"

describe("middleware role matching", () => {
  it("gates organization user routes by org.users.read permission", () => {
    const path = "/organization-users/edit/user-uuid"
    expect(getMiddlewarePermissionAllowlist(path)).toEqual([ORG_USERS_READ])
    expect(getMiddlewareRoleAllowlist(path)).toBeNull()
    expect(userHasMiddlewareRouteAccess(path, ["org_admin"], [ORG_USERS_READ])).toBe(true)
    expect(userHasMiddlewareRouteAccess(path, ["user"], [])).toBe(false)
    expect(
      userHasMiddlewareRouteAccess(path, ["c_abcdef0123456789"], [ORG_USERS_READ])
    ).toBe(true)
  })

  it("gates platform routes by platform permissions", () => {
    const path = "/platform-organizations/create"
    expect(getMiddlewarePermissionAllowlist(path)).toBeTruthy()
    expect(
      userHasMiddlewareRouteAccess(path, ["org_admin"], [ORG_USERS_READ])
    ).toBe(false)
  })

  it("prefers longer permission prefix rules over parent prefixes", () => {
    expect(getMiddlewarePermissionAllowlist("/dashboard-org-admin")).toContain(ORG_USERS_READ)
    expect(getMiddlewarePermissionAllowlist("/dashboard-super-admin")).toBeTruthy()
    expect(getMiddlewarePermissionAllowlist("/dashboard")).toBeNull()
  })

  it("allows custom-role users on shared auth pages without system role keys", () => {
    const customRole = "c_abcdef0123456789"
    for (const path of ["/settings", "/profile", "/notifications", "/help"]) {
      expect(getMiddlewareRoleAllowlist(path)).toBeNull()
      expect(userHasMiddlewareRouteAccess(path, [customRole], [])).toBe(true)
    }
  })

  it("allows custom-role users on email manager when they have org.email.manage", () => {
    const path = "/organization-email-manager"
    expect(
      userHasMiddlewareRouteAccess(path, ["c_abcdef0123456789"], [ORG_EMAIL_MANAGE])
    ).toBe(true)
    expect(userHasMiddlewareRouteAccess(path, ["c_abcdef0123456789"], [])).toBe(false)
  })

  it("does not apply /chat permission gate to /chat-with-us", () => {
    expect(getMiddlewarePermissionAllowlist("/chat")).toBeTruthy()
    expect(getMiddlewarePermissionAllowlist("/chat-with-us")).toBeNull()
    expect(userHasMiddlewareRouteAccess("/chat-with-us", ["user"], [])).toBe(true)
  })
})
