"use client"

import { Button, type ButtonProps } from "@/components/ui/button"
import { cn } from "@/lib/utils/cn"
import { isSignupDisabled } from "@/lib/utils/domain-name-helper-client"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import * as React from "react"

const outlinePrimaryStyle = (primaryColor: string) =>
  ({
    backgroundColor: "hsl(var(--background))",
    borderColor: primaryColor,
    color: primaryColor,
  }) as const

export function PublicHeaderAuthButtons({
  primaryColor,
  className,
  showBackInsteadOfSignup = false,
}: {
  primaryColor: string
  className?: string
  /** When true, show Back (browser history) instead of Sign up — e.g. site-landing after external main site. */
  showBackInsteadOfSignup?: boolean
}) {
  const router = useRouter()

  const handleBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back()
      return
    }
    router.push("/")
  }

  return (
    <div className={cn("flex items-center gap-2 sm:gap-3", className)}>
      {showBackInsteadOfSignup ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleBack}
          className="transition-none"
          style={outlinePrimaryStyle(primaryColor)}
          aria-label="Go back"
        >
          <ArrowLeft className="h-4 w-4 shrink-0" />
          Back
        </Button>
      ) : (
        !isSignupDisabled() && (
          <Button
            variant="outline"
            size="sm"
            asChild
            className="transition-none"
            style={outlinePrimaryStyle(primaryColor)}
          >
            <Link href="/register">Sign up</Link>
          </Button>
        )
      )}
      <Button
        size="sm"
        className="transition-none text-white"
        style={{
          backgroundColor: primaryColor,
          color: "#ffffff",
        }}
        asChild
      >
        <Link href="/login">Sign In</Link>
      </Button>
    </div>
  )
}

export type PublicOrgPrimaryButtonProps = ButtonProps & {
  primaryColor: string
}

export const PublicOrgPrimaryButton = React.forwardRef<
  HTMLButtonElement,
  PublicOrgPrimaryButtonProps
>(function PublicOrgPrimaryButton(
  { primaryColor, className, style, ...props },
  ref
) {
  return (
    <Button
      ref={ref}
      className={cn("transition-none text-white", className)}
      style={{
        backgroundColor: primaryColor,
        color: "#ffffff",
        ...style,
      }}
      {...props}
    />
  )
})
