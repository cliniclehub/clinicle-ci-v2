"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"

import { createClientLogger } from "@/lib/utils/logger-client"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Form,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Eye, EyeOff, Loader2, Lock } from "lucide-react"

import { logoutUser } from "@/lib/actions/auth/auth-public-actions"
import { changeCurrentUserPassword, setCurrentUserPassword } from "@/lib/actions/users/users-me-actions"
import { changeUserPassword as changeUserPasswordOrg } from "@/lib/actions/users/users-org-actions"
import { changeUserPassword as changeUserPasswordPlatform } from "@/lib/actions/users/users-platform-actions"
import { useAuth } from "@/lib/contexts/auth-context"

// Password validation function matching registration page
const validatePasswordStrength = (password: string): string[] => {
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

// Schema for admin changing user password
const adminPasswordSchema = z.object({
  newPassword: z.string()
    .min(8, "Password must be at least 8 characters long")
    .refine((password) => /[A-Z]/.test(password), {
      message: "Password must contain at least one uppercase letter",
    })
    .refine((password) => /[a-z]/.test(password), {
      message: "Password must contain at least one lowercase letter",
    })
    .refine((password) => /\d/.test(password), {
      message: "Password must contain at least one number",
    })
    .refine((password) => /[!@#$%^&*(),.?":{}|<>]/.test(password), {
      message: "Password must contain at least one special character",
    }),
  confirmPassword: z.string(),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Passwords must match",
  path: ["confirmPassword"],
})

// Schema for user changing their own password
const userPasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string()
    .min(8, "Password must be at least 8 characters long")
    .refine((password) => /[A-Z]/.test(password), {
      message: "Password must contain at least one uppercase letter",
    })
    .refine((password) => /[a-z]/.test(password), {
      message: "Password must contain at least one lowercase letter",
    })
    .refine((password) => /\d/.test(password), {
      message: "Password must contain at least one number",
    })
    .refine((password) => /[!@#$%^&*(),.?":{}|<>]/.test(password), {
      message: "Password must contain at least one special character",
    }),
  confirmPassword: z.string(),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Passwords must match",
  path: ["confirmPassword"],
}).refine((data) => data.currentPassword !== data.newPassword, {
  message: "New password must be different from current password",
  path: ["newPassword"],
})

type AdminPasswordFormData = z.infer<typeof adminPasswordSchema>
type UserPasswordFormData = z.infer<typeof userPasswordSchema>

interface ChangePasswordDialogProps {
  open: boolean
  onClose: () => void
  userId?: string
  userName?: string
  isCurrentUser?: boolean
  requireCurrentPassword?: boolean
  onSuccess?: () => void
}

