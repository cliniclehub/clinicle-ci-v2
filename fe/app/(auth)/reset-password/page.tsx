'use client'

import { Check, Eye, EyeOff, Loader2, X } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRef, useState } from 'react'
import { toast } from 'sonner'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AlertCircle } from 'lucide-react'

import { resetPassword } from '@/lib/actions/auth/auth-public-actions'
import { useOrgWhiteLabelData } from '@/lib/hooks/use-org-white-label-data'
import { getDomainClient } from '@/lib/utils/domain-name-helper-client'
import { createClientLogger } from '@/lib/utils/logger-client'

const logger = createClientLogger('ResetPassword2Page')

interface PasswordRequirement {
  label: string
  test: (password: string) => boolean
}

const passwordRequirements: PasswordRequirement[] = [
  { label: 'At least 8 characters', test: (p) => p.length >= 8 },
  { label: 'One uppercase letter', test: (p) => /[A-Z]/.test(p) },
  { label: 'One lowercase letter', test: (p) => /[a-z]/.test(p) },
  { label: 'One number', test: (p) => /\d/.test(p) },
  { label: 'One special character', test: (p) => /[!@#$%^&*(),.?":{}\|<>]/.test(p) }
]

export default function ResetPassword2Page() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { logoUrl, name, isLoading: orgLoading } = useOrgWhiteLabelData()
  
  // Get email from query params
  const email = searchParams.get('email') || ''
  
  // Form state
  const [code, setCode] = useState(['', '', '', '', '', ''])
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  
  // Refs for code input fields
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])
  
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
  
  // Validate password requirements
  const getPasswordStrength = () => {
    return passwordRequirements.filter(req => req.test(newPassword)).length
  }
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    
    // Validate code
    const resetCode = code.join('')
    if (resetCode.length !== 6) {
      setError('Please enter the complete 6-digit code')
      return
    }
    
    // Validate passwords match
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match')
      return
    }
    
    // Validate password requirements
    const failedRequirements = passwordRequirements.filter(req => !req.test(newPassword))
    if (failedRequirements.length > 0) {
      setError('Password does not meet all requirements')
      return
    }
    
    setIsLoading(true)
    
    try {
      const domain = getDomainClient()
      
      await resetPassword({
        email,
        code: resetCode,
        newPassword: newPassword,
        orgDomain: domain || window.location.hostname.split(':')[0]
      })
      
      toast.success('Password reset successfully!')
      router.push(`/login?email=${encodeURIComponent(email)}`)
    } catch (error: any) {
      logger.error('Reset password error:', error)
      setError(error.message || 'Failed to reset password')
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

  // Redirect if no email provided
  if (!email) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-4">Email Required</h2>
          <p className="text-muted-foreground mb-6">
            Please start the password reset process from the beginning.
          </p>
          <Button asChild>
            <Link href="/forgot-password">Reset Password</Link>
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
            Create New Password
          </h1>

          <p className="text-xl text-muted-foreground mb-8">
            Enter the code we sent to your email and create a new, secure password for your account.
          </p>

          <div className="bg-muted rounded-lg p-6">
            <h3 className="font-medium mb-3">Password requirements:</h3>
            <ul className="space-y-2">
              {passwordRequirements.map((req, index) => (
                <li key={index} className="flex items-center gap-2 text-sm">
                  {req.test(newPassword) ? (
                    <Check className="h-4 w-4 text-green-600" />
                  ) : (
                    <X className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className={req.test(newPassword) ? 'text-green-600' : 'text-muted-foreground'}>
                    {req.label}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Right side - Reset form */}
      <div className="w-full md:w-1/2 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          <div className="bg-card text-card-foreground rounded-lg shadow-md p-8">
            <h2 className="text-2xl font-bold text-center mb-2">
              Reset Your Password
            </h2>
            <p className="text-muted-foreground text-center mb-6">
              For <span className="font-medium">{email}</span>
            </p>
            
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              
              <div className="space-y-2">
                <Label>Reset Code</Label>
                <div className="flex gap-2 justify-center">
                  {code.map((digit, index) => (
                    <Input
                      key={index}
                      ref={(el) => {
                        inputRefs.current[index] = el
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
                <p className="text-xs text-muted-foreground text-center">
                  Enter the 6-digit code sent to your email
                </p>
                <p className="text-xs text-muted-foreground text-center mt-1">
                  💡 Tip: You can paste the entire code into any field
                </p>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="newPassword">New Password</Label>
                <div className="relative">
                  <Input
                    id="newPassword"
                    type={showPassword ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Create a strong password"
                    required
                    disabled={isLoading}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2"
                    disabled={isLoading}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {newPassword && (
                  <div className="text-xs">
                    Password strength: 
                    <span className={`ml-1 font-medium ${
                      getPasswordStrength() < 3 ? 'text-red-600' : 
                      getPasswordStrength() < 5 ? 'text-yellow-600' : 
                      'text-green-600'
                    }`}>
                      {getPasswordStrength() < 3 ? 'Weak' : 
                       getPasswordStrength() < 5 ? 'Good' : 
                       'Strong'}
                    </span>
                  </div>
                )}
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm New Password</Label>
                <div className="relative">
                  <Input
                    id="confirmPassword"
                    type={showConfirmPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm your password"
                    required
                    disabled={isLoading}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2"
                    disabled={isLoading}
                  >
                    {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              
              <Button 
                type="submit" 
                className="w-full" 
                disabled={isLoading || code.join('').length !== 6 || !newPassword || !confirmPassword}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Resetting password...
                  </>
                ) : (
                  "Reset Password"
                )}
              </Button>
              
              <div className="text-center space-y-2">
                <Link
                  href="/forgot-password"
                  className="text-sm text-muted-foreground hover:text-foreground block"
                >
                  Didn't receive the code? Request a new one
                </Link>
                <Link
                  href="/login"
                  className="text-sm text-muted-foreground hover:text-foreground block"
                >
                  Back to login
                </Link>
                <Link
                  href="/contact"
                  className="text-sm text-muted-foreground underline hover:text-foreground block"
                >
                  Contact us
                </Link>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}
