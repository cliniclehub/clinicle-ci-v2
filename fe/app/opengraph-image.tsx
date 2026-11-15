import { ImageResponse } from "next/og"
import { DEFAULT_APP_NAME } from "@/lib/config/app-brand"

export const alt = DEFAULT_APP_NAME
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

/**
 * Default Open Graph image for link previews (WhatsApp, iMessage, Slack, Facebook, etc.).
 * Crawlers fetch this via absolute URL; set NEXT_PUBLIC_BASE_URL in each environment.
 */
export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#0f172a",
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 56,
            fontWeight: 700,
            color: "#f8fafc",
            textAlign: "center",
            padding: "0 72px",
            lineHeight: 1.15,
          }}
        >
          {DEFAULT_APP_NAME}
        </div>
        <div
          style={{
            marginTop: 20,
            display: "flex",
            fontSize: 26,
            color: "#94a3b8",
          }}
        >
          Multi-tenant product foundation
        </div>
      </div>
    ),
    { ...size }
  )
}
