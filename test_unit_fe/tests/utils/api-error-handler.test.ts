import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { logoutUser, loggerError, loggerInfo } = vi.hoisted(() => ({
  logoutUser: vi.fn(),
  loggerError: vi.fn(),
  loggerInfo: vi.fn(),
}))

vi.mock("@/lib/actions/auth/auth-public-actions", () => ({
  logoutUser: (...args: unknown[]) => logoutUser(...args),
}))

// sonner cannot be resolved from test_unit_fe/; keep a noop mock so source imports succeed.
vi.mock("sonner", () => ({
  toast: { error: () => undefined },
}))

vi.mock("@/lib/utils/logger-client", () => ({
  createClientLogger: () => ({
    error: (...args: unknown[]) => loggerError(...args),
    debug: vi.fn(),
    info: (...args: unknown[]) => loggerInfo(...args),
    warn: vi.fn(),
  }),
}))

import {
  handleApiErrorResponse,
  isServerActionAuthRedirect,
} from "@/lib/utils/api-error-handler"

describe("api-error-handler", () => {
  let replace: ReturnType<typeof vi.fn>

  beforeEach(() => {
    logoutUser.mockReset()
    loggerError.mockReset()
    loggerInfo.mockReset()
    logoutUser.mockResolvedValue(undefined)
    replace = vi.fn()
    vi.stubGlobal("location", { replace })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("detects Next.js auth redirects", () => {
    expect(isServerActionAuthRedirect({ digest: "NEXT_REDIRECT;replace;/login;307;" })).toBe(
      true
    )
    expect(isServerActionAuthRedirect(new Error("nope"))).toBe(false)
  })

  it("redirects to login for null responses and 401", async () => {
    expect(handleApiErrorResponse(null, "load")).toBe(true)
    expect(handleApiErrorResponse({ status: "error", code: 401, message: "auth" })).toBe(
      true
    )
    await vi.waitFor(() => {
      expect(logoutUser).toHaveBeenCalled()
      expect(replace).toHaveBeenCalledWith("/login")
    })
  })

  it("continues when logout fails during silent redirect", async () => {
    logoutUser.mockRejectedValueOnce(new Error("logout failed"))
    expect(handleApiErrorResponse(undefined)).toBe(true)
    await vi.waitFor(() => {
      expect(loggerError).toHaveBeenCalledWith(
        "Failed to call logout API",
        expect.any(Error)
      )
      expect(replace).toHaveBeenCalledWith("/login")
    })
  })

  it("returns false for success responses", () => {
    expect(handleApiErrorResponse({ status: "success", data: {} })).toBe(false)
  })

  it("handles toast-backed error codes", () => {
    expect(
      handleApiErrorResponse({ status: "error", code: 403, message: "Forbidden" })
    ).toBe(true)
    expect(handleApiErrorResponse({ status: "error", code: 0, message: "net" })).toBe(
      true
    )
    expect(
      handleApiErrorResponse({ status: "error", code: 400, message: "bad input" })
    ).toBe(true)
    expect(handleApiErrorResponse({ status: "error", code: 404 })).toBe(true)
    expect(
      handleApiErrorResponse({ status: "error", code: 409, message: "conflict" })
    ).toBe(true)
    expect(handleApiErrorResponse({ status: "error", code: 500 })).toBe(true)
    expect(
      handleApiErrorResponse({ status: "error", code: 418, message: "teapot" })
    ).toBe(true)
    expect(handleApiErrorResponse({ status: "error", code: 403 })).toBe(true)
    expect(handleApiErrorResponse({ status: "error", code: 400 })).toBe(true)
    expect(handleApiErrorResponse({ status: "error", code: 409 })).toBe(true)
    expect(handleApiErrorResponse({ status: "error", code: 422 })).toBe(true)
  })

  it("downgrades unknown-tenant domain 404s without toasting", () => {
    expect(
      handleApiErrorResponse({
        status: "error",
        code: 404,
        message: "Domain 'spam.example' not found",
      })
    ).toBe(true)
    expect(loggerInfo).toHaveBeenCalledWith("API call: Unknown tenant domain")
    expect(loggerError).not.toHaveBeenCalled()
  })
})