export function ChangePasswordDialog({
  open,
  onClose,
  userId,
  userName,
  isCurrentUser = false,
  requireCurrentPassword = true,
  onSuccess,
}: ChangePasswordDialogProps) {
  const logger = createClientLogger('ChangePasswordDialog')
  const { user: currentUser } = useAuth()
  const [isLoading, setIsLoading] = useState(false)
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [passwordErrors, setPasswordErrors] = useState<string[]>([])

  const isSelfPasswordChange =
    isCurrentUser ||
    Boolean(userId && currentUser?.id && userId === currentUser.id)
  
  // Determine if current user is super admin based on their roles from token
  const isSuperAdmin = currentUser?.roles?.includes("super_admin") ?? false

  // Use different schemas based on whether it's current user or admin
  const schema =
    isSelfPasswordChange && requireCurrentPassword ? userPasswordSchema : adminPasswordSchema
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues:
      isSelfPasswordChange && requireCurrentPassword
      ? { currentPassword: "", newPassword: "", confirmPassword: "" }
      : { newPassword: "", confirmPassword: "" },
  })

  const handleClose = () => {
    form.reset()
    setPasswordErrors([])
    onClose()
  }

  // Handle password field changes to show real-time validation
  const handlePasswordChange = (value: string) => {
    if (value) {
      const errors = validatePasswordStrength(value)
      setPasswordErrors(errors)
    } else {
      setPasswordErrors([])
    }
  }

  const onSubmit = async (data: any) => {
    setIsLoading(true)

    try {
      if (isSelfPasswordChange && requireCurrentPassword) {
        // User changing their own password
        const response = await changeCurrentUserPassword(
          data.currentPassword,
          data.newPassword
        )

        if (response.status === "success") {
          toast.success("Password changed successfully. You will be logged out for security.")
          setPasswordErrors([])
          
          // Force logout and redirect to login page
          setTimeout(async () => {
            try {
              await logoutUser()
              // Redirect to login page
              window.location.href = '/login'
            } catch (error) {
              logger.error('Failed to logout after password change', error as Error)
              // Force redirect even if logout fails
              window.location.href = '/login'
            }
          }, 2000) // Give user time to see the success message
          
          handleClose()
          onSuccess?.()
        } else {
          // Check if it's incorrect current password
          if (response.message?.toLowerCase().includes("incorrect") || 
              response.message?.toLowerCase().includes("invalid")) {
            form.setError("currentPassword", { 
              message: "Current password is incorrect" 
            })
          } else {
            toast.error(response.message || "Failed to change password")
          }
        }
      } else if (isSelfPasswordChange) {
        const response = await setCurrentUserPassword(data.newPassword)
        if (response.status === "success") {
          toast.success("Password created successfully. You can now sign in with email/password and Google.")
          setPasswordErrors([])
          handleClose()
          onSuccess?.()
        } else {
          toast.error(response.message || "Failed to create password")
        }
      } else if (userId) {
        // Admin changing user's password
        // Choose the correct change password function based on current user's role from token
        const changeUserPassword = isSuperAdmin ? changeUserPasswordPlatform : changeUserPasswordOrg
        const response = await changeUserPassword(userId, data.newPassword)

        if (response.status === "success") {
          toast.success(`Password changed successfully for ${userName || "user"}. They will need to log in again.`)
          setPasswordErrors([])
          handleClose()
          onSuccess?.()
        } else {
          toast.error(response.message || "Failed to change password")
        }
      }
    } catch (error) {
      toast.error("An error occurred while changing password")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            {isSelfPasswordChange
              ? (requireCurrentPassword ? "Change Your Password" : "Create Password")
              : `Change Password for ${userName || "User"}`}
          </DialogTitle>
          <DialogDescription>
            {isSelfPasswordChange
              ? (requireCurrentPassword
                ? "Enter your current password and choose a new password"
                : "Set your first local password so you can sign in with email and password as well.")
              : "Set a new password for this user. They will be required to use this password on their next login."
            }
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {isSelfPasswordChange && requireCurrentPassword && (
              <FormField
                control={form.control}
                name="currentPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Current Password</FormLabel>
                    <div className="relative">
                      <Input {...field} type={showCurrent ? "text" : "password"} autoComplete="current-password" disabled={isLoading} />
                      <button
                        type="button"
                        tabIndex={0}
                        aria-label={showCurrent ? "Hide password" : "Show password"}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                        onClick={() => setShowCurrent((v) => !v)}
                        disabled={isLoading}
                      >
                        {showCurrent ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                      </button>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="newPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>New Password</FormLabel>
                  <div className="relative">
                    <Input 
                      {...field} 
                      type={showNew ? "text" : "password"} 
                      autoComplete="new-password" 
                      disabled={isLoading}
                      onChange={(e) => {
                        field.onChange(e)
                        handlePasswordChange(e.target.value)
                      }}
                    />
                    <button
                      type="button"
                      tabIndex={0}
                      aria-label={showNew ? "Hide password" : "Show password"}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                      onClick={() => setShowNew((v) => !v)}
                      disabled={isLoading}
                    >
                      {showNew ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>
                  <FormDescription>
                    Password must meet all requirements below
                  </FormDescription>
                  {passwordErrors.length > 0 && (
                    <div className="text-sm text-muted-foreground space-y-1 mt-2">
                      {passwordErrors.map((error, index) => (
                        <div key={index} className="flex items-center gap-2">
                          <span className="text-destructive">•</span>
                          <span>{error}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Confirm New Password</FormLabel>
                  <div className="relative">
                    <Input {...field} type={showConfirm ? "text" : "password"} autoComplete="new-password" disabled={isLoading} />
                    <button
                      type="button"
                      tabIndex={0}
                      aria-label={showConfirm ? "Hide password" : "Show password"}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                      onClick={() => setShowConfirm((v) => !v)}
                      disabled={isLoading}
                    >
                      {showConfirm ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>
                  <FormDescription>
                    Re-enter the password to confirm
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                disabled={isLoading}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isSelfPasswordChange && !requireCurrentPassword ? "Create Password" : "Change Password"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
