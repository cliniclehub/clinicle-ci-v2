"use client"

import { isTrackingBlockedPath } from "@/lib/constants/tracking-blocked-routes"
import { useOrgWhiteLabelContext } from "@/lib/contexts/org-white-label-context"
import Script from "next/script"
import { usePathname } from "next/navigation"
import { useEffect, useRef } from "react"

interface TrackingConfig {
  enabled?: boolean
  gtmContainerId?: string
  customHeadScripts?: string
  customBodyScripts?: string
}

/**
 * Injects raw HTML (including <script src="...">, inline <script>, <noscript>, <img>, etc.)
 * into a target element (document.head or document.body).
 */
function injectRawHtml(html: string, target: HTMLElement, markerId: string) {
  if (document.getElementById(markerId)) return

  const marker = document.createElement("div")
  marker.id = markerId
  marker.style.display = "none"
  target.appendChild(marker)

  const parser = new DOMParser()
  const doc = parser.parseFromString(html, "text/html")

  const nodes = [
    ...Array.from(doc.head.childNodes),
    ...Array.from(doc.body.childNodes),
  ]

  nodes.forEach((node) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element
      if (el.tagName === "SCRIPT") {
        const script = document.createElement("script")
        Array.from(el.attributes).forEach((attr) => {
          script.setAttribute(attr.name, attr.value)
        })
        if (el.textContent) {
          script.textContent = el.textContent
        }
        target.appendChild(script)
      } else {
        target.appendChild(el.cloneNode(true))
      }
    } else if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
      target.appendChild(node.cloneNode(true))
    }
  })
}

export function OrgTrackingScripts() {
  const pathname = usePathname()
  const { trackingScripts } = useOrgWhiteLabelContext()
  const injectedRef = useRef(false)

  const tracking = trackingScripts as TrackingConfig | undefined
  const isBlocked = isTrackingBlockedPath(pathname)

  useEffect(() => {
    if (!tracking?.enabled || injectedRef.current || isBlocked) return

    if (tracking.customHeadScripts) {
      injectRawHtml(tracking.customHeadScripts, document.head, "__platform-custom-head")
    }
    if (tracking.customBodyScripts) {
      injectRawHtml(tracking.customBodyScripts, document.body, "__platform-custom-body")
    }

    injectedRef.current = true
  }, [tracking, isBlocked])

  if (!tracking?.enabled || isBlocked) return null

  return (
    <>
      {tracking.gtmContainerId && (
        <Script
          id="gtm-script"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${tracking.gtmContainerId}');`,
          }}
        />
      )}
    </>
  )
}
