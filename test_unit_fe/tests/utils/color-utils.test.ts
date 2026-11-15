import { describe, expect, it } from "vitest"

import {
  applyThemeColors,
  clearThemeColors,
  getForegroundColor,
  hexToHsl,
  hslToHex,
} from "@/lib/utils/color-utils"

describe("color-utils", () => {
  it("converts hex and hsl", () => {
    expect(hexToHsl("#000000")).toBe("0 0% 0%")
    expect(hexToHsl("#ffffff")).toBe("0 0% 100%")
    expect(hslToHex(0, 0, 0)).toBe("#000000")
  })

  it("picks foreground and applies/clears theme vars", () => {
    expect(getForegroundColor("#ffffff")).toContain("%")
    expect(getForegroundColor("#000000")).toContain("%")
    const root = document.createElement("div")
    applyThemeColors(root, { primary: "#112233", secondary: "#445566", accent: "#778899" })
    expect(root.style.getPropertyValue("--primary")).toBeTruthy()
    clearThemeColors(root)
    expect(root.style.getPropertyValue("--primary")).toBe("")
  })
})
