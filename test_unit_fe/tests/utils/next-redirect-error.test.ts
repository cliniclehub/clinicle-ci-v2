import { describe, expect, it } from "vitest"

import { isNextRedirectError } from "@/lib/utils/next-redirect-error"

describe("isNextRedirectError", () => {
  it("detects NEXT_REDIRECT digest", () => {
    expect(isNextRedirectError({ digest: "NEXT_REDIRECT;replace;/x;307;" })).toBe(true)
    expect(isNextRedirectError({ digest: "OTHER" })).toBe(false)
    expect(isNextRedirectError(null)).toBe(false)
    expect(isNextRedirectError("redirect")).toBe(false)
  })
})
