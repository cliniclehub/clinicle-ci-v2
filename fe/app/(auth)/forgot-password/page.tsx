'use client'

import { ArrowLeft, Loader2, Mail } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { useState } from 'react'
import { toast } from 'sonner'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AlertCircle } from 'lucide-react'

import { forgotPassword } from '@/lib/actions/auth/auth-public-actions'
import { useOrgWhiteLabelData } from '@/lib/hooks/use-org-white-label-data'
import { getDomainClient } from '@/lib/utils/domain-name-helper-client'
import { createClientLogger } from '@/lib/utils/logger-client'
import { emailAddressSchema } from '@/lib/utils/email-validation'
import { z } from 'zod'

const logger = createClientLogger('ForgotPassword2Page')

// Validation schema
const schema = z.object({
  email: emailAddressSchema,
})

type FormData = z.infer<typeof schema>

export default function ForgotPassword2Page() {
  const { logoUrl, name, isLoading: orgLoading } = useOrgWhiteLabelData()
  
  // Form state
  const [email, setEmail] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSubmitted, setIsSubmitted] = useState(false)
  const [error, setError] = useState('')
  const [validationError, setValidationError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setValidationError('')
    setIsLoading(true)
    const methodLogger = logger.forMethod('handleSubmit')
    
    try {
      // Validate form data
      const formData = schema.parse({ email })
      
      const domain = getDomainClient()
      
      const response = await forgotPassword({
        email: formData.email,
        orgDomain: domain || window.location.hostname.split(':')[0]
      })
      
      // Handle error response
      if (response.status === 'error') {
        // Show specific error message for rate limiting
        if (response.code === 429) {
          setError(response.message || 'Please wait 2 minutes before requesting another reset code')
        } else {
          // Don't show specific errors to avoid revealing user existence
          setError('If an account exists with this email, you will receive password reset instructions.')
        }
        // Don't set isSubmitted = true for errors, so error message shows
        return
      }
      
      // Success response
      if (response.data?.sent) {
        setIsSubmitted(true)
        toast.success('Password reset instructions sent!')
      } else {
        // Don't show specific errors to avoid revealing user existence
        setError('If an account exists with this email, you will receive password reset instructions.')
        setIsSubmitted(true)
      }
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        // Handle validation errors - show under the field
        const firstError = error.errors[0]
        setValidationError(firstError.message)
      } else {
        methodLogger.error('Forgot password error:', error)
        // Don't show specific errors to avoid revealing user existence
        setError('If an account exists with this email, you will receive password reset instructions.')
        setIsSubmitted(true)
      }
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
    <div className="flex min-h-screen">
      {/* Left side - Branding */}
      <div className="hidden md:flex md:w-1/2 bg-card p-8 flex-col justify-center">
        <div className="max-w-md mx-auto">
          <Link
            href="/"
            className="mb-8 block w-fit cursor-pointer rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
            Forgot Your Password?
          </h1>

          <p className="text-xl text-muted-foreground mb-8">
            No worries! We'll send you instructions to reset your password and get back to learning.
          </p>

          <div className="bg-muted rounded-lg p-6">
            <h3 className="font-medium mb-3">Password reset process:</h3>
            <ol className="space-y-3 text-sm text-muted-foreground">
              <li className="flex gap-3">
                <span className="font-medium text-foreground">1.</span>
                Enter your email address
              </li>
              <li className="flex gap-3">
                <span className="font-medium text-foreground">2.</span>
                Receive a 6-digit reset code via email
              </li>
              <li className="flex gap-3">
                <span className="font-medium text-foreground">3.</span>
                Enter the code and create a new password
              </li>
              <li className="flex gap-3">
                <span className="font-medium text-foreground">4.</span>
                Sign in with your new password
              </li>
            </ol>
          </div>
        </div>
      </div>

      {/* Right side - Reset form */}
      <div className="w-full md:w-1/2 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          <div className="bg-card text-card-foreground rounded-lg shadow-md p-8">
            {!isSubmitted ? (
              <>
                <Button asChild variant="ghost" size="sm" className="mb-6">
                  <Link href="/login">
                    <ArrowLeft className="h-4 w-4" />
                  </Link>
                </Button>
                
                <h2 className="text-2xl font-bold text-center mb-2">
                  Reset your password
                </h2>
                <p className="text-muted-foreground text-center mb-6">
                  Enter your email and we'll send you a reset code
                </p>
                
                <form onSubmit={handleSubmit} className="space-y-4">
                  {error && (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}
                  
                  <div className="space-y-2">
                    <Label htmlFor="email">Email address</Label>
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value)
                        if (validationError) setValidationError('')
                      }}
                      placeholder="Enter your email"
                      required
                      disabled={isLoading}
                      autoComplete="email"
                      autoFocus
                      className={validationError ? "border-red-500 focus:border-red-500" : ""}
                    />
                    {validationError ? (
                      <p className="text-sm text-red-500">{validationError}</p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        We'll send a password reset code to this email address if it exists in our system.
                      </p>
                    )}
                  </div>
                  
                  <Button 
                    type="submit" 
                    className="w-full" 
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Sending reset code...
                      </>
                    ) : (
                      "Send reset code"
                    )}
                  </Button>
                </form>
              </>
            ) : (
              <div className="text-center">
                <div className="mb-6">
                  <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-green-100">
                    <Mail className="h-8 w-8 text-green-600" />
                  </div>
                </div>
                
                <h2 className="text-2xl font-bold mb-2">
                  Check your email
                </h2>
                <p className="text-muted-foreground mb-6">
                  If an account exists with <span className="font-medium">{email}</span>,
                  we've sent a password reset code to your inbox.
                </p>
                
                <Alert className="mb-6">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="text-sm">
                    Didn't receive the email? Check your spam folder or try again in a few minutes.
                  </AlertDescription>
                </Alert>
                
                <Button asChild className="w-full mb-4">
                  <Link href={`/reset-password?email=${encodeURIComponent(email)}`}>
                    Enter reset code
                  </Link>
                </Button>
                
                <div className="space-y-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setIsSubmitted(false)
                      setEmail('')
                      setError('')
                      setValidationError('')
                    }}
                    className="w-full"
                  >
                    Try another email
                  </Button>
                  
                  <Link
                    href="/login"
                    className="text-sm text-muted-foreground hover:text-foreground block"
                  >
                    Back to login
                  </Link>
                </div>
              </div>
            )}
            <p className="mt-6 text-center text-sm text-muted-foreground">
              <Link href="/contact" className="underline hover:text-foreground">
                Contact us
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
