import { describe, expect, it } from "vitest"

import { formatCurrency } from "@/lib/utils/format"

describe("formatCurrency", () => {
  it("formats finite amounts", () => {
    expect(formatCurrency(12.5, "USD", "en-US")).toMatch(/\$12\.50/)
  })

  it("returns em dash for non-finite amounts", () => {
    expect(formatCurrency(Number.NaN)).toBe("—")
    expect(formatCurrency(Number.POSITIVE_INFINITY)).toBe("—")
  })
})
