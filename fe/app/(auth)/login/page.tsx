'use client'

import { Eye, EyeOff, Loader2 } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { PublicOrgPrimaryButton } from '@/components/auth/public-org-auth-buttons'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AlertCircle } from 'lucide-react'

import { OAuthButtons } from '@/components/auth/oauth-buttons'
import { LanguageSwitcher } from '@/components/site/language-switcher'
import * as authActions from '@/lib/actions/auth/auth-public-actions'
import { getPublicOrganizationData } from '@/lib/actions/organizations/organizations-org-actions'
import { getCurrentUser } from '@/lib/actions/users/users-me-actions'
import { useAuth } from '@/lib/contexts/auth-context'
import { useLanguage } from '@/lib/contexts/language-context'
import { useOrgWhiteLabelData } from '@/lib/hooks/use-org-white-label-data'
import { formatDateTime } from '@/lib/utils/date-time-helper'
import { getDomainClient, isSignupDisabled } from '@/lib/utils/domain-name-helper-client'
import { createClientLogger } from '@/lib/utils/logger-client'
import { resolvePostAuthRedirect, sanitizeReturnUrl } from '@/lib/utils/return-url-helper'
import { getRoleLandingPage } from '@/lib/utils/role-hierarchy'
import { toast } from 'sonner'

const logger = createClientLogger('LoginPage')

// Device info utility function
// Device info for session display (browser, OS, device). No IP: backend derives country/continent from request for privacy (GDPR).
const getDeviceInfo = async (): Promise<{ browser?: string; os?: string; device?: string; hostname?: string }> => {
  if (typeof window === 'undefined') {
    return {}
  }

  const userAgent = window.navigator.userAgent

  let browser = 'Unknown'
  if (userAgent.includes('Chrome')) browser = 'Chrome'
  else if (userAgent.includes('Safari')) browser = 'Safari'
  else if (userAgent.includes('Firefox')) browser = 'Firefox'
  else if (userAgent.includes('Edge')) browser = 'Edge'

  let os = 'Unknown'
  if (userAgent.includes('Windows')) os = 'Windows'
  else if (userAgent.includes('Mac')) os = 'macOS'
  else if (userAgent.includes('Linux')) os = 'Linux'
  else if (/Android/.test(userAgent)) os = 'Android'
  else if (/iPhone|iPad|iPod/.test(userAgent)) os = 'iOS'

  const hostname = typeof window !== 'undefined' ? window.location.hostname : 'Unknown'

  let device = 'Desktop'
  if (/Mobile|Android|iPhone|iPad|iPod/.test(userAgent)) {
    device = 'Mobile'
  } else if (/Tablet|iPad/.test(userAgent)) {
    device = 'Tablet'
  }

  return { browser, os, device, hostname }
}

// Authentication guard component to prevent flash
function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { isAuthenticated, isLoading: authLoading } = useAuth()
  const [shouldRender, setShouldRender] = useState(false)
  
  useEffect(() => {
    // Check for auth token immediately
    const hasAuthToken = document.cookie.includes('auth2_access_token=')
    
    if (hasAuthToken) {
      // If we have a token, wait for auth context to determine status
      if (!authLoading) {
        if (isAuthenticated) {
          // User is authenticated, but we need to wait for user data to determine role-based redirect
          // The login handler will take care of the redirect after user data is loaded
          // Just render the login page (which will be hidden/redirected by the main login component)
          setShouldRender(true)
          return
        } else {
          // Token exists but user not authenticated (expired/invalid or just logged out)
          // Wait a bit for cookies to be cleared, then render
          setTimeout(() => {
            setShouldRender(true)
          }, 100)
        }
      }
      // Still loading auth context, don't render yet
    } else {
      // No token, safe to render login form immediately
      setShouldRender(true)
    }
  }, [isAuthenticated, authLoading, router, searchParams])
  
  // Don't render anything until we've determined it's safe
  if (!shouldRender) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Checking authentication...</p>
        </div>
      </div>
    )
  }
  
  return <>{children}</>
}

