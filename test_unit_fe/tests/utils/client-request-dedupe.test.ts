import { describe, expect, it, vi } from "vitest"

import { dedupeClientRequest } from "@/lib/utils/client-request-dedupe"

describe("client-request-dedupe", () => {
  it("coalesces in-flight requests with the same key", async () => {
    let calls = 0
    const fn = vi.fn(async () => {
      calls += 1
      await new Promise((r) => setTimeout(r, 20))
      return "ok"
    })
    const a = dedupeClientRequest("k1", fn)
    const b = dedupeClientRequest("k1", fn)
    await expect(Promise.all([a, b])).resolves.toEqual(["ok", "ok"])
    expect(calls).toBe(1)

    await expect(dedupeClientRequest("k1", fn)).resolves.toBe("ok")
    expect(calls).toBe(2)
  })
})
