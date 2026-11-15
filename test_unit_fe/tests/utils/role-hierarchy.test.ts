import { describe, expect, it } from "vitest"

import {
  getHighestPriorityRole,
  getManagementLandingPage,
  getManagementRoles,
  getRoleLandingPage,
  hasManagementRoles,
  hasUserRole,
  normalizeRole,
} from "@/lib/utils/role-hierarchy"

describe("role-hierarchy", () => {
  it("computes role priority and landing pages", () => {
    expect(hasUserRole(["user"])).toBe(true)
    expect(hasManagementRoles(["org_admin"])).toBe(true)
    expect(getManagementRoles(["user", "org_admin"])).toEqual(["org_admin"])
    expect(getHighestPriorityRole(["user", "org_admin"])).toBe("org_admin")
    expect(getHighestPriorityRole(["super_admin", "org_admin"])).toBe("super_admin")
    expect(getRoleLandingPage("user")).toBe("/dashboard")
    expect(getRoleLandingPage("org_admin")).toBe("/management-dashboard")
    expect(getRoleLandingPage("super_admin")).toBe("/platform-organizations")
    expect(getManagementLandingPage(["org_admin"])).toBe("/management-dashboard")
    expect(normalizeRole("org_admin")).toBe("org_admin")
    expect(normalizeRole("user")).toBe("user")
    expect(normalizeRole("custom_support_role")).toBe("user")
  })
})
