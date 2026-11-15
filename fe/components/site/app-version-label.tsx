"use client"

import { formatAppVersionLabel } from "@/lib/build-info"

type AppVersionLabelProps = {
  className?: string
}

export function AppVersionLabel({ className = "" }: AppVersionLabelProps) {
  const label = formatAppVersionLabel()
  if (!label) return null

  return (
    <p
      className={`text-[10px] leading-tight text-muted-foreground/70 truncate ${className}`}
      title="Release · build"
    >
      {label}
    </p>
  )
}
