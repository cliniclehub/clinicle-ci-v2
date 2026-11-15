"use client"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
    getEmailVerificationStatus,
    sendEmailVerificationCode,
    verifyEmailCode,
    type EmailVerificationStatus
} from "@/lib/actions/users/email-verification-actions"
import { handleApiErrorResponse } from "@/lib/utils/api-error-handler"
import { validateEmailAddress } from "@/lib/utils/email-validation"
import { createClientLogger } from "@/lib/utils/logger-client"
import { Loader2, Mail, Shield } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

interface EmailVerificationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  email: string
  onVerificationComplete?: () => void
}

export function EmailVerificationDialog({
  open,
  onOpenChange,
  email,
  onVerificationComplete,
}: EmailVerificationDialogProps) {
  const [verificationStatus, setVerificationStatus] = useState<EmailVerificationStatus | null>(null)
  const [isSendingCode, setIsSendingCode] = useState(false)
  const [isVerifying, setIsVerifying] = useState(false)
  const [verificationCode, setVerificationCode] = useState("")
  const [codeSent, setCodeSent] = useState(false)
  const [isCheckingStatus, setIsCheckingStatus] = useState(false)

  const logger = createClientLogger("EmailVerificationDialog")

  // Load verification status when dialog opens - only once per open
  const hasLoadedRef = useRef(false)
  
  useEffect(() => {
    if (open && email && !hasLoadedRef.current) {
      hasLoadedRef.current = true
      const loadStatus = async () => {
        setIsCheckingStatus(true)
        try {
          const response = await getEmailVerificationStatus()
          if (response.status === "success" && response.data) {
            setVerificationStatus(response.data)
          }
        } catch (error) {
          logger.error("Failed to load verification status", error as Error)
        } finally {
          setIsCheckingStatus(false)
        }
      }
      loadStatus()
    } else if (!open) {
      // Reset state when dialog closes
      hasLoadedRef.current = false
      setCodeSent(false)
      setVerificationCode("")
      setVerificationStatus(null)
    }
  }, [open]) // Only depend on open, not email or logger

  const handleSendCode = async () => {
    if (!email) {
      toast.error("Please enter an email address first")
      return
    }

    const validation = validateEmailAddress(email)
    if (!validation.ok) {
      toast.error(validation.message)
      return
    }

    setIsSendingCode(true)
    try {
      const response = await sendEmailVerificationCode({ email })

      if (handleApiErrorResponse(response, "Failed to send verification code")) {
        return
      }

      if (response.status === "success") {
        setCodeSent(true)
        setVerificationCode("")
        toast.success("Verification code sent to your email")
      }
    } catch (error) {
      logger.error("Failed to send verification code", error as Error)
      toast.error("Failed to send verification code. Please try again.")
    } finally {
      setIsSendingCode(false)
    }
  }

  const handleVerifyCode = async () => {
    if (!verificationCode || verificationCode.length !== 6) {
      toast.error("Please enter the complete 6-digit code")
      return
    }

    setIsVerifying(true)
    try {
      const response = await verifyEmailCode({
        email,
        code: verificationCode,
      })

      if (handleApiErrorResponse(response, "Failed to verify code")) {
        return
      }

      if (response.status === "success" && response.data?.verified) {
        toast.success("Email address verified successfully!")
        setCodeSent(false)
        setVerificationCode("")

        // Reload verification status
        const statusResponse = await getEmailVerificationStatus()
        if (statusResponse.status === "success" && statusResponse.data) {
          setVerificationStatus(statusResponse.data)
        }

        onVerificationComplete?.()
        onOpenChange(false)
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

  const isVerified = verificationStatus?.emailVerified || false

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Verify Email Address
          </DialogTitle>
  
        </DialogHeader>

        {isCheckingStatus ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : isVerified ? (
          <Alert className="bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800">
            <Shield className="h-4 w-4 text-green-600 dark:text-green-400" />
            <AlertDescription className="text-green-800 dark:text-green-200">
              Your email address has been verified successfully.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-4 py-4">
            {!codeSent ? (
              <div className="space-y-4">
                <Alert>
                  <Shield className="h-4 w-4" />
                  <AlertDescription>
                    A verification code will be sent via email to {email}
                  </AlertDescription>
                </Alert>
                <Button
                  onClick={handleSendCode}
                  disabled={isSendingCode || !email}
                  className="w-full"
                >
                  {isSendingCode ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <Mail className="mr-2 h-4 w-4" />
                      Send Verification Code
                    </>
                  )}
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="verification-code">Enter Verification Code</Label>
                  <Input
                    id="verification-code"
                    type="text"
                    placeholder="123456"
                    value={verificationCode}
                    onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    maxLength={6}
                    className="text-center text-lg tracking-widest"
                    autoFocus
                  />
                  <p className="text-xs text-muted-foreground text-center">
                    Enter the 6-digit code sent to {email}
                  </p>
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setCodeSent(false)
                      setVerificationCode("")
                    }}
                    className="flex-1"
                  >
                    Change Email
                  </Button>
                  <Button
                    onClick={handleVerifyCode}
                    disabled={isVerifying || verificationCode.length < 6}
                    className="flex-1"
                  >
                    {isVerifying ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Verifying...
                      </>
                    ) : (
                      "Verify"
                    )}
                  </Button>
                </div>

                <Button
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

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {isVerified ? "Close" : "Cancel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
