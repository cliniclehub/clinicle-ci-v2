"use client"

import { AppVersionLabel } from "@/components/site/app-version-label"

/** Fixed strip at viewport bottom — visible on public/auth pages without scrolling past page footers. */
export function AppVersionStrip() {
  return (
    <footer className="fixed bottom-0 inset-x-0 z-30 border-t border-border/80 bg-background/90 backdrop-blur-sm py-1.5 px-3 text-center pointer-events-none">
      <AppVersionLabel className="text-[10px] mx-auto max-w-full" />
    </footer>
  )
}
