'use client'

import { type CountryCode } from 'libphonenumber-js'
import { ArrowLeft, Eye, EyeOff, Loader2 } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { PublicOrgPrimaryButton } from '@/components/auth/public-org-auth-buttons'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PhoneInput } from '@/components/ui/phone-input'
import { AlertCircle } from 'lucide-react'

import { OAuthButtons } from '@/components/auth/oauth-buttons'
import { LanguageSwitcher } from '@/components/site/language-switcher'
import { registerUser } from '@/lib/actions/auth/auth-public-actions'
import { getPublicOrganizationData } from '@/lib/actions/organizations/organizations-org-actions'
import { getCurrentUser } from '@/lib/actions/users/users-me-actions'
import { resolveCountryCodeForPhone } from '@/lib/constants/phone-countries'
import { useAuth } from '@/lib/contexts/auth-context'
import { useLanguage } from '@/lib/contexts/language-context'
import { useRoles } from '@/lib/contexts/role-context'
import { useOrgWhiteLabelData } from '@/lib/hooks/use-org-white-label-data'
import { createClientLogger } from '@/lib/utils/logger-client'
import {
  hasInsufficientPersonNameLetters,
  looksLikeIncompletePersonName,
  normalizePersonName,
  PERSON_NAME_TOO_SHORT_MESSAGE,
  SHORT_PERSON_NAME_WARNING,
} from '@/lib/utils/name-utils'
import { getDefaultLandingPage } from '@/lib/utils/navigation-helper'
import { getRoleLandingPage } from '@/lib/utils/role-hierarchy'
import { buildPhoneE164, getPhoneValidationError, normalizePhoneToE164 } from '@/lib/utils/phone-validation'
import { validateEmailAddress } from '@/lib/utils/email-validation'
import { resolvePostAuthRedirect, sanitizeReturnUrl, withReturnUrl } from '@/lib/utils/return-url-helper'

const logger = createClientLogger('Register2Page')

