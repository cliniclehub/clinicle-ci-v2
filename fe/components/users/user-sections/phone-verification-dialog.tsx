"use client"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { Loader2, Phone, Shield } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

interface PhoneVerificationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  phoneNumber: string
  onVerificationComplete?: () => void
  /** When true, backend updates user's phone immediately on verify (for settings flow). */
  saveOnVerify?: boolean
}

export function PhoneVerificationDialog({
  open,
  onOpenChange,
  phoneNumber,
  onVerificationComplete,
  saveOnVerify = false,
}: PhoneVerificationDialogProps) {
  const [verificationStatus, setVerificationStatus] = useState<PhoneVerificationStatus | null>(null)
  const [isSendingCode, setIsSendingCode] = useState(false)
  const [isVerifying, setIsVerifying] = useState(false)
  const [verificationCode, setVerificationCode] = useState("")
  const [codeSent, setCodeSent] = useState(false)
  const [isCheckingStatus, setIsCheckingStatus] = useState(false)

  const logger = createClientLogger("PhoneVerificationDialog")

  // Load verification status when dialog opens - only once per open
  const hasLoadedRef = useRef(false)
  
  useEffect(() => {
    if (open && phoneNumber && !hasLoadedRef.current) {
      hasLoadedRef.current = true
      const loadStatus = async () => {
        setIsCheckingStatus(true)
        try {
          const response = await getPhoneVerificationStatus()
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
  }, [open]) // Only depend on open, not phoneNumber or logger

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
        updateUser: saveOnVerify,
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

  const isVerified = verificationStatus?.phoneVerified || false

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Phone className="h-5 w-5" />
            Verify Phone Number
          </DialogTitle>
          <DialogDescription>
            Verify your phone number {phoneNumber} to continue
          </DialogDescription>
        </DialogHeader>

        {isCheckingStatus ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : isVerified ? (
          <Alert className="bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800">
            <Shield className="h-4 w-4 text-green-600 dark:text-green-400" />
            <AlertDescription className="text-green-800 dark:text-green-200">
              Your phone number has been verified successfully.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-4 py-4">
            {!codeSent ? (
              <div className="space-y-4">
                <Alert>
                  <Shield className="h-4 w-4" />
                  <AlertDescription>
                    A verification code will be sent via SMS to {phoneNumber}
                  </AlertDescription>
                </Alert>
                <Button
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
                    autoFocus
                  />
                  <p className="text-xs text-muted-foreground text-center">
                    Enter the 4-digit code sent to {phoneNumber}
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
                    Change Number
                  </Button>
                  <Button
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

