"use client"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  getPhoneVerificationStatus,
  sendPhoneVerificationCode,
  verifyPhoneCode,
  type PhoneVerificationStatus
} from "@/lib/actions/users/phone-verification-actions"
import { handleApiErrorResponse } from "@/lib/utils/api-error-handler"
import { createClientLogger } from "@/lib/utils/logger-client"
import { CheckCircle2, Loader2, Phone, Shield, XCircle } from "lucide-react"
import { memo, useEffect, useRef, useState } from "react"
import { toast } from "sonner"

interface PhoneVerificationSectionProps {
  phoneNumber: string
  organizationEnforcePhoneValidation?: boolean
  currentPhoneVerified?: boolean
  onVerificationComplete?: () => void
}

export const PhoneVerificationSection = memo(function PhoneVerificationSection({
  phoneNumber,
  organizationEnforcePhoneValidation = false,
  currentPhoneVerified = false,
  onVerificationComplete,
}: PhoneVerificationSectionProps) {
  const [verificationStatus, setVerificationStatus] = useState<PhoneVerificationStatus | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSendingCode, setIsSendingCode] = useState(false)
  const [isVerifying, setIsVerifying] = useState(false)
  const [verificationCode, setVerificationCode] = useState("")
  const [codeSent, setCodeSent] = useState(false)
  const [isCheckingStatus, setIsCheckingStatus] = useState(true)

  const logger = createClientLogger("PhoneVerificationSection")

  // Check if verification is required
  const needsVerification = organizationEnforcePhoneValidation && !currentPhoneVerified

  // Load verification status on mount - only once
  useEffect(() => {
    let isMounted = true
    
    const loadStatus = async () => {
      if (!organizationEnforcePhoneValidation) {
        if (isMounted) setIsCheckingStatus(false)
        return
      }

      try {
        if (isMounted) setIsCheckingStatus(true)
        const response = await getPhoneVerificationStatus()
        if (isMounted && response.status === "success" && response.data) {
          setVerificationStatus(response.data)
        }
      } catch (error) {
        if (isMounted) {
          logger.error("Failed to load verification status", error as Error)
        }
      } finally {
        if (isMounted) setIsCheckingStatus(false)
      }
    }

    loadStatus()
    
    return () => {
      isMounted = false
    }
  }, [organizationEnforcePhoneValidation]) // Remove logger from dependencies

  // Check if phone number changed - use ref to track previous value
  const prevPhoneRef = useRef<string>("")
  
  useEffect(() => {
    // Only reset if phone number actually changed from previous value
    if (phoneNumber && phoneNumber !== prevPhoneRef.current && prevPhoneRef.current !== "") {
      // Phone number changed, reset verification
      setVerificationStatus(prev => prev ? {
        ...prev,
        phoneVerified: false,
        phoneVerifiedAt: null,
        phoneNumber: phoneNumber,
      } : null)
      setCodeSent(false)
      setVerificationCode("")
    }
    prevPhoneRef.current = phoneNumber
  }, [phoneNumber])

  const handleSendCode = async () => {
    if (!phoneNumber) {
      toast.error("Please enter a phone number first")
      return
    }

    setIsSendingCode(true)
    try {
      const response = await sendPhoneVerificationCode({ phoneNumber })
      
      if (handleApiErrorResponse(response, "Failed to send verification code")) {
        return
      }

      if (response.status === "success") {
        setCodeSent(true)
        setVerificationCode("")
        toast.success("Verification code sent to your phone")
      }
    } catch (error) {
      logger.error("Failed to send verification code", error as Error)
      toast.error("Failed to send verification code. Please try again.")
    } finally {
      setIsSendingCode(false)
    }
  }

  const handleVerifyCode = async () => {
    if (!verificationCode || verificationCode.length !== 4) {
      toast.error("Please enter the complete 4-digit code")
      return
    }

    setIsVerifying(true)
    try {
      const response = await verifyPhoneCode({
        phoneNumber,
        code: verificationCode,
      })

      if (handleApiErrorResponse(response, "Failed to verify code")) {
        return
      }

      if (response.status === "success" && response.data?.verified) {
        toast.success("Phone number verified successfully!")
        setCodeSent(false)
        setVerificationCode("")
        
        // Reload verification status
        const statusResponse = await getPhoneVerificationStatus()
        if (statusResponse.status === "success" && statusResponse.data) {
          setVerificationStatus(statusResponse.data)
        }
        
        // Call completion callback to refresh user data
        onVerificationComplete?.()
      } else {
        toast.error("Invalid verification code. Please try again.")
      }
    } catch (error) {
      logger.error("Failed to verify code", error as Error)
      toast.error("Failed to verify code. Please try again.")
    } finally {
      setIsVerifying(false)
    }
  }

  // Don't show if organization doesn't require verification
  if (!organizationEnforcePhoneValidation) {
    return null
  }

  const isVerified = verificationStatus?.phoneVerified || currentPhoneVerified
  const displayPhone = verificationStatus?.phoneNumber || phoneNumber

  if (isCheckingStatus) {
    return (
      <Alert>
        <Loader2 className="h-4 w-4 animate-spin" />
        <AlertDescription>Checking verification status...</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-4 rounded-lg border p-4 bg-muted/50">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Phone className="h-5 w-5 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Phone Number Verification</h3>
        </div>
        {isVerified ? (
          <Badge variant="default" className="bg-green-500">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Verified
          </Badge>
        ) : (
          <Badge variant="destructive">
            <XCircle className="h-3 w-3 mr-1" />
            Not Verified
          </Badge>
        )}
      </div>

      {isVerified ? (
        <Alert className="bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800">
          <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
          <AlertDescription className="text-green-800 dark:text-green-200">
            Your phone number {displayPhone} has been verified.
            {verificationStatus?.phoneVerifiedAt && (
              <span className="block text-xs mt-1">
                Verified on {new Date(verificationStatus.phoneVerifiedAt).toLocaleDateString()}
              </span>
            )}
          </AlertDescription>
        </Alert>
      ) : (
        <div className="space-y-4">
          <Alert className="bg-yellow-50 dark:bg-yellow-950/20 border-yellow-200 dark:border-yellow-800">
            <Shield className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
            <AlertDescription className="text-yellow-800 dark:text-yellow-200">
              Your phone number must be verified before you can save your profile.
              {displayPhone && (
                <span className="block mt-1 font-medium">Phone: {displayPhone}</span>
              )}
            </AlertDescription>
          </Alert>

          {!codeSent ? (
            <div className="space-y-2">
              <Button
                type="button"
                onClick={handleSendCode}
                disabled={isSendingCode || !phoneNumber}
                className="w-full"
              >
                {isSendingCode ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Phone className="mr-2 h-4 w-4" />
                    Send Verification Code
                  </>
                )}
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                A verification code will be sent via SMS to {displayPhone || "your phone number"}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="verification-code">Enter Verification Code</Label>
                <Input
                  id="verification-code"
                  type="text"
                  placeholder="1234"
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  maxLength={4}
                  className="text-center text-lg tracking-widest"
                />
                <p className="text-xs text-muted-foreground text-center">
                  Enter the 4-digit code sent to {displayPhone}
                </p>
              </div>

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setCodeSent(false)
                    setVerificationCode("")
                  }}
                  className="flex-1"
                >
                  Change Number
                </Button>
                <Button
                  type="button"
                  onClick={handleVerifyCode}
                  disabled={isVerifying || verificationCode.length < 4}
                  className="flex-1"
                >
                  {isVerifying ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Verifying...
                    </>
                  ) : (
                    "Verify Code"
                  )}
                </Button>
              </div>

              <Button
                type="button"
                variant="ghost"
                onClick={handleSendCode}
                disabled={isSendingCode}
                className="w-full text-sm"
              >
                {isSendingCode ? (
                  <>
                    <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                    Resending...
                  </>
                ) : (
                  "Resend Code"
                )}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
})

