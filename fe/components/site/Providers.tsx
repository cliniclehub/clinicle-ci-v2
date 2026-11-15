'use client'

import { ThemeProvider } from '@/components/site/theme-provider'
import { Toaster as SonnerToaster } from '@/components/ui/sonner'
import { LanguageProvider } from '@/lib/contexts/language-context'
import { RoleProvider } from '@/lib/contexts/role-context'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <LanguageProvider>
        <RoleProvider>
          {children}
          <SonnerToaster />
        </RoleProvider>
      </LanguageProvider>
    </ThemeProvider>
  )
}