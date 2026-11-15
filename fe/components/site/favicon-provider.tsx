"use client"

import { useOrgWhiteLabelData } from "@/lib/hooks/use-org-white-label-data"
import { useEffect } from "react"

export function FaviconProvider() {
  const { faviconUrl, isLoading } = useOrgWhiteLabelData()

  useEffect(() => {
    if (!isLoading && faviconUrl) {
      // Remove existing favicon links
      const existingLinks = document.querySelectorAll("link[rel*='icon']")
      existingLinks.forEach(link => link.remove())
      
      // Create new favicon link
      const link = document.createElement('link') as HTMLLinkElement
      link.type = 'image/x-icon'
      link.rel = 'shortcut icon'
      link.href = faviconUrl
      document.head.appendChild(link)
    }
    console.log("faviconUrl", faviconUrl)
  }, [faviconUrl, isLoading])

  return null
}
