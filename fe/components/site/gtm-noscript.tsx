"use client"

import { isTrackingBlockedPath } from "@/lib/constants/tracking-blocked-routes"
import { useOrgWhiteLabelContext } from "@/lib/contexts/org-white-label-context"
import { usePathname } from "next/navigation"

export function GtmNoscript() {
  const pathname = usePathname()
  const { trackingScripts } = useOrgWhiteLabelContext()

  if (isTrackingBlockedPath(pathname)) return null

  const gtmId =
    trackingScripts?.enabled && trackingScripts.gtmContainerId
      ? trackingScripts.gtmContainerId
      : null

  if (!gtmId) return null

  return (
    <noscript>
      <iframe
        src={`https://www.googletagmanager.com/ns.html?id=${gtmId}`}
        height="0"
        width="0"
        style={{ display: "none", visibility: "hidden" }}
      />
    </noscript>
  )
}
