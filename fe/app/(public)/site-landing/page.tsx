'use client'

import { PublicHeaderAuthButtons } from '@/components/auth/public-org-auth-buttons'
import { SiteLandingDefaultHero } from '@/components/site/site-landing-default-hero'
import { useOrgWhiteLabelData } from '@/lib/hooks/use-org-white-label-data'
import { Loader2 } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useState } from 'react'

export default function SiteLandingPage() {
  const { logoUrl, name, primaryColor, secondaryColor, accentColor, isLoading: orgLoading } =
    useOrgWhiteLabelData()
  const [isClient, setIsClient] = useState(false)

  useEffect(() => {
    setIsClient(true)
  }, [])

  const isPageLoading = !isClient || orgLoading

  if (isPageLoading) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center"
        style={{
          background: `linear-gradient(135deg, ${primaryColor}08, ${accentColor}15, ${secondaryColor}12)`,
        }}
      >
        <div className="text-center">
          <Loader2
            className="h-12 w-12 animate-spin mx-auto mb-4"
            style={{ color: primaryColor }}
          />
          <h2 className="text-xl font-semibold text-foreground mb-2">Loading</h2>
          <p className="text-muted-foreground">One moment.</p>
        </div>
      </div>
    )
  }

  const organizationName = name || 'Platform'
  const organizationLogo = logoUrl || '/images/logo.png'

  const dynamicStyles = {
    primaryText: {
      color: primaryColor,
    },
  }

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{
        background: `linear-gradient(135deg, ${primaryColor}08, ${accentColor}15, ${secondaryColor}12)`,
      }}
    >
      <header className="bg-card/80 backdrop-blur-sm border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <Link href="/" className="flex items-center space-x-3 hover:opacity-80 transition-opacity">
              <Image
                src={organizationLogo}
                alt={`${organizationName} logo`}
                width={48}
                height={48}
                className="rounded-lg size-12 object-contain shrink-0"
              />
              <span className="text-xl font-bold text-foreground">{organizationName}</span>
            </Link>
            <PublicHeaderAuthButtons primaryColor={primaryColor} />
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 w-full">
        <SiteLandingDefaultHero
          organizationName={organizationName}
          primaryColor={primaryColor}
          secondaryColor={secondaryColor}
          accentColor={accentColor}
        />
      </main>

      <footer className="bg-card/80 backdrop-blur-sm border-t border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="text-center text-muted-foreground">
            <p>
              &copy; {new Date().getFullYear()} {organizationName}. All rights reserved.
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
              <Link href="/contact" className="hover:opacity-80 transition-opacity" style={dynamicStyles.primaryText}>
                Contact us
              </Link>
              <Link href="/terms-of-use" className="hover:opacity-80 transition-opacity" style={dynamicStyles.primaryText}>
                Terms of Use
              </Link>
              <Link href="/privacy-policy" className="hover:opacity-80 transition-opacity" style={dynamicStyles.primaryText}>
                Privacy Policy
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
