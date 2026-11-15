import { describe, expect, it } from "vitest"

import {
  ACCESS_TOKEN_COOKIE,
  ACCESS_TOKEN_REFRESH_SKEW_SECONDS,
  accessTokenNeedsRefresh,
  isCookieMutationContextError,
  REFRESH_TOKEN_COOKIE,
} from "@/lib/utils/auth-cookie-policy"

describe("auth-cookie-policy", () => {
  it("exports stable cookie names and refresh skew", () => {
    expect(ACCESS_TOKEN_COOKIE).toBe("auth2_access_token")
    expect(REFRESH_TOKEN_COOKIE).toBe("auth2_refresh_token")
    expect(ACCESS_TOKEN_REFRESH_SKEW_SECONDS).toBe(120)
  })

  it("detects Next.js cookie mutation context errors", () => {
    expect(
      isCookieMutationContextError(
        new Error(
          "Cookies can only be modified in a Server Action or Route Handler. Read more: https://nextjs.org/docs/app/api-reference/functions/cookies#options"
        )
      )
    ).toBe(true)
    expect(isCookieMutationContextError(new Error("network down"))).toBe(false)
    expect(isCookieMutationContextError("Cookies can only be modified")).toBe(false)
  })

  it("refreshes when exp is missing or within skew", () => {
    const now = 1_000_000
    expect(accessTokenNeedsRefresh(undefined, now)).toBe(true)
    expect(accessTokenNeedsRefresh(now + ACCESS_TOKEN_REFRESH_SKEW_SECONDS, now)).toBe(true)
    expect(accessTokenNeedsRefresh(now + ACCESS_TOKEN_REFRESH_SKEW_SECONDS + 1, now)).toBe(
      false
    )
    expect(accessTokenNeedsRefresh(now - 1, now)).toBe(true)
  })
})