export default function Register2Page() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const safeReturnUrl = sanitizeReturnUrl(searchParams.get('returnUrl'))
  const loginHref = safeReturnUrl ? withReturnUrl('/login', safeReturnUrl) : '/login'
  const { isAuthenticated, isLoading: authLoading } = useAuth()
  const { activeRole, isLoading: rolesLoading } = useRoles()
  const { logoUrl, name, primaryColor, isLoading: orgLoading, org } = useOrgWhiteLabelData()
  const { t } = useLanguage()
  
  // Form state
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    firstName: '',
    lastName: '',
  })
  const [phoneCountry, setPhoneCountry] = useState<CountryCode>(() =>
    resolveCountryCodeForPhone(undefined)
  )
  const [phoneNational, setPhoneNational] = useState('')
  const phoneCountryTouched = useRef(false)
  
  // Check if phone validation is required
  const requiresPhoneValidation = org?.enforcePhoneValidation || false

  useEffect(() => {
    if (phoneCountryTouched.current || !org?.country) return
    setPhoneCountry(resolveCountryCodeForPhone(org.country))
  }, [org?.country])
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [passwordErrors, setPasswordErrors] = useState<string[]>([])
  // Redirect if already authenticated (wait for roles so we don't use a stale null activeRole)
  useEffect(() => {
    if (!isAuthenticated || authLoading || rolesLoading) return

    let cancelled = false
    ;(async () => {
      try {
        const [userResponse, orgResponse, phoneStatusResponse] = await Promise.all([
          getCurrentUser(),
          getPublicOrganizationData(),
          import('@/lib/actions/users/phone-verification-actions').then((m) =>
            m.getPhoneVerificationStatus()
          ).catch(() => ({ status: 'error' as const, message: 'Failed to check phone verification' })),
        ])
        if (cancelled) return

        const user = userResponse.status === 'success' ? userResponse.data : null
        const organization = orgResponse.status === 'success' ? orgResponse.data : null
        const phoneVerificationStatus =
          phoneStatusResponse.status === 'success' ? phoneStatusResponse.data : null

        if (!user) {
          router.push(getDefaultLandingPage(activeRole))
          return
        }

        const path = resolvePostAuthRedirect({
          user,
          organization,
          phoneVerificationStatus,
          returnUrl: safeReturnUrl,
        })
        router.push(path)
      } catch (err) {
        logger.error('Register page: authenticated redirect failed', err as Error)
        if (!cancelled) router.push(getDefaultLandingPage(activeRole))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [isAuthenticated, authLoading, rolesLoading, router, activeRole, safeReturnUrl])
  
  // Password validation
  const validatePassword = (password: string): string[] => {
    const errors: string[] = []
    if (password.length < 8) {
      errors.push('Password must be at least 8 characters long')
    }
    if (!/[A-Z]/.test(password)) {
      errors.push('Password must contain at least one uppercase letter')
    }
    if (!/[a-z]/.test(password)) {
      errors.push('Password must contain at least one lowercase letter')
    }
    if (!/\d/.test(password)) {
      errors.push('Password must contain at least one number')
    }
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
      errors.push('Password must contain at least one special character')
    }
    return errors
  }
  
  const handleBackFromRegister = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back()
      return
    }
    router.push("/site-landing")
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
    
    // Validate password as user types
    if (name === 'password') {
      const errors = validatePassword(value)
      setPasswordErrors(errors)
    }
  }
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    
    // Validate form
    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match')
      return
    }
    
    const passwordValidationErrors = validatePassword(formData.password)
    if (passwordValidationErrors.length > 0) {
      setPasswordErrors(passwordValidationErrors)
      return
    }

    const emailValidation = validateEmailAddress(formData.email)
    if (!emailValidation.ok) {
      setError(emailValidation.message)
      return
    }

    if (
      hasInsufficientPersonNameLetters(formData.firstName) ||
      hasInsufficientPersonNameLetters(formData.lastName)
    ) {
      setError(PERSON_NAME_TOO_SHORT_MESSAGE)
      return
    }

    let normalizedPhone: string | undefined
    if (requiresPhoneValidation) {
      const phoneCandidate = buildPhoneE164(phoneCountry, phoneNational)
      const validationError = getPhoneValidationError(phoneCandidate)
      if (validationError) {
        setError(validationError)
        return
      }
      normalizedPhone = normalizePhoneToE164(phoneCandidate) ?? undefined
      if (!normalizedPhone) {
        setError('Invalid phone number for the selected country')
        return
      }
    }

    setIsLoading(true)
    
    try {
      // Get orgDomain from the current domain or use a default
      const orgDomain = window.location.hostname
      
      const response = await registerUser({
        email: formData.email,
        password: formData.password,
        firstName: normalizePersonName(formData.firstName),
        lastName: normalizePersonName(formData.lastName),
        orgDomain: orgDomain,
        phoneNumber: normalizedPhone
      })
      
      if (response.status === 'error') {
        setError(response.message || 'Registration failed')
        return
      }
      
      if (response.data?.requiresVerification) {
        // Redirect to email verification page with email parameter
        // Phone verification will be handled after login
        const params = new URLSearchParams({ email: formData.email })
        const returnAfterVerify = safeReturnUrl
        if (returnAfterVerify) params.set('returnUrl', returnAfterVerify)
        router.push(`/verify-email?${params.toString()}`)
      } else {
        // Registration successful — align with login: profile gates first, then role-based path
        setTimeout(async () => {
          try {
            const [userResponse, orgResponse, phoneStatusResponse] = await Promise.all([
              getCurrentUser(),
              getPublicOrganizationData(),
              import("@/lib/actions/users/phone-verification-actions").then((m) =>
                m.getPhoneVerificationStatus()
              ).catch(() => ({ status: "error" as const, message: "Failed to check phone verification" })),
            ])
            const user = userResponse.status === "success" ? userResponse.data : null
            const organization = orgResponse.status === "success" ? orgResponse.data : null
            const phoneVerificationStatus =
              phoneStatusResponse.status === "success" ? phoneStatusResponse.data : null

            if (!user) {
              router.push(getRoleLandingPage('user'))
              return
            }

            const redirectPath = resolvePostAuthRedirect({
              user,
              organization,
              phoneVerificationStatus,
              returnUrl: safeReturnUrl,
            })

            router.push(redirectPath)
          } catch (err) {
            logger.error("Post-registration redirect failed", err as Error)
            router.push(getRoleLandingPage('user'))
          }
        }, 0)
      }
    } catch (error: any) {
      logger.error('Registration error:', error)
      setError(error.message || 'Registration failed')
    } finally {
      setIsLoading(false)
    }
  }
  
  // Show loading while checking auth or org data
  if (authLoading || orgLoading) {
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
    <div className="flex min-h-screen">
      {/* Left side - Branding */}
      <div className="hidden md:flex md:w-1/2 bg-card p-8 flex-col justify-center">
        <div className="max-w-md mx-auto">
          <Link
            href="/"
            className="mb-8 inline-block hover:opacity-80 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-lg"
            aria-label="Go to home page"
          >
            <Image
              src={logoUrl || '/images/logo.png'}
              alt={name || "Organization logo"}
              width={200}
              height={200}
              className="h-auto"
            />
          </Link>

          <h1 className="text-4xl font-bold mb-6">
            {name ? t("auth.joinOrg", { name }) : t("auth.createYourAccount")}
          </h1>

          <p className="text-xl text-muted-foreground mb-8">
            {t("auth.registerHeroSubtitle")}
          </p>

          <div className="space-y-6">
            <div className="flex items-start gap-4">
              <div className="flex items-center justify-center rounded-full bg-muted w-10 h-10 shrink-0 text-foreground font-semibold">
                1
              </div>
              <div>
                <h3 className="font-medium">{t("auth.registerStep1Title")}</h3>
                <p className="text-muted-foreground text-sm">{t("auth.registerStep1Body")}</p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="flex items-center justify-center rounded-full bg-muted w-10 h-10 shrink-0 text-foreground font-semibold">
                2
              </div>
              <div>
                <h3 className="font-medium">{t("auth.registerStep2Title")}</h3>
                <p className="text-muted-foreground text-sm">{t("auth.registerStep2Body")}</p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="flex items-center justify-center rounded-full bg-muted w-10 h-10 shrink-0 text-foreground font-semibold">
                3
              </div>
              <div>
                <h3 className="font-medium">{t("auth.registerStep3Title")}</h3>
                <p className="text-muted-foreground text-sm">{t("auth.registerStep3Body")}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right side - Registration form */}
      <div className="w-full md:w-1/2 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          <div className="bg-card text-card-foreground rounded-lg shadow-md p-8">
            <div className="flex items-center justify-between mb-6">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleBackFromRegister}
                aria-label="Go back"
              >
                <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
              </Button>
              <LanguageSwitcher />
            </div>

            <h2 className="text-2xl font-bold text-center mb-2">
              {t("auth.registerStep1Title")}
            </h2>
            <p className="text-muted-foreground text-center mb-6">
              {t("auth.registerSubtitle")}
            </p>
            
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="firstName">{t("auth.firstName")}</Label>
                  <Input
                    id="firstName"
                    name="firstName"
                    type="text"
                    value={formData.firstName}
                    onChange={handleChange}
                    placeholder="John"
                    required
                    disabled={isLoading}
                    aria-describedby={
                      looksLikeIncompletePersonName(formData.firstName)
                        ? 'firstName-short-warning'
                        : undefined
                    }
                  />
                  {looksLikeIncompletePersonName(formData.firstName) ? (
                    <p
                      id="firstName-short-warning"
                      className="text-sm text-amber-700 dark:text-amber-400"
                    >
                      {SHORT_PERSON_NAME_WARNING}
                    </p>
                  ) : null}
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="lastName">{t("auth.lastName")}</Label>
                  <Input
                    id="lastName"
                    name="lastName"
                    type="text"
                    value={formData.lastName}
                    onChange={handleChange}
                    placeholder="Doe"
                    required
                    disabled={isLoading}
                    aria-describedby={
                      looksLikeIncompletePersonName(formData.lastName)
                        ? 'lastName-short-warning'
                        : undefined
                    }
                  />
                  {looksLikeIncompletePersonName(formData.lastName) ? (
                    <p
                      id="lastName-short-warning"
                      className="text-sm text-amber-700 dark:text-amber-400"
                    >
                      {SHORT_PERSON_NAME_WARNING}
                    </p>
                  ) : null}
                </div>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="email">{t("auth.email")}</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  value={formData.email}
                  onChange={handleChange}
                  placeholder="john.doe@example.com"
                  required
                  disabled={isLoading}
                  autoComplete="email"
                />
              </div>
              
              {requiresPhoneValidation && (
                <div className="space-y-2">
                  <Label htmlFor="phoneNumber">
                    Phone Number <span className="text-red-500">*</span>
                  </Label>
                  <PhoneInput
                    id="phone-country"
                    inputId="phoneNumber"
                    country={phoneCountry}
                    onCountryChange={(iso) => {
                      phoneCountryTouched.current = true
                      setPhoneCountry(iso)
                      setError('')
                    }}
                    nationalNumber={phoneNational}
                    onNationalNumberChange={(digits) => {
                      setPhoneNational(digits)
                      setError('')
                    }}
                    disabled={isLoading}
                    placeholder="791234567"
                    aria-label="Phone number"
                  />
                  <p id="phoneNumber-hint" className="text-xs text-muted-foreground">
                  Select your country, then enter your local number — no country code, leading zero, or + sign.
                  </p>
                </div>
              )}
              
              <div className="space-y-2">
                <Label htmlFor="password">{t("auth.password")}</Label>
                <div className="relative">
                  <Input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    value={formData.password}
                    onChange={handleChange}
                    placeholder={t("auth.strongPassword")}
                    required
                    disabled={isLoading}
                    autoComplete="new-password"
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
                {passwordErrors.length > 0 && (
                  <div className="text-sm text-red-600 space-y-1">
                    {passwordErrors.map((error, index) => (
                      <p key={index}>• {error}</p>
                    ))}
                  </div>
                )}
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">{t("auth.confirmPassword")}</Label>
                <div className="relative">
                  <Input
                    id="confirmPassword"
                    name="confirmPassword"
                    type={showConfirmPassword ? "text" : "password"}
                    value={formData.confirmPassword}
                    onChange={handleChange}
                    placeholder={t("auth.confirmYourPassword")}
                    required
                    disabled={isLoading}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute end-3 top-1/2 transform -translate-y-1/2"
                    disabled={isLoading}
                    aria-label={showConfirmPassword ? t("auth.hidePassword") : t("auth.showPassword")}
                  >
                    {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
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
                    {t("auth.creatingAccount")}
                  </>
                ) : (
                  t("auth.createAccount")
                )}
              </PublicOrgPrimaryButton>
              
              <div className="text-center">
                <p className="text-sm text-muted-foreground">
                  {t("auth.haveAccount")}{" "}
                  <Link
                    href={loginHref}
                    className="text-foreground hover:text-foreground font-medium"
                  >
                    {t("auth.signIn")}
                  </Link>
                </p>
              </div>
            </form>

            <div className="mt-4">
              <OAuthButtons
                disabled={isLoading || authLoading}
                returnUrl={safeReturnUrl}
              />
            </div>

            <div className="mt-6 text-center text-xs text-muted-foreground">
              By creating an account, you agree to our{" "}
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
  )
}
