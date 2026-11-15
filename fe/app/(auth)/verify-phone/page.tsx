'use client'

import { type CountryCode } from 'libphonenumber-js'
import { Loader2, Phone, RefreshCw, Shield } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PhoneInput } from '@/components/ui/phone-input'
import { AlertCircle } from 'lucide-react'

import { logoutUser } from '@/lib/actions/auth/auth-public-actions'
import { getPublicOrganizationData } from '@/lib/actions/organizations/organizations-org-actions'
import { getPhoneVerificationStatus, sendPhoneVerificationCode, verifyPhoneCode } from '@/lib/actions/users/phone-verification-actions'
import { getCurrentUser } from '@/lib/actions/users/users-me-actions'
import { resolveCountryCodeForPhone } from '@/lib/constants/phone-countries'
import { useAuth } from '@/lib/contexts/auth-context'
import { useOrgWhiteLabelData } from '@/lib/hooks/use-org-white-label-data'
import { handleApiErrorResponse } from '@/lib/utils/api-error-handler'
import { createClientLogger } from '@/lib/utils/logger-client'
import {
  buildPhoneE164,
  getPhoneValidationError,
  normalizePhoneToE164,
  parsePhoneInputValue,
} from '@/lib/utils/phone-validation'
import { resolvePostAuthRedirect, sanitizeReturnUrl, withReturnUrl } from '@/lib/utils/return-url-helper'
import { getRoleLandingPage } from '@/lib/utils/role-hierarchy'

const logger = createClientLogger('VerifyPhonePage')

function WrongAccountHint({
  email,
  onSwitchAccount,
  isSwitching,
}: {
  email: string
  onSwitchAccount: () => void
  isSwitching: boolean
}) {
  return (
    <p className="text-sm text-muted-foreground">
      Verifying for <span className="font-medium text-foreground">{email}</span>. Not the
      right account?{' '}
      <button
        type="button"
        onClick={onSwitchAccount}
        disabled={isSwitching}
        className="underline underline-offset-4 text-muted-foreground hover:text-foreground disabled:opacity-50"
      >
        {isSwitching ? 'Switching account...' : 'Sign in with a different account'}
      </button>
    </p>
  )
}

