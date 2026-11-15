import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/utils/role-hierarchy", async () => {
  const actual = await vi.importActual<typeof import("@/lib/utils/role-hierarchy")>(
    "@/lib/utils/role-hierarchy"
  )
  return {
    ...actual,
    getRoleLandingPage: (role: string) =>
      role === "org_admin" ? "/management-dashboard" : "/dashboard",
  }
})

import { getDefaultLandingPage } from "@/lib/utils/navigation-helper"

describe("navigation-helper", () => {
  it("defaults unknown and standard users to the generic dashboard", () => {
    expect(getDefaultLandingPage(null)).toBe("/dashboard")
    expect(getDefaultLandingPage(undefined)).toBe("/dashboard")
    expect(getDefaultLandingPage("user")).toBe("/dashboard")
    expect(getDefaultLandingPage("org_admin")).toBe("/management-dashboard")
  })
})
