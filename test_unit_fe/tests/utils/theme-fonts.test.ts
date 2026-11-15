import { afterEach, describe, expect, it } from "vitest"

import {
  DEFAULT_THEME_FONT_FAMILY,
  THEME_FONT_OPTIONS,
  THEME_FONT_PREVIEW_ATTR,
  buildThemeFontStack,
  ensureAllThemeFontsLoaded,
  ensureThemeFontLoaded,
  quoteFontFamilyName,
} from "@/lib/utils/theme-fonts"

describe("theme-fonts", () => {
  afterEach(() => {
    document.head.innerHTML = ""
  })

  it("defaults to Inter", () => {
    expect(DEFAULT_THEME_FONT_FAMILY).toBe("Inter")
    expect(buildThemeFontStack(null)).toContain("Inter")
    expect(buildThemeFontStack(null)).toContain("sans-serif")
  })

  it("quotes multi-word font names", () => {
    expect(quoteFontFamilyName("Open Sans")).toBe("'Open Sans'")
    expect(buildThemeFontStack("Open Sans")).toMatch(/^'Open Sans',/)
  })

  it("keeps a sans-serif fallback so missing webfonts are not Times", () => {
    const stack = buildThemeFontStack("Poppins")
    expect(stack.startsWith("Poppins,")).toBe(true)
    expect(stack).toContain("sans-serif")
    expect(stack.toLowerCase()).not.toContain("times")
  })

  it("uses serif/monospace fallbacks for those families", () => {
    expect(buildThemeFontStack("Lora")).toContain("serif")
    expect(buildThemeFontStack("IBM Plex Mono")).toContain("monospace")
    expect(THEME_FONT_OPTIONS.length).toBeGreaterThan(3)
    expect(THEME_FONT_PREVIEW_ATTR).toBe("data-theme-font-preview")
  })

  it("injects Google Font stylesheets into document head", () => {
    ensureThemeFontLoaded("Inter")
    expect(document.querySelector('link[data-platform-theme-font="true"]')).toBeTruthy()
    ensureAllThemeFontsLoaded()
    expect(document.querySelector('link[data-platform-theme-font-picker="true"]')).toBeTruthy()
    expect(document.getElementById("platform-theme-font-preview-styles")).toBeTruthy()
  })
})