export default function VerifyPhonePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const returnUrlFromQuery = searchParams.get('returnUrl')
  const { isAuthenticated, isLoading: authLoading, setUser: setAuthUser } = useAuth()
  const { logoUrl, name, isLoading: orgLoading, org } = useOrgWhiteLabelData()
  
  // Get user info from authenticated session
  const [user, setUser] = useState<{ email?: string; phoneNumber?: string } | null>(null)
  const [phoneNumber, setPhoneNumber] = useState('')
  const [isLoadingUser, setIsLoadingUser] = useState(true)
  const [needsPhoneInput, setNeedsPhoneInput] = useState(false)
  const [phoneCountry, setPhoneCountry] = useState<CountryCode>(() =>
    resolveCountryCodeForPhone(undefined)
  )
  const [phoneNational, setPhoneNational] = useState('')
  const phoneCountryTouched = useRef(false)
  const [hadPhoneBeforeChange, setHadPhoneBeforeChange] = useState(false)
  const [isSavingPhone, setIsSavingPhone] = useState(false)
  
  // Form state
  const [code, setCode] = useState(['', '', '', ''])
  const [isLoading, setIsLoading] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [isVerifying, setIsVerifying] = useState(false)
  const [codeSent, setCodeSent] = useState(false)
  const [error, setError] = useState('')
  const [resendTimer, setResendTimer] = useState(0)
  const [isSwitchingAccount, setIsSwitchingAccount] = useState(false)

  const loginAfterSwitchHref = withReturnUrl(
    '/login',
    sanitizeReturnUrl(returnUrlFromQuery)
  )

  const handleSwitchAccount = async () => {
    setIsSwitchingAccount(true)
    setError('')
    try {
      await logoutUser()
      setAuthUser(null)
      window.location.href = loginAfterSwitchHref
    } catch (err) {
      logger.error('Failed to switch account from verify-phone', err as Error)
      setError('Could not switch accounts. Please try again.')
      setIsSwitchingAccount(false)
    }
  }
  
  // Refs for input fields
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])
  
  // Load user data on mount
  useEffect(() => {
    const loadUserData = async () => {
      if (authLoading) return // Wait for auth to finish loading
      
      if (!isAuthenticated) {
        // Redirect to login if not authenticated
        const ru = sanitizeReturnUrl(returnUrlFromQuery)
        router.push(ru ? withReturnUrl('/login', ru) : '/login')
        return
      }
      
      try {
        setIsLoadingUser(true)
        const [userResponse, phoneStatusResponse] = await Promise.all([
          getCurrentUser(),
          getPhoneVerificationStatus()
        ])
        
        if (userResponse.status === 'success' && userResponse.data) {
          const userData = userResponse.data
          setUser({
            email: userData.email,
            phoneNumber: userData.phoneNumber
          })
          
          // Get phone number from user profile or verification status
          const phoneFromStatus = phoneStatusResponse.status === 'success' ? phoneStatusResponse.data?.phoneNumber : null
          const userPhone = userData.phoneNumber || phoneFromStatus || ''
          
          if (!userPhone) {
            // Phone number is missing - show input field instead of error
            setNeedsPhoneInput(true)
            setIsLoadingUser(false)
            return
          }
          
          setPhoneNumber(userPhone)
          setNeedsPhoneInput(false)
          
          // Check if already verified
          const isVerified = phoneStatusResponse.status === 'success' ? phoneStatusResponse.data?.phoneVerified : false
          if (isVerified) {
            // Already verified, redirect to role-based landing page
            const orgResponse = await getPublicOrganizationData()
            const organization = orgResponse.status === 'success' ? orgResponse.data : null
            const redirectPath = resolvePostAuthRedirect({
              user: userData,
              organization,
              phoneVerificationStatus:
                phoneStatusResponse.status === 'success' ? phoneStatusResponse.data : null,
              returnUrl: returnUrlFromQuery,
            })
            router.push(redirectPath)
            return
          }
          
          // Auto-send code when page loads (only once)
          if (!codeSent && !isSending && !hasAutoSentRef.current) {
            hasAutoSentRef.current = true
            await handleSendCode(userPhone)
          }
        } else {
          setError('Failed to load user data')
        }
      } catch (error: any) {
        logger.error('Failed to load user data', error)
        setError('Failed to load user data. Please try again.')
      } finally {
        setIsLoadingUser(false)
      }
    }
    
    loadUserData()
  }, [isAuthenticated, authLoading, router, returnUrlFromQuery])
  
  // Start resend timer
  useEffect(() => {
    const timer = setInterval(() => {
      setResendTimer(prev => prev > 0 ? prev - 1 : 0)
    }, 1000)
    
    return () => clearInterval(timer)
  }, [])
  
  // Auto-send code ref
  const hasAutoSentRef = useRef(false)
  
  // Send code to the entered number without saving profile first (verify step persists the number).
  useEffect(() => {
    if (phoneCountryTouched.current || !org?.country) return
    setPhoneCountry(resolveCountryCodeForPhone(org.country))
  }, [org?.country])

  const handleSavePhoneNumber = async () => {
    const phoneCandidate = buildPhoneE164(phoneCountry, phoneNational)
    const validationError = getPhoneValidationError(phoneCandidate)
    if (validationError) {
      setError(validationError)
      return
    }

    const normalizedPhone = normalizePhoneToE164(phoneCandidate)
    if (!normalizedPhone) {
      setError('Invalid phone number for the selected country')
      return
    }

    setIsSavingPhone(true)
    setError('')

    try {
      setPhoneNumber(normalizedPhone)
      setNeedsPhoneInput(false)
      setHadPhoneBeforeChange(false)
      setPhoneNational('')
      setCodeSent(false)
      setCode(['', '', '', ''])
      hasAutoSentRef.current = true
      setUser((prev) => (prev ? { ...prev, phoneNumber: normalizedPhone } : prev))
      await handleSendCode(normalizedPhone)
    } catch (error: unknown) {
      logger.error('Failed to send verification code for new phone', error as Error)
      setError(
        error instanceof Error ? error.message : 'Failed to send verification code'
      )
    } finally {
      setIsSavingPhone(false)
    }
  }
  
  // Handle code input
  const handleCodeChange = (index: number, value: string) => {
    if (value.length > 1) {
      // Handle paste - clean the input to only include digits
      const cleanedValue = value.replace(/\D/g, '').slice(0, 4)
      const pastedCode = cleanedValue.split('')
      const newCode = [...code]
      
      // Fill the code array starting from the current index
      pastedCode.forEach((digit, i) => {
        if (index + i < 4) {
          newCode[index + i] = digit
        }
      })
      setCode(newCode)
      
      // Focus the last filled input or the last input if all are filled
      const lastFilledIndex = Math.min(index + pastedCode.length - 1, 3)
      inputRefs.current[lastFilledIndex]?.focus()
    } else {
      // Handle single digit - only allow digits
      const digit = value.replace(/\D/g, '')
      const newCode = [...code]
      newCode[index] = digit
      setCode(newCode)
      
      // Auto-focus next input
      if (digit && index < 3) {
        inputRefs.current[index + 1]?.focus()
      }
    }
  }
  
  // Handle backspace
  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus()
    }
  }

  // Handle paste event
  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault()
    const pastedData = e.clipboardData.getData('text')
    const cleanedValue = pastedData.replace(/\D/g, '').slice(0, 4)
    
    if (cleanedValue.length > 0) {
      const pastedCode = cleanedValue.split('')
      const newCode = [...code]
      
      // Fill all 4 digits if we have enough, otherwise fill what we have
      pastedCode.forEach((digit, i) => {
        if (i < 4) {
          newCode[i] = digit
        }
      })
      setCode(newCode)
      
      // Focus the last filled input
      const lastFilledIndex = Math.min(pastedCode.length - 1, 3)
      inputRefs.current[lastFilledIndex]?.focus()
    }
  }
  
  // Handle send code
  const handleSendCode = async (phoneToUse?: string) => {
    const phoneToVerify = phoneToUse || phoneNumber
    
    if (!phoneToVerify) {
      setError('Phone number is required')
      return
    }
    
    setIsSending(true)
    setError('')
    
    try {
      const response = await sendPhoneVerificationCode({
        phoneNumber: phoneToVerify
      })
      
      if (handleApiErrorResponse(response, "Failed to send verification code")) {
        return
      }
      
      if (response.status === 'success') {
        setCodeSent(true)
        setCode(['', '', '', ''])
        setResendTimer(60) // 60 second cooldown
        toast.success('Verification code sent to your phone')
        // Focus first input
        setTimeout(() => {
          inputRefs.current[0]?.focus()
        }, 100)
      }
    } catch (error: any) {
      logger.error('Failed to send verification code', error)
      setError(error.message || 'Failed to send verification code')
    } finally {
      setIsSending(false)
    }
  }
  
  // Handle verify
  const handleVerify = async () => {
    const verificationCode = code.join('')
    if (verificationCode.length !== 4) {
      setError('Please enter the complete 4-digit code')
      return
    }
    
    if (!phoneNumber) {
      setError('Phone number is required')
      return
    }
    
    setError('')
    setIsVerifying(true)
    
    try {
      const response = await verifyPhoneCode({
        phoneNumber,
        code: verificationCode,
        updateUser: true  // First-time verification - update user immediately
      })
      
      if (handleApiErrorResponse(response, "Failed to verify code")) {
        return
      }
      
      if (response.status === 'success' && response.data?.verified) {
        toast.success('Phone number verified successfully!')
        
        // Redirect to role-based landing page
        try {
          const [userResponse, orgResponse, phoneStatusResponse] = await Promise.all([
            getCurrentUser(),
            getPublicOrganizationData(),
            getPhoneVerificationStatus()
          ])
          
          const userData = userResponse.status === 'success' ? userResponse.data : null
          const organization = orgResponse.status === 'success' ? orgResponse.data : null
          const phoneStatus = phoneStatusResponse.status === 'success' ? phoneStatusResponse.data : null
          
          if (userData) {
            const redirectPath = resolvePostAuthRedirect({
              user: userData,
              organization,
              phoneVerificationStatus: phoneStatus,
              returnUrl: returnUrlFromQuery,
            })
            router.push(redirectPath)
          } else {
            // Fall back to the shared user dashboard when user data is unavailable.
            const ru = sanitizeReturnUrl(returnUrlFromQuery)
            router.push(ru ?? getRoleLandingPage('user'))
          }
        } catch (error) {
          logger.error('Error determining redirect path after verification', error as Error)
          const ru = sanitizeReturnUrl(returnUrlFromQuery)
          router.push(ru ?? getRoleLandingPage('user'))
        }
      } else {
        setError('Invalid verification code. Please try again.')
      }
    } catch (error: any) {
      logger.error('Verification error:', error)
      setError(error.message || 'Invalid verification code')
    } finally {
      setIsVerifying(false)
    }
  }
  
  // Show loading while checking auth, org data, or user data
  if (authLoading || orgLoading || isLoadingUser) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    )
  }

  // Redirect if not authenticated (handled in useEffect, but show message here too)
  if (!isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <AlertCircle className="h-8 w-8 mx-auto mb-4 text-red-500" />
          <p className="text-muted-foreground">You must be logged in to verify your phone number.</p>
          <Link
            href={withReturnUrl('/login', sanitizeReturnUrl(returnUrlFromQuery))}
            className="text-primary underline mt-4 inline-block"
          >
            Go to login
          </Link>
        </div>
      </div>
    )
  }

  
  return (
    <div className="flex min-h-screen">
      {/* Left side - Branding */}
      <div className="hidden md:flex md:w-1/2 bg-card p-8 flex-col justify-center">
        <div className="max-w-md mx-auto">
          <Image
            src={logoUrl || '/images/logo.png'}
            alt={name || "Organization logo"}
            width={200}
            height={200}
            className="mb-8 h-auto"
          />

          <h1 className="text-4xl font-bold mb-6">
            {needsPhoneInput ? 'Add Your Phone Number' : 'Verify Your Phone Number'}
          </h1>

          {needsPhoneInput ? (
            <p className="text-xl text-muted-foreground mb-8">
              Choose your country code and enter your mobile number. We will send a 4-digit
              code to verify it.
            </p>
          ) : (
            <p className="text-xl text-muted-foreground mb-8">
              We have sent a 4-digit verification code to your phone number. Please enter it
              below to complete your verification.
            </p>
          )}
        </div>
      </div>

      {/* Right side - Verification form */}
      <div className="w-full md:w-1/2 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          <div className="bg-card text-card-foreground rounded-lg shadow-md p-8">
            <div className="text-center mb-6">
              <Phone className="mx-auto h-10 w-10 text-muted-foreground mb-4" />
              <h2 className="text-2xl font-bold mb-2">
                {needsPhoneInput ? 'Add Your Phone Number' : 'Verify Your Phone Number'}
              </h2>
              <div className="space-y-2">
                {needsPhoneInput ? (
                  <p className="text-muted-foreground">
                    Please enter your phone number to receive a verification code.
                  </p>
                ) : (
                  <p className="text-muted-foreground">
                    Enter the 4-digit code sent to<br />
                    <span className="font-medium">{phoneNumber}</span>
                  </p>
                )}
                {user?.email && (
                  <WrongAccountHint
                    email={user.email}
                    onSwitchAccount={handleSwitchAccount}
                    isSwitching={isSwitchingAccount}
                  />
                )}
              </div>
            </div>
            
            {error && (
              <Alert variant="destructive" className="mb-4">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            
            <div className="space-y-4">
              {/* Phone Number Input - shown when phone number is missing */}
              {needsPhoneInput && (
                <div className="space-y-2">
                  <Label htmlFor="phone-input">
                    Phone Number <span className="text-red-500">*</span>
                  </Label>
                  <PhoneInput
                    id="phone-country"
                    inputId="phone-input"
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
                    disabled={isSavingPhone}
                    placeholder="791234567"
                  />
                  <p id="phone-input-hint" className="text-xs text-muted-foreground">
                  Select your country, then enter your local number — no country code, leading zero, or + sign..
                  </p>
                  <Button
                    onClick={handleSavePhoneNumber}
                    className="w-full"
                    disabled={isSavingPhone || !phoneNational.trim()}
                  >
                    {isSavingPhone ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Phone className="mr-2 h-4 w-4" />
                        Send verification code
                      </>
                    )}
                  </Button>
                  {hadPhoneBeforeChange && phoneNumber && (
                    <div className="text-center">
                      <button
                        type="button"
                        onClick={() => {
                          setNeedsPhoneInput(false)
                          setHadPhoneBeforeChange(false)
                          setPhoneNational('')
                          setError('')
                        }}
                        className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-4"
                      >
                        Keep current number ({phoneNumber})
                      </button>
                    </div>
                  )}
                </div>
              )}
              
              {/* Verification Code Input - shown when phone number exists */}
              {!needsPhoneInput && (
                <>
              <div>
                <Label htmlFor="code-0" className="sr-only">Verification Code</Label>
                <div className="flex gap-2 justify-center">
                  {code.map((digit, index) => (
                    <Input
                      key={index}
                      id={`code-${index}`}
                      ref={(el) => {
                        inputRefs.current[index] = el
                      }}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={digit}
                      onChange={(e) => handleCodeChange(index, e.target.value)}
                      onKeyDown={(e) => handleKeyDown(index, e)}
                      onPaste={index === 0 ? handlePaste : undefined}
                      className="w-12 h-14 text-center text-2xl font-bold"
                      disabled={isVerifying || isSending}
                      autoFocus={index === 0}
                    />
                  ))}
                </div>
              </div>
              
              <Button
                onClick={handleVerify}
                className="w-full"
                disabled={isVerifying || isSending || code.join('').length !== 4}
              >
                {isVerifying ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  <>
                    <Shield className="mr-2 h-4 w-4" />
                    Verify Phone Number
                  </>
                )}
              </Button>
              
              <div className="text-center">
                <Button
                  variant="ghost"
                  onClick={() => handleSendCode()}
                  disabled={isSending || resendTimer > 0 || isVerifying}
                  className="text-sm"
                >
                  {isSending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Sending...
                    </>
                  ) : resendTimer > 0 ? (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Resend code in {resendTimer}s
                    </>
                  ) : (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Resend code
                    </>
                  )}
                </Button>
              </div>
              
              {!needsPhoneInput && (
                <div className="text-center pt-4">
                  <p className="text-sm text-muted-foreground">
                    Need to update your phone number?{" "}
                    <button
                      onClick={() => {
                        setNeedsPhoneInput(true)
                        setHadPhoneBeforeChange(true)
                        const parsed = parsePhoneInputValue(
                          phoneNumber,
                          resolveCountryCodeForPhone(org?.country)
                        )
                        phoneCountryTouched.current = true
                        setPhoneCountry(parsed.countryIso)
                        setPhoneNational(parsed.nationalNumber)
                        setCodeSent(false)
                        setCode(['', '', '', ''])
                        setError('')
                      }}
                      className="text-foreground hover:text-foreground font-medium underline"
                    >
                      Change phone number
                    </button>
                  </p>
                </div>
              )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
