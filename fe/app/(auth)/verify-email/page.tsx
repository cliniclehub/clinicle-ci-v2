'use client'

import { Loader2, Mail, RefreshCw } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AlertCircle } from 'lucide-react'

import { resendVerificationCode, verifyEmail } from '@/lib/actions/auth/auth-public-actions'
import { sendEmailVerificationCode, verifyEmailCode } from '@/lib/actions/users/email-verification-actions'
import { getPublicOrganizationData } from '@/lib/actions/organizations/organizations-org-actions'
import { getPhoneVerificationStatus } from '@/lib/actions/users/phone-verification-actions'
import { getCurrentUser } from '@/lib/actions/users/users-me-actions'
import { useAuth } from '@/lib/contexts/auth-context'
import { useOrgWhiteLabelData } from '@/lib/hooks/use-org-white-label-data'
import { getDomainClient } from '@/lib/utils/domain-name-helper-client'
import { createClientLogger } from '@/lib/utils/logger-client'
import { validateEmailAddress } from '@/lib/utils/email-validation'
import { resolvePostAuthRedirect, sanitizeReturnUrl, withReturnUrl } from '@/lib/utils/return-url-helper'

const logger = createClientLogger('VerifyEmail2Page')

export default function VerifyEmail2Page() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { isAuthenticated, isLoading: authLoading } = useAuth()
  const { logoUrl, name, isLoading: orgLoading, org } = useOrgWhiteLabelData()
  
  // Get email from query params
  const email = searchParams.get('email') || ''
  const safeReturnUrl = sanitizeReturnUrl(searchParams.get('returnUrl'))
  
  // Form state
  const [code, setCode] = useState(['', '', '', '', '', ''])
  const [isLoading, setIsLoading] = useState(false)
  const [isResending, setIsResending] = useState(false)
  const [error, setError] = useState('')
  const [resendTimer, setResendTimer] = useState(0)
  
  // Refs for input fields
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])
  
  // Start resend timer
  useEffect(() => {
    const timer = setInterval(() => {
      setResendTimer(prev => prev > 0 ? prev - 1 : 0)
    }, 1000)
    
    return () => clearInterval(timer)
  }, [])
  
  // Handle code input
  const handleCodeChange = (index: number, value: string) => {
    if (value.length > 1) {
      // Handle paste - clean the input to only include digits
      const cleanedValue = value.replace(/\D/g, '').slice(0, 6)
      const pastedCode = cleanedValue.split('')
      const newCode = [...code]
      
      // Fill the code array starting from the current index
      pastedCode.forEach((digit, i) => {
        if (index + i < 6) {
          newCode[index + i] = digit
        }
      })
      setCode(newCode)
      
      // Focus the last filled input or the last input if all are filled
      const lastFilledIndex = Math.min(index + pastedCode.length - 1, 5)
      inputRefs.current[lastFilledIndex]?.focus()
    } else {
      // Handle single digit - only allow digits
      const digit = value.replace(/\D/g, '')
      const newCode = [...code]
      newCode[index] = digit
      setCode(newCode)
      
      // Auto-focus next input
      if (digit && index < 5) {
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
    const cleanedValue = pastedData.replace(/\D/g, '').slice(0, 6)
    
    if (cleanedValue.length > 0) {
      const pastedCode = cleanedValue.split('')
      const newCode = [...code]
      
      // Fill all 6 digits if we have enough, otherwise fill what we have
      pastedCode.forEach((digit, i) => {
        if (i < 6) {
          newCode[i] = digit
        }
      })
      setCode(newCode)
      
      // Focus the last filled input
      const lastFilledIndex = Math.min(pastedCode.length - 1, 5)
      inputRefs.current[lastFilledIndex]?.focus()
    }
  }
  
  // Handle verify
  const handleVerify = async () => {
    const verificationCode = code.join('')
    if (verificationCode.length !== 6) {
      setError('Please enter the complete 6-digit code')
      return
    }
    
    setError('')
    setIsLoading(true)
    
    try {
      let response

      if (isAuthenticated) {
        // Logged-in user changing email: use authenticated endpoint (user from session)
        response = await verifyEmailCode({ email, code: verificationCode })
      } else {
        // Registration flow: use public endpoint (lookup by email)
        const domain = getDomainClient()
        response = await verifyEmail({
          email,
          code: verificationCode,
          orgDomain: domain || window.location.hostname.split(':')[0]
        })
      }
      
      if (response.status === 'error') {
        setError(response.message || 'Invalid verification code')
        return
      }
      
      toast.success('Email verified successfully!')

      if (isAuthenticated) {
        try {
          const [userResponse, orgResponse, phoneStatusResponse] = await Promise.all([
            getCurrentUser(),
            getPublicOrganizationData(),
            getPhoneVerificationStatus().catch(() => ({
              status: 'error' as const,
              message: 'Failed to check phone verification',
            })),
          ])
          const user = userResponse.status === 'success' ? userResponse.data : null
          const organization = orgResponse.status === 'success' ? orgResponse.data : null
          const phoneVerificationStatus =
            phoneStatusResponse.status === 'success' ? phoneStatusResponse.data : null

          if (user) {
            router.push(
              resolvePostAuthRedirect({
                user,
                organization,
                phoneVerificationStatus,
                returnUrl: searchParams.get('returnUrl'),
              })
            )
          } else {
            router.push(resolvePostAuthRedirect({ returnUrl: safeReturnUrl }))
          }
        } catch (redirectErr) {
          logger.error('Post-verify-email redirect failed', redirectErr as Error)
          router.push(resolvePostAuthRedirect({ returnUrl: safeReturnUrl }))
        }
      } else {
        const loginParams = new URLSearchParams({ email })
        const loginBase = `/login?${loginParams.toString()}`
        router.push(withReturnUrl(loginBase, safeReturnUrl))
      }
    } catch (error: any) {
      logger.error('Verification error:', error)
      setError(error.message || 'Invalid verification code')
    } finally {
      setIsLoading(false)
    }
  }
  
  // Handle resend code
  const handleResend = async () => {
    if (resendTimer > 0) return

    const emailValidation = validateEmailAddress(email)
    if (!emailValidation.ok) {
      setError(emailValidation.message)
      return
    }
    
    setError('')
    setIsResending(true)
    
    try {
      let response

      if (isAuthenticated) {
        response = await sendEmailVerificationCode({ email })
      } else {
        const domain = getDomainClient()
        response = await resendVerificationCode(email, domain || window.location.hostname.split(':')[0])
      }
      
      if (response.status === 'error') {
        setError(response.message || 'Failed to resend code')
        return
      }
      
      toast.success('Verification code sent! Check your email.')
      setResendTimer(120) // 2 minutes
      setCode(['', '', '', '', '', '']) // Clear code
    } catch (error: any) {
      logger.error('Resend error:', error)
      setError(error.message || 'Failed to resend code')
    } finally {
      setIsResending(false)
    }
  }
  
  // Show loading while checking auth and org data
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

  // Redirect if no email provided
  if (!email) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-4">Email Required</h2>
          <p className="text-muted-foreground mb-6">
            Please register first to verify your email.
          </p>
          <Button
            onClick={() =>
              router.push(safeReturnUrl ? withReturnUrl('/register', safeReturnUrl) : '/register')
            }
          >
            Go to Registration
          </Button>
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
            Verify Your Email
          </h1>

          <p className="text-xl text-muted-foreground mb-8">
            We've sent you a welcome email with a verification code. Please check your inbox and enter the 6-digit code below to complete your registration.
          </p>

          <div className="bg-muted rounded-lg p-6">
            <div className="flex items-center gap-4">
              <Mail className="h-12 w-12 text-muted-foreground flex-shrink-0" />
              <div>
                <p className="text-sm text-muted-foreground">
                  Verification code sent to:
                </p>
                <p className="font-medium text-lg">
                  {email}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right side - Verification form */}
      <div className="w-full md:w-1/2 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          <div className="bg-card text-card-foreground rounded-lg shadow-md p-8">
            <h2 className="text-2xl font-bold text-center mb-2">
              Enter Verification Code
            </h2>
            <p className="text-muted-foreground text-center mb-6">
              Please enter the 6-digit code sent to your email
            </p>
            <p className="text-sm text-muted-foreground text-center mb-4">
              💡 Tip: You can paste the entire code into any field
            </p>
            
            {error && (
              <Alert variant="destructive" className="mb-4">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="space-y-2">
                  <div>{error}</div>
                  {error.toLowerCase().includes('already verified') && (
                    <div className="mt-2 pt-2 border-t border-destructive/20">
                      <p className="text-sm mb-2">
                        Your email is already verified. You can proceed to login.
                      </p>
                      <Link
                        href={withReturnUrl(
                          `/login?email=${encodeURIComponent(email)}`,
                          safeReturnUrl
                        )}
                        className="text-sm font-medium underline hover:no-underline"
                      >
                        Go to Login →
                      </Link>
                    </div>
                  )}
                </AlertDescription>
              </Alert>
            )}
            
            <div className="space-y-4">
              <div>
                <Label className="text-center block mb-2">Verification Code</Label>
                <div className="flex gap-2 justify-center">
                  {code.map((digit, index) => (
                    <Input
                      key={index}
                      ref={(el) => {
                        if (el) {
                          inputRefs.current[index] = el
                        }
                      }}
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]"
                      maxLength={6}
                      value={digit}
                      onChange={(e) => handleCodeChange(index, e.target.value)}
                      onKeyDown={(e) => handleKeyDown(index, e)}
                      onPaste={handlePaste}
                      className="w-12 h-12 text-center text-lg font-semibold"
                      disabled={isLoading}
                    />
                  ))}
                </div>
              </div>
              
              <Button 
                onClick={handleVerify}
                className="w-full" 
                disabled={isLoading || code.join('').length !== 6}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  "Verify Email"
                )}
              </Button>
              
              <div className="text-center">
                <p className="text-sm text-muted-foreground mb-2">
                  Didn't receive the code?
                </p>
                <Button
                  variant="ghost"
                  onClick={handleResend}
                  disabled={isResending || resendTimer > 0}
                  className="text-sm"
                >
                  {isResending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Sending...
                    </>
                  ) : resendTimer > 0 ? (
                    `Resend in ${Math.floor(resendTimer / 60)}:${(resendTimer % 60).toString().padStart(2, '0')}`
                  ) : (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Resend Code
                    </>
                  )}
                </Button>
              </div>
              
              <div className="text-center">
                <Link
                  href={
                    isAuthenticated
                      ? withReturnUrl('/settings', safeReturnUrl)
                      : safeReturnUrl
                        ? withReturnUrl('/register', safeReturnUrl)
                        : '/register'
                  }
                  className="text-sm text-muted-foreground hover:text-foreground"
                >
                  {isAuthenticated ? 'Back to Settings' : 'Back to Registration'}
                </Link>
              </div>
              <div className="text-center pt-2">
                <Link href="/contact" className="text-sm text-muted-foreground underline hover:text-foreground">
                  Contact us
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
