"use client"

import Image from "next/image"
import Link from "next/link"

import { PublicHeaderAuthButtons } from "@/components/auth/public-org-auth-buttons"
import { useAuth } from "@/lib/contexts/auth-context"
import { useOrgWhiteLabelData } from "@/lib/hooks/use-org-white-label-data"
import { isSignupDisabled } from "@/lib/utils/domain-name-helper-client"
import { Loader2 } from "lucide-react"

export const PUBLIC_ORG_PAGE_WIDTH_CLASS = "max-w-7xl mx-auto px-4 sm:px-6 lg:px-8"

interface PublicOrgPageShellProps {
  children: React.ReactNode
  showFooter?: boolean
}

export function PublicOrgPageShell({ children, showFooter = true }: PublicOrgPageShellProps) {
  const { user, isLoading: authLoading } = useAuth()
  const { logoUrl, name, primaryColor, isLoading: orgLoading } = useOrgWhiteLabelData()

  if (orgLoading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background">
        <Loader2 className="mb-4 h-10 w-10 animate-spin text-muted-foreground" />
        <p className="text-muted-foreground">Loading…</p>
      </div>
    )
  }

  const organizationName = name || "Organization"
  const organizationLogo = logoUrl || "/images/logo.png"

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b bg-card shadow-sm">
        <div className={PUBLIC_ORG_PAGE_WIDTH_CLASS}>
          <div className="flex items-center justify-between gap-4 py-4">
            <Link href="/" className="flex min-w-0 items-center gap-3 transition-opacity hover:opacity-80">
              <Image
                src={organizationLogo}
                alt={`${organizationName} logo`}
                width={48}
                height={48}
                className="size-12 shrink-0 rounded-lg object-contain"
              />
              <span className="truncate text-lg font-semibold text-foreground">{organizationName}</span>
            </Link>
            {!authLoading && (
              <PublicHeaderAuthButtons
                primaryColor={primaryColor}
                showBackInsteadOfSignup={Boolean(user) || isSignupDisabled()}
              />
            )}
          </div>
        </div>
      </header>

      <main className={`flex-1 ${PUBLIC_ORG_PAGE_WIDTH_CLASS} w-full py-8`}>{children}</main>

      {showFooter && (
        <footer className="border-t border-border bg-card/80 backdrop-blur-sm">
          <div className={`${PUBLIC_ORG_PAGE_WIDTH_CLASS} py-8`}>
            <div className="text-center text-muted-foreground">
              <p>
                &copy; {new Date().getFullYear()} {organizationName}. All rights reserved.
              </p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
                <Link
                  href="/contact"
                  className="transition-opacity hover:opacity-80"
                  style={{ color: primaryColor }}
                >
                  Contact us
                </Link>
                <Link
                  href="/terms-of-use"
                  className="transition-opacity hover:opacity-80"
                  style={{ color: primaryColor }}
                >
                  Terms of Use
                </Link>
                <Link
                  href="/privacy-policy"
                  className="transition-opacity hover:opacity-80"
                  style={{ color: primaryColor }}
                >
                  Privacy Policy
                </Link>
              </div>
            </div>
          </div>
        </footer>
      )}
    </div>
  )
}
