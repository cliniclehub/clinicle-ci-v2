import { MainLayout } from "@/components/site/main-layout"
import { RoleProvider } from "@/lib/contexts/role-context"
import type React from "react"

/**
 * LanguageProvider lives in AppProviders (root layout) so locale cookie + html
 * lang/dir stay in sync. Do not nest another LanguageProvider here.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <RoleProvider>
      <MainLayout>{children}</MainLayout>
    </RoleProvider>
  )
}
