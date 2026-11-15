import { describe, expect, it } from "vitest"

import {
  delayMs,
  isNextServerActionTransportError,
} from "@/lib/utils/next-server-action-error"

describe("next-server-action-error", () => {
  it("detects transport parse failures", () => {
    expect(
      isNextServerActionTransportError(
        new Error("An unexpected response was received from the server.")
      )
    ).toBe(true)
    const err = new Error("boom") as Error & { __NEXT_ERROR_CODE?: string }
    err.__NEXT_ERROR_CODE = "E394"
    expect(isNextServerActionTransportError(err)).toBe(true)
    expect(isNextServerActionTransportError(new Error("other"))).toBe(false)
    expect(isNextServerActionTransportError("x")).toBe(false)
  })

  it("delayMs resolves", async () => {
    await expect(delayMs(1)).resolves.toBeUndefined()
  })
})
