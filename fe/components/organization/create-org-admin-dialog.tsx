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
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Eye, EyeOff, Loader2, UserPlus } from "lucide-react"

import { createOrgOwnerUser } from "@/lib/actions/users/users-platform-actions"
import { emailAddressSchema } from "@/lib/utils/email-validation"

// Schema for creating org owner
const createOrgOwnerSchema = z.object({
  email: emailAddressSchema,
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  password: z.string()
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
  sendVerificationEmail: z.boolean().default(true),
})

type CreateOrgOwnerFormData = z.infer<typeof createOrgOwnerSchema>

interface CreateOrgAdminDialogProps {
  open: boolean
  onClose: () => void
  organizationId: string
  organizationName: string
  onSuccess?: () => void
}

export function CreateOrgAdminDialog({
  open,
  onClose,
  organizationId,
  organizationName,
  onSuccess,
}: CreateOrgAdminDialogProps) {
  const logger = createClientLogger('CreateOrgOwnerDialog')
  const [isLoading, setIsLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const form = useForm<CreateOrgOwnerFormData>({
    resolver: zodResolver(createOrgOwnerSchema),
    defaultValues: {
      email: "",
      firstName: "",
      lastName: "",
      password: "",
      sendVerificationEmail: true,
    },
  })

  const handleClose = () => {
    form.reset({
      email: "",
      firstName: "",
      lastName: "",
      password: "",
      sendVerificationEmail: true,
    })
    onClose()
  }

  const onSubmit = async (data: CreateOrgOwnerFormData) => {
    setIsLoading(true)

    try {
      const response = await createOrgOwnerUser({
        organizationId,
        email: data.email,
        firstName: data.firstName,
        lastName: data.lastName,
        password: data.password,
        sendVerificationEmail: data.sendVerificationEmail,
      })

      if (response.status === "success") {
        toast.success(`Organization owner created for ${data.firstName} ${data.lastName}`)
        handleClose()
        onSuccess?.()
      } else {
        toast.error(response.message || "Failed to create organization owner")
      }
    } catch (error) {
      logger.error('Failed to create org owner', error as Error, { organizationId, email: data.email })
      toast.error("An error occurred while creating the organization owner")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            Create Org Owner for {organizationName}
          </DialogTitle>
          <DialogDescription>
            Create an organization owner account. Owners can manage the organization and assign
            organization admins. You can send a verification email now or configure the account first.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <Input
                    {...field}
                    type="email"
                    autoComplete="email"
                    disabled={isLoading}
                    placeholder="owner@example.com"
                  />
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="firstName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>First Name</FormLabel>
                  <Input
                    {...field}
                    type="text"
                    autoComplete="given-name"
                    disabled={isLoading}
                    placeholder="John"
                  />
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="lastName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Last Name</FormLabel>
                  <Input
                    {...field}
                    type="text"
                    autoComplete="family-name"
                    disabled={isLoading}
                    placeholder="Doe"
                  />
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <div className="relative">
                    <Input
                      {...field}
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      disabled={isLoading}
                    />
                    <button
                      type="button"
                      tabIndex={0}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                      onClick={() => setShowPassword((v) => !v)}
                      disabled={isLoading}
                    >
                      {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="sendVerificationEmail"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    disabled={isLoading}
                  />
                  <div className="space-y-1 leading-none">
                    <FormLabel>
                      Send verification email
                    </FormLabel>
                    <FormDescription>
                      If checked, a verification email will be sent immediately. If unchecked, the account will be created with email verified, allowing you to configure it before notifying the user.
                    </FormDescription>
                  </div>
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
                Create Org Owner
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

