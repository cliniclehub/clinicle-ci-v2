"use client"

import { useOrgWhiteLabelData } from "@/lib/hooks/use-org-white-label-data"
import { useEffect } from "react"

const FALLBACK_SITE_TITLE = "Clinicle Intelligence App"

export const DynamicFavicon = () => {
  const { faviconUrl, name } = useOrgWhiteLabelData()
  const orgTitle = name?.trim() || ""

  useEffect(() => {
    if (!faviconUrl) return
    const link = document.querySelector("link[rel*='icon']") as HTMLLinkElement
    if (link) {
      link.href = faviconUrl
    } else {
      const newLink = document.createElement("link")
      newLink.rel = "icon"
      newLink.href = faviconUrl
      document.head.appendChild(newLink)
    }
  }, [faviconUrl])

  // Next.js can re-apply the static fallback title after hydration; keep org name when that happens.
  useEffect(() => {
    if (!orgTitle) return

    const applyOrgTitleIfFallback = () => {
      if (
        document.title === FALLBACK_SITE_TITLE ||
        document.title === ""
      ) {
        document.title = orgTitle
      }
    }

    applyOrgTitleIfFallback()

    const titleEl = document.querySelector("title")
    if (!titleEl) return

    const observer = new MutationObserver(applyOrgTitleIfFallback)
    observer.observe(titleEl, {
      childList: true,
      subtree: true,
      characterData: true,
    })

    return () => observer.disconnect()
  }, [orgTitle])

  return null
}
