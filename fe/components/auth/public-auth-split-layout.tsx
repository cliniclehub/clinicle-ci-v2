"use client"

import Image from "next/image"
import Link from "next/link"
import { Loader2 } from "lucide-react"
import { useOrgWhiteLabelData } from "@/lib/hooks/use-org-white-label-data"

interface PublicAuthSplitLayoutProps {
  children: React.ReactNode
  /** Left panel headline (defaults to org welcome) */
  headline?: string
  /** Left panel supporting text */
  description?: string
}

export function PublicAuthSplitLayout({
  children,
  headline,
  description,
}: PublicAuthSplitLayoutProps) {
  const { logoUrl, name, isLoading: orgLoading } = useOrgWhiteLabelData()

  if (orgLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    )
  }

  const leftHeadline = headline ?? (name ? `Welcome to ${name}` : "Welcome")
  const leftDescription =
    description ?? "Use the link you received to respond — no sign-in required."

  return (
    <div className="flex min-h-screen bg-background">
      <div className="hidden md:flex md:w-1/2 bg-card p-8 flex-col justify-center">
        <div className="max-w-md mx-auto">
          <Link
            href="/"
            className="block cursor-pointer mb-8 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-lg w-fit"
          >
            <Image
              src={logoUrl || "/images/logo.png"}
              alt={name || "Organization logo"}
              width={200}
              height={200}
              className="h-auto"
              priority
            />
          </Link>
          <h1 className="text-4xl font-bold mb-6">{leftHeadline}</h1>
          <p className="text-xl text-muted-foreground">{leftDescription}</p>
        </div>
      </div>

      <div className="w-full md:w-1/2 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          <Link
            href="/"
            className="md:hidden flex justify-center mb-6 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-lg"
          >
            <Image
              src={logoUrl || "/images/logo.png"}
              alt={name || "Organization logo"}
              width={200}
              height={200}
              className="h-auto"
              priority
            />
          </Link>
          {children}
        </div>
      </div>
    </div>
  )
}
