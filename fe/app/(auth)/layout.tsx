'use client'

import { AppVersionStrip } from "@/components/site/app-version-strip"

export default function Auth2Layout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      <div className="min-h-screen bg-background pb-10">{children}</div>
      <AppVersionStrip />
    </>
  )
}
