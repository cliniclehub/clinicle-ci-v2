import { describe, expect, it } from "vitest"

import {
  HARMONIOUS_THEMES,
  generateHarmoniousAccent,
  hslToHex,
  suggestThemeColors,
} from "@/lib/utils/theme-color-helper"

describe("theme-color-helper", () => {
  it("suggests harmonious theme colors across brightness bands", () => {
    const dark = suggestThemeColors("#111111")
    expect(dark.primary).toBe("#111111")
    expect(dark.secondary).toBe("#999999")
    expect(dark.accent).toMatch(/^hsl\(/)

    const light = suggestThemeColors("#eeeeee")
    expect(light.secondary).toBe("#666666")
    expect(generateHarmoniousAccent("#eeeeee")).toMatch(/^hsl\(/)

    const mid = suggestThemeColors("#336699")
    expect(mid.accent).toMatch(/^hsl\(/)
    expect(generateHarmoniousAccent("#336699")).toMatch(/^hsl\(/)

    expect(hslToHex(210, 50, 40)).toMatch(/^#[0-9a-f]{6}$/)
    expect(HARMONIOUS_THEMES.professional.primary).toBeTruthy()
    expect(HARMONIOUS_THEMES.modern.accent).toBeTruthy()
    expect(HARMONIOUS_THEMES.warm.primary).toBeTruthy()
    expect(HARMONIOUS_THEMES.cool.accent).toBeTruthy()
    expect(HARMONIOUS_THEMES.minimal.secondary).toBeTruthy()
  })
})