export default function LoginPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { isAuthenticated, isLoading: authLoading, setUser } = useAuth()
  const { logoUrl, name, primaryColor, isLoading: orgLoading } = useOrgWhiteLabelData()
  const { t, language } = useLanguage()
  
  // Form state
  const [email, setEmail] = useState(searchParams.get('email') || '')
  const safePendingReturnUrl = sanitizeReturnUrl(searchParams.get('returnUrl'))
  const registerHref = safePendingReturnUrl
    ? `/register?returnUrl=${encodeURIComponent(safePendingReturnUrl)}`
    : '/register'

  // Already signed in (e.g. opened login link with returnUrl) — go back to intended page
  useEffect(() => {
    if (authLoading || !isAuthenticated || !safePendingReturnUrl) return
    router.replace(safePendingReturnUrl)
  }, [authLoading, isAuthenticated, safePendingReturnUrl, router])
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  
  // Handle OAuth callback: cookies are already set, run post-login orchestration
  useEffect(() => {
    if (searchParams.get('oauth') !== 'success') return

    let cancelled = false
    ;(async () => {
      try {
        // Refresh auth context so it picks up the new cookies
        const result = await authActions.loadCurrentUser()
        if (cancelled) return
        if (!result.success) {
          setError('OAuth login failed. Please try again.')
          return
        }
        setUser(result.user)
        toast.success('Login successful')

        const [userResponse, orgResponse, phoneStatusResponse] = await Promise.all([
          getCurrentUser(),
          getPublicOrganizationData(),
          import('@/lib/actions/users/phone-verification-actions')
            .then((m) => m.getPhoneVerificationStatus())
            .catch(() => ({ status: 'error' as const, message: 'Failed' })),
        ])
        if (cancelled) return

        const user = userResponse.status === 'success' ? userResponse.data : result.user
        const organization = orgResponse.status === 'success' ? orgResponse.data : null
        const phoneVerificationStatus =
          phoneStatusResponse.status === 'success' ? phoneStatusResponse.data : null

        const safeReturn = sanitizeReturnUrl(searchParams.get('returnUrl'))
        const redirectPath = resolvePostAuthRedirect({
          user,
          organization,
          phoneVerificationStatus,
          returnUrl: safeReturn,
        })

        router.push(redirectPath)
      } catch (err) {
        if (!cancelled) {
          logger.error('OAuth post-login redirect failed', err as Error)
          router.push(getRoleLandingPage('user'))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [searchParams, router, setUser])

  // Handle OAuth error from callback
  useEffect(() => {
    const oauthError = searchParams.get('error')
    if (oauthError && !searchParams.get('oauth')) {
      setError(decodeURIComponent(oauthError))
    }
  }, [searchParams])
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)
    
    try {
      // Get device info and domain
      const deviceInfo = await getDeviceInfo()
      const domain = getDomainClient()
      
      // Call login action directly
      const response = await authActions.loginUser({
        email,
        password,
        orgDomain: domain,
        deviceInfo
      })
      
      // Check if login was successful
      if (!response.success) {
        logger.warn('Login failed:', response.error)
        let message = response.error
        if (response.lockedUntil) {
          const when = formatDateTime(response.lockedUntil, undefined, language)
          if (when) {
            message = `${message} Try again at ${when}.`
          }
        }
        setError(message)
        return
      }
      
      // Set user in context
      setUser(response.user)
      
      toast.success('Login successful')
      
      // Handle routing based on profile completion requirements
      setTimeout(async () => {
        try {
          // Fetch full user profile, organization data, and phone verification status
          const [userResponse, orgResponse, phoneStatusResponse] = await Promise.all([
            getCurrentUser(),
            getPublicOrganizationData(),
            // Import dynamically to avoid circular dependencies
            import('@/lib/actions/users/phone-verification-actions').then(m => m.getPhoneVerificationStatus()).catch(() => ({ status: 'error' as const, message: 'Failed to check phone verification' }))
          ])
          
          const user = userResponse.status === 'success' ? userResponse.data : response.user
          const organization = orgResponse.status === 'success' ? orgResponse.data : null
          const phoneVerificationStatus = phoneStatusResponse.status === 'success' ? phoneStatusResponse.data : null
          
          const safeReturn = sanitizeReturnUrl(searchParams.get('returnUrl'))
          const redirectPath = resolvePostAuthRedirect({
            user,
            organization,
            phoneVerificationStatus,
            returnUrl: safeReturn,
          })
          
          logger.info('Login redirect determined', {
            userId: user.id,
            redirectPath,
            returnUrl: safeReturn ?? undefined,
            hasOrganization: !!organization,
          })
          
          router.push(redirectPath)
        } catch (error) {
          logger.error('Error determining login redirect', error as Error)
          // Fallback to role-based redirect if profile check fails
          const fallbackReturn = sanitizeReturnUrl(searchParams.get('returnUrl'))
          if (fallbackReturn) {
            router.push(fallbackReturn)
          } else {
            // Fall back to the shared user dashboard when role resolution fails.
            router.push(getRoleLandingPage('user'))
          }
        }
      }, 100)
      
    } catch (error: any) {
      logger.error('Login error:', error)
      setError(error.message || 'Invalid email or password')
    } finally {
      setIsLoading(false)
    }
  }
  
  // Show loading while checking org data
  if (orgLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <AuthGuard>
      <div className="flex min-h-screen">
      {/* Left side - Branding */}
      <div className="hidden md:flex md:w-1/2 bg-card p-8 flex-col justify-center">
        <div className="max-w-md mx-auto">
          <Link href="/" className="block cursor-pointer mb-8 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-lg w-fit">
            <Image
              src={logoUrl || '/images/logo.png'}
              alt={name || "Organization logo"}
              width={200}
              height={200}
              className="h-auto"
              priority
            />
          </Link>

          <h1 className="text-4xl font-bold mb-6">
            {name ? t("auth.welcomeTo", { name }) : t("auth.welcome")}
          </h1>

          <p className="text-xl text-muted-foreground mb-8">
            {t("auth.loginHeroSubtitle")}
          </p>

          <div className="space-y-6">
            <div className="flex items-start gap-4">
              <div className="flex items-center justify-center rounded-full bg-muted w-10 h-10 shrink-0 text-foreground font-semibold">
                1
              </div>
              <div>
                <h3 className="font-medium">{t("auth.loginStep1Title")}</h3>
                <p className="text-muted-foreground text-sm">{t("auth.loginStep1Body")}</p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="flex items-center justify-center rounded-full bg-muted w-10 h-10 shrink-0 text-foreground font-semibold">
                2
              </div>
              <div>
                <h3 className="font-medium">{t("auth.loginStep2Title")}</h3>
                <p className="text-muted-foreground text-sm">{t("auth.loginStep2Body")}</p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="flex items-center justify-center rounded-full bg-muted w-10 h-10 shrink-0 text-foreground font-semibold">
                3
              </div>
              <div>
                <h3 className="font-medium">{t("auth.loginStep3Title")}</h3>
                <p className="text-muted-foreground text-sm">{t("auth.loginStep3Body")}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right side - Login form */}
      <div className="w-full md:w-1/2 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          {/* Logo for mobile - clickable to home */}
          <Link href="/" className="md:hidden flex justify-center mb-6 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-lg">
            <Image
              src={logoUrl || '/images/logo.png'}
              alt={name || "Organization logo"}
              width={200}
              height={200}
              className="h-auto"
              priority
            />
          </Link>
          <div className="bg-card text-card-foreground rounded-lg shadow-md p-8">
            <div className="flex justify-end mb-4">
              <LanguageSwitcher />
            </div>
            <h2 className="text-2xl font-bold text-center mb-2">
              {t("auth.loginStep1Title")}
            </h2>
            <p className="text-muted-foreground text-center mb-6">
              {t("auth.loginSubtitle")}
            </p>
            
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="space-y-2">
                    <div>{error}</div>
                    {error.toLowerCase().includes('email not verified') && email && (
                      <div className="mt-2 pt-2 border-t border-destructive/20">
                        <p className="text-sm mb-2">
                          You can verify your email by entering the code from your email, or request a new code if it has expired.
                        </p>
                        <Link
                          href={(() => {
                            const p = new URLSearchParams()
                            p.set('email', email)
                            if (safePendingReturnUrl) p.set('returnUrl', safePendingReturnUrl)
                            return `/verify-email?${p.toString()}`
                          })()}
                          className="text-sm font-medium underline hover:no-underline"
                        >
                          Go to Email Verification →
                        </Link>
                      </div>
                    )}
                  </AlertDescription>
                </Alert>
              )}
              
              <div className="space-y-2">
                <Label htmlFor="email">{t("auth.email")}</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t("auth.enterEmail")}
                  required
                  disabled={isLoading}
                  autoComplete="email"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="password">{t("auth.password")}</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t("auth.enterPassword")}
                    required
                    disabled={isLoading}
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute end-3 top-1/2 transform -translate-y-1/2"
                    disabled={isLoading}
                    aria-label={showPassword ? t("auth.hidePassword") : t("auth.showPassword")}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              
              <PublicOrgPrimaryButton
                type="submit"
                primaryColor={primaryColor}
                className="w-full"
                disabled={isLoading || authLoading}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="me-2 h-4 w-4 animate-spin" />
                    {t("auth.signingIn")}
                  </>
                ) : (
                  t("auth.signIn")
                )}
              </PublicOrgPrimaryButton>
              
              <div className="text-center space-y-2">
                <Link
                  href="/forgot-password"
                  className="text-sm text-muted-foreground hover:text-foreground"
                >
                  {t("auth.forgotPassword")}
                </Link>
                {!isSignupDisabled() && (
                  <div className="text-sm text-muted-foreground">
                    {t("auth.noAccount")}{" "}
                    <Link
                      href={registerHref}
                      className="text-foreground hover:text-foreground font-medium"
                    >
                      {t("auth.signUp")}
                    </Link>
                  </div>
                )}
              </div>
            </form>

            <div className="mt-4">
              <OAuthButtons
                disabled={isLoading || authLoading}
                returnUrl={safePendingReturnUrl}
              />
            </div>

            <div className="mt-6 text-center text-xs text-muted-foreground">
              By continuing, you agree to our{" "}
              <Link href="/terms-of-use" className="text-muted-foreground underline">
                Terms of Use
              </Link>{" "}
              and{" "}
              <Link href="/privacy-policy" className="text-muted-foreground underline">
                Privacy Policy
              </Link>
              .
            </div>
            <div className="mt-4 text-center text-xs text-muted-foreground">
              <Link href="/contact" className="text-muted-foreground underline hover:text-foreground">
                Contact us
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
    </AuthGuard>
  )
}
