"use client"

import { useOrgWhiteLabelContext } from "@/lib/contexts/org-white-label-context"
import { useTheme } from "@/lib/contexts/theme-context"
import { createClientLogger } from "@/lib/utils/logger-client"
import { DEFAULT_THEME_FONT_FAMILY } from "@/lib/utils/theme-fonts"
import { usePathname } from "next/navigation"
import { useEffect } from "react"

const logger = createClientLogger("ThemeLoader")

interface ThemeLoaderProps {
  children: React.ReactNode
}

export function ThemeLoader({ children }: ThemeLoaderProps) {
  const pathname = usePathname()
  const { applyTheme } = useTheme()
  const { org, isLoading } = useOrgWhiteLabelContext()
  // Embed iframes must not use a full-viewport loader — min-h-screen + parent
  // height sync creates an unbounded resize feedback loop.
  const isEmbedRoute = pathname?.startsWith("/embeds/") ?? false

  useEffect(() => {
    if (!org?.siteTheme) return

    try {
      const themeConfig = {
        colors: {
          primary: org.siteTheme.colors?.primary || "#000000",
          secondary: org.siteTheme.colors?.secondary || "#666666",
          accent: org.siteTheme.colors?.accent || "#0070f3",
        },
        typography: {
          fontFamily:
            org.siteTheme.typography?.fontFamily || DEFAULT_THEME_FONT_FAMILY,
        },
      }
      applyTheme(themeConfig)
    } catch (error) {
      logger.error("Error applying organization theme", error as Error)
    }
  }, [org, applyTheme])

  if (isLoading && !isEmbedRoute) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-sm text-muted-foreground">Loading theme...</p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
