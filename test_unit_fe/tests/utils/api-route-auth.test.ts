import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/utils/auth-server-helper", () => ({
  getAccessToken: vi.fn(),
  userHasAnyRole: vi.fn(),
}))

import { getAccessToken, userHasAnyRole } from "@/lib/utils/auth-server-helper"
import { requireApiRouteAuth } from "@/lib/utils/api-route-auth"

describe("api-route-auth", () => {
  beforeEach(() => {
    vi.mocked(getAccessToken).mockReset()
    vi.mocked(userHasAnyRole).mockReset()
  })

  it("returns 401 without token and 403 without roles", async () => {
    vi.mocked(getAccessToken).mockResolvedValue(null as any)
    const unauthorized = await requireApiRouteAuth()
    expect(unauthorized?.status).toBe(401)

    vi.mocked(getAccessToken).mockResolvedValue("tok" as any)
    vi.mocked(userHasAnyRole).mockResolvedValue(false)
    const forbidden = await requireApiRouteAuth(["org_admin"])
    expect(forbidden?.status).toBe(403)

    vi.mocked(userHasAnyRole).mockResolvedValue(true)
    await expect(requireApiRouteAuth(["org_admin"])).resolves.toBeNull()
    await expect(requireApiRouteAuth()).resolves.toBeNull()
  })
})
