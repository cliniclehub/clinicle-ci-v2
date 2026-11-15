import { describe, expect, it } from "vitest"

import { shouldForceReloginAfter401 } from "@/lib/utils/auth-invalid-session"

describe("shouldForceReloginAfter401", () => {
  it("matches session/token failure messages", () => {
    expect(shouldForceReloginAfter401("Session has expired")).toBe(true)
    expect(shouldForceReloginAfter401("invalid refresh token")).toBe(true)
    expect(shouldForceReloginAfter401(undefined, "User not found")).toBe(true)
    expect(shouldForceReloginAfter401("No authentication token")).toBe(false)
  })
})
