"use client"

import { applyThemeColors, clearThemeColors } from "@/lib/utils/color-utils"
import {
  buildThemeFontStack,
  DEFAULT_THEME_FONT_FAMILY,
  ensureThemeFontLoaded,
} from "@/lib/utils/theme-fonts"
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from "react"

interface ThemeConfig {
  colors: {
    primary: string
    secondary: string
    accent: string
  }
  typography: {
    fontFamily: string
  }
}

interface ThemeContextType {
  theme: ThemeConfig | null
  setTheme: (theme: ThemeConfig | null) => void
  applyTheme: (theme: ThemeConfig) => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

function applyTypography(fontFamily: string) {
  const root = document.documentElement
  const stack = buildThemeFontStack(fontFamily)
  ensureThemeFontLoaded(fontFamily)
  root.style.setProperty("--font-family", stack)
  // Prefer the CSS variable on body; clear any bare family that forced Times fallback.
  document.body.style.removeProperty("font-family")
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeConfig | null>(null)

  const applyTheme = useCallback((newTheme: ThemeConfig) => {
    const root = document.documentElement
    applyThemeColors(root, newTheme.colors)
    applyTypography(
      newTheme.typography.fontFamily || DEFAULT_THEME_FONT_FAMILY
    )
    setTheme(newTheme)
  }, [])

  const handleSetTheme = useCallback((newTheme: ThemeConfig | null) => {
    if (newTheme) {
      applyTheme(newTheme)
      return
    }

    const root = document.documentElement
    clearThemeColors(root)
    root.style.removeProperty("--font-family")
    document.body.style.removeProperty("font-family")
    setTheme(null)
  }, [applyTheme])

  return (
    <ThemeContext.Provider value={{ theme, setTheme: handleSetTheme, applyTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider")
  }
  return context
}

/** Hook to load and apply organization theme */
export function useOrganizationTheme(organization?: { site_theme?: any }) {
  const { applyTheme } = useTheme()

  useEffect(() => {
    if (organization?.site_theme) {
      const themeConfig: ThemeConfig = {
        colors: {
          primary: organization.site_theme.colors?.primary || "#000000",
          secondary: organization.site_theme.colors?.secondary || "#666666",
          accent: organization.site_theme.colors?.accent || "#0070f3",
        },
        typography: {
          fontFamily:
            organization.site_theme.typography?.fontFamily ||
            DEFAULT_THEME_FONT_FAMILY,
        },
      }
      applyTheme(themeConfig)
    }
  }, [organization?.site_theme, applyTheme])
}
