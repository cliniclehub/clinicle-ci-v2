"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { type CountryCode } from "libphonenumber-js"
import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { FormFooter } from "@/components/ui/form-footer"
import { FormSection } from "@/components/ui/form-section"
import { Input } from "@/components/ui/input"
import { PhoneInput } from "@/components/ui/phone-input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  hasInsufficientPersonNameLetters,
  looksLikeIncompletePersonName,
  normalizePersonName,
  PERSON_NAME_TOO_SHORT_MESSAGE,
  SHORT_PERSON_NAME_WARNING,
} from "@/lib/utils/name-utils"
import { Switch } from "@/components/ui/switch"
import { Eye, EyeOff, Key } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { ChangePasswordDialog } from "@/components/users/change-password-dialog"
import { listOrganizationsDropdown } from "@/lib/actions/organizations/organizations-org-actions"
import { getCurrentUser, updateCurrentUserBasicInfo } from "@/lib/actions/users/users-me-actions"
import {
  createUser as createUserOrg,
  updateUser as updateUserOrg
} from "@/lib/actions/users/users-org-actions"
import {
  createUser as createUserPlatform,
  updateUser as updateUserPlatform
} from "@/lib/actions/users/users-platform-actions"
import { resolveCountryCodeForPhone } from "@/lib/constants/phone-countries"
import { Organization } from "@/lib/types/organization-schema"
import { User, isOAuthOnlyAccount } from "@/lib/types/user-schema"
import { handleApiErrorResponse } from "@/lib/utils/api-error-handler"
import { emailAddressSchema, validateEmailAddress } from "@/lib/utils/email-validation"
import { createClientLogger } from "@/lib/utils/logger-client"
import {
  buildPhoneE164,
  getPhoneValidationError,
  normalizePhoneToE164,
  parsePhoneInputValue,
} from "@/lib/utils/phone-validation"
import { CheckCircle2, Pencil, Shield } from "lucide-react"
import { useCallback, useRef } from "react"
import { EmailVerificationDialog } from "./email-verification-dialog"
import { PhoneVerificationDialog } from "./phone-verification-dialog"

// Password validation function matching change password dialog
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

const optionalPhoneSchema = z
  .string()
  .optional()
  .superRefine((val, ctx) => {
    if (!val?.trim()) return
    const err = getPhoneValidationError(val.trim())
    if (err) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: err })
    }
  })

const requiredPhoneSchema = z
  .string()
  .superRefine((val, ctx) => {
    const err = getPhoneValidationError(val?.trim() || "")
    if (err) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: err })
    }
  })
  .transform((val) => val.trim())

const personNameField = (requiredMessage: string) =>
  z
    .string()
    .min(1, requiredMessage)
    .max(50)
    .refine((val) => !hasInsufficientPersonNameLetters(val), {
      message: PERSON_NAME_TOO_SHORT_MESSAGE,
    })
    .transform(normalizePersonName)

// Schema for create mode (includes password)
const createSchema = z.object({
  email: emailAddressSchema,
  firstName: personNameField("First name is required"),
  lastName: personNameField("Last name is required"),
  phoneNumber: optionalPhoneSchema,
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
  confirmPassword: z.string(),
  organizationId: z.string().min(1, "Organization is required"),
  locked: z.boolean(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords must match",
  path: ["confirmPassword"],
})

// Schema for edit mode (no password)
const editSchema = z.object({
  email: emailAddressSchema,
  firstName: personNameField("First name is required"),
  lastName: personNameField("Last name is required"),
  phoneNumber: optionalPhoneSchema,
  organizationId: z.string().min(1, "Organization is required"),
  locked: z.boolean(),
})

type CreateFormData = z.infer<typeof createSchema>
type EditFormData = z.infer<typeof editSchema>
type BasicInfoFormData = CreateFormData | EditFormData

function formatOAuthProvidersForMessage(providers: string[] | undefined): string {
  if (!providers?.length) return ""
  return providers
    .map((p) =>
      p.toLowerCase() === "google"
        ? "Google"
        : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()
    )
    .join(" and ")
}

function GoogleLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  )
}

interface BasicInfoSectionProps {
  user?: User
  organization?: Organization
  mode: "create" | "edit"
  isOrgAdmin?: boolean
  isCurrentUser?: boolean
  organizationId?: string
  userRole?: "super_admin" | "org_owner" | "org_admin" | "me"
  onDirtyChange: (isDirty: boolean) => void
  onCancel: () => void
  onSuccess?: (user: User) => void
}

export function BasicInfoSection({
  user,
  organization,
  mode,
  isOrgAdmin,
  isCurrentUser,
  organizationId,
  userRole = "me",
  onDirtyChange,
  onCancel,
  onSuccess,
}: BasicInfoSectionProps) {
  const [isSaving, setIsSaving] = useState(false)
  const [organizations, setOrganizations] = useState<Array<{ id: string; name: string }>>([])
  const [showPasswordDialog, setShowPasswordDialog] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [passwordErrors, setPasswordErrors] = useState<string[]>([])
  const [showVerificationDialog, setShowVerificationDialog] = useState(false)
  const [showEmailVerificationDialog, setShowEmailVerificationDialog] = useState(false)
  const [isEditingPhone, setIsEditingPhone] = useState(false)
  const [isEditingEmail, setIsEditingEmail] = useState(false)
  const [originalPhoneNumber, setOriginalPhoneNumber] = useState<string | undefined>(undefined)
  const [originalEmail, setOriginalEmail] = useState<string | undefined>(undefined)
  const [verifiedEmail, setVerifiedEmail] = useState<string | null>(null)  // Track which email has been verified
  const [verifiedPhone, setVerifiedPhone] = useState<string | null>(null)  // Track which phone has been verified
  
  const logger = createClientLogger('BasicInfoSection')

  // Show phone input only when the organization enforces SMS verification.
  const showPhoneNumberField = organization?.enforcePhoneValidation === true

  // Create dynamic schema based on whether phone validation is required
  const requiresPhoneValidation = showPhoneNumberField && isCurrentUser && mode === "edit"
  const dynamicEditSchema = requiresPhoneValidation
    ? editSchema.extend({ phoneNumber: requiredPhoneSchema })
    : editSchema

  const preferredPhoneCountry = resolveCountryCodeForPhone(organization?.country)
  const [phoneCountry, setPhoneCountry] = useState<CountryCode>(preferredPhoneCountry)
  const [phoneNational, setPhoneNational] = useState("")
  const phoneCountryTouched = useRef(false)

  const applyPhoneFields = useCallback(
    (e164: string | undefined, resetCountryTouched = false) => {
      if (resetCountryTouched) {
        phoneCountryTouched.current = false
      }
      if (!e164?.trim()) {
        setPhoneNational("")
        if (!phoneCountryTouched.current) {
          setPhoneCountry(preferredPhoneCountry)
        }
        return
      }
      const parsed = parsePhoneInputValue(e164, preferredPhoneCountry)
      if (!phoneCountryTouched.current) {
        setPhoneCountry(parsed.countryIso)
      }
      setPhoneNational(parsed.nationalNumber)
    },
    [preferredPhoneCountry]
  )

  const form = useForm<BasicInfoFormData>({
    resolver: zodResolver(mode === "create" ? createSchema : dynamicEditSchema),
    defaultValues: mode === "create"
      ? {
          email: "",
          firstName: "",
          lastName: "",
          phoneNumber: "",
          password: "",
          confirmPassword: "",
          organizationId: isOrgAdmin ? organizationId || "" : organizationId || "",
          locked: false,
        }
      : {
          email: user?.email || "",
          firstName: user?.firstName || "",
          lastName: user?.lastName || "",
          phoneNumber: user?.phoneNumber || "",
          organizationId: user?.organizationId || organizationId || "",
          locked: user?.locked || false,
        },
  })

  const { formState: { isDirty, dirtyFields, isValid } } = form

  // Email and phone are saved immediately on verification - they don't trigger main form dirty.
  // Only firstName, lastName, organizationId, locked (and password in create) count.
  const createDirty = dirtyFields as Partial<Record<keyof CreateFormData, boolean>>
  const effectiveDirty =
    mode === "create"
      ? !!(
          createDirty.firstName ||
          createDirty.lastName ||
          createDirty.organizationId ||
          createDirty.locked ||
          createDirty.password ||
          createDirty.confirmPassword
        )
      : !!(dirtyFields.firstName || dirtyFields.lastName || dirtyFields.organizationId || dirtyFields.locked)

  // Update parent component when dirty state changes
  useEffect(() => {
    onDirtyChange(effectiveDirty)
  }, [effectiveDirty, onDirtyChange])

  useEffect(() => {
    if (phoneCountryTouched.current || !organization?.country) return
    setPhoneCountry(resolveCountryCodeForPhone(organization.country))
  }, [organization?.country])

  // Handle password field changes to show real-time validation
  const handlePasswordChange = (value: string) => {
    if (value) {
      const errors = validatePasswordStrength(value)
      setPasswordErrors(errors)
    } else {
      setPasswordErrors([])
    }
  }


  // Update form when user data changes
  const formInitializedRef = useRef(false)
  const lastUserIdRef = useRef<string | undefined>(undefined)
  
  useEffect(() => {
    if (user && mode === "edit") {
      // Only reset if user ID changed or form not initialized
      if (user.id !== lastUserIdRef.current || !formInitializedRef.current) {
        form.reset({
          email: user.email || "",
          firstName: user.firstName || "",
          lastName: user.lastName || "",
          phoneNumber: user.phoneNumber || "",
          organizationId: user.organizationId || "",
          locked: user.locked || false,
        })
        applyPhoneFields(user.phoneNumber, true)
        formInitializedRef.current = true
        lastUserIdRef.current = user.id
        setIsEditingPhone(false)
        setIsEditingEmail(false)
        // Reset original values when form is reset
        setOriginalPhoneNumber(undefined)
        setOriginalEmail(undefined)
        setVerifiedEmail(null)  // Reset verified email when form is reset
        setVerifiedPhone(null)  // Reset verified phone when form is reset
      }
    }
  }, [user?.id, mode, form, applyPhoneFields])
  
  // Handle phone verification completion - backend saves phone immediately when saveOnVerify=true
  const handleVerificationComplete = useCallback(async () => {
    if (!isCurrentUser || !user) return
    try {
      const profileResponse = await getCurrentUser()
      if (profileResponse.status === "success" && profileResponse.data) {
        const updatedUser = profileResponse.data
        form.reset({
          email: updatedUser.email || "",
          firstName: updatedUser.firstName || "",
          lastName: updatedUser.lastName || "",
          phoneNumber: updatedUser.phoneNumber || "",
          organizationId: updatedUser.organizationId || "",
          locked: updatedUser.locked || false,
        })
        applyPhoneFields(updatedUser.phoneNumber, true)
        setVerifiedPhone(updatedUser.phoneNumber || null)
        setIsEditingPhone(false)
        setOriginalPhoneNumber(undefined)
        onSuccess?.(updatedUser)
      }
    } catch (error) {
      logger.error("Failed to refresh after phone verification", error as Error)
    }
  }, [isCurrentUser, user, form, onSuccess, applyPhoneFields])

  // Handle email verification completion - backend saves email immediately in verify_code
  const handleEmailVerificationComplete = useCallback(async () => {
    if (!isCurrentUser || !user) return
    try {
      const profileResponse = await getCurrentUser()
      if (profileResponse.status === "success" && profileResponse.data) {
        const updatedUser = profileResponse.data
        onSuccess?.(updatedUser)
        // Reload page so profile email refreshes everywhere (header, auth context, etc.)
        window.location.reload()
      }
    } catch (error) {
      logger.error("Failed to refresh after email verification", error as Error)
    }
  }, [isCurrentUser, user, onSuccess])

  // Fetch organizations for dropdown
  useEffect(() => {
    const fetchOrganizations = async () => {
      // Don't fetch organizations if:
      // 1. User is org admin (they can only work within their org)
      // 2. Mode is edit (organization is already set and shouldn't be changed)
      // 3. User role is not super_admin (only super admins can assign users to different orgs)
      if (isOrgAdmin || mode === "edit" || userRole !== "super_admin") {
        return
      }

      try {
        const response = await listOrganizationsDropdown()
        if (handleApiErrorResponse(response, "Failed to fetch organizations")) {
          return
        } else if (response.status === "success" && response.data) {
          setOrganizations(response.data)
        }
      } catch (error) {
        logger.error('Failed to fetch organizations', error as Error)
      }
    }

    fetchOrganizations()
  }, [isOrgAdmin, mode, userRole])

  const onSubmit = async (data: BasicInfoFormData) => {
    const methodLogger = logger.forMethod('onSubmit')
    
    // Check if phone verification is required and phone is not verified
    if (showPhoneNumberField && isCurrentUser && mode === "edit") {
      // Phone number is required when validation is enforced
      if (!data.phoneNumber || !data.phoneNumber.trim()) {
        toast.error("Phone number is required. Please enter your phone number.")
        return
      }
      
      const currentPhone = user?.phoneNumber?.trim()
      const newPhone =
        normalizePhoneToE164(data.phoneNumber.trim()) ?? data.phoneNumber.trim()

      const normalizedCurrent =
        (currentPhone && normalizePhoneToE164(currentPhone)) || currentPhone || ""
      const normalizedNew = newPhone
      const isPhoneChanged = normalizedCurrent !== normalizedNew
      
      // Check if this is first-time phone addition (user had no phone before)
      const isFirstTimeAddition = !user?.phoneNumber || !user.phoneNumber.trim()
      
      // If phone changed, check if it's been verified (similar to email workflow)
      if (isPhoneChanged) {
        if (isFirstTimeAddition) {
          // First-time phone addition - allow without verification
          // User will verify later through the verify-phone page flow
          // Continue to submit
        } else {
          // Phone changed from existing number - requires verification
          // Check if the new phone matches the verified phone in our state
          if (!verifiedPhone || verifiedPhone !== normalizedNew) {
            toast.error(
              "Phone number has changed and must be verified before saving. Please verify your phone number using the verification button."
            )
            return
          }
          // Phone is verified - allow saving, continue to submit
        }
      } else {
        // Phone hasn't changed - check if it's verified from API/user object
        let isPhoneVerified = user?.phoneVerified || false
        try {
          const { getPhoneVerificationStatus } = await import("@/lib/actions/users/phone-verification-actions")
          const statusResponse = await getPhoneVerificationStatus()
          if (statusResponse.status === "success" && statusResponse.data) {
            // Use API status if available, otherwise fall back to user object
            isPhoneVerified = statusResponse.data.phoneVerified || isPhoneVerified
          }
        } catch (error) {
          methodLogger.error("Failed to check verification status", error as Error)
          // Continue with user object value
        }
        
        if (!isPhoneVerified) {
          // Phone hasn't changed but is not verified
          toast.error(
            "Phone number must be verified before saving. Please verify your phone number using the verification button."
          )
          return
        }
        // Phone is verified and unchanged - allow saving, continue to submit
      }
    }
    
    // Check if email verification is required for current user editing their own profile
    if (isCurrentUser && mode === "edit") {
      const currentEmail = user?.email?.trim().toLowerCase()
      const newEmail = data.email?.trim().toLowerCase()
      const isEmailChanged = currentEmail !== newEmail
      
      // If email changed, check if it's been verified
      if (isEmailChanged) {
        // Check if the new email matches the verified email in our state
        if (!verifiedEmail || verifiedEmail !== newEmail) {
          toast.error(
            "Email address has changed and must be verified before saving. Please verify your email address using the verification button."
          )
          return
        }
        // Email is verified - allow saving, continue to submit
      }
      // If email hasn't changed, allow saving (no verification needed for unchanged email)
    }
    
    setIsSaving(true)
    
    try {
      if (mode === "create") {
        const createData = data as CreateFormData
        const { confirmPassword, ...userData } = createData
        // Ensure roles are sent to the API (mapped in createUser action)
        let roleKeys = (user as any)?.roleKeys || [];
        if (!roleKeys.length && (userRole === "org_admin" || isOrgAdmin)) {
          roleKeys = ["user"];
        }
        // For org admin, always set organizationId
        const finalUserData = isOrgAdmin
          ? { ...userData, organizationId: organizationId || "" }
          : userData;
        // Choose the correct create function based on user role
        const createUser = userRole === "super_admin" ? createUserPlatform : createUserOrg
        const response = await createUser({
          ...finalUserData,
          confirmPassword: createData.confirmPassword,
          roleKeys,
        })
        
        if (handleApiErrorResponse(response, "Failed to create user")) {
          return
        } else if (response.status === "success") {
          toast.success("User created successfully")
          onSuccess?.(response.data)
        }
      } else if (user) {
        const updateData = data as EditFormData
        
        // Use appropriate endpoint based on context
        let response;
        if (isCurrentUser) {
          response = await updateCurrentUserBasicInfo(updateData)
        } else {
          // Choose the correct update function based on user role
          const updateUser = userRole === "super_admin" ? updateUserPlatform : updateUserOrg
          response = await updateUser(user.id, updateData)
        }
        
        if (handleApiErrorResponse(response, "Failed to save basic information")) {
          return
        } else if (response.status === "success") {
          toast.success("Basic information saved successfully")
          form.reset(updateData)
          onSuccess?.(response.data)
        }
      }
    } catch (error) {
      methodLogger.error('Form submission failed', error as Error, { data })
      toast.error("An error occurred while saving")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Card className="min-w-0 overflow-hidden">
      <CardContent className="min-w-0 overflow-hidden pt-6">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormSection
              id="basic-info"
              title="Profile"
              description="User account details and credentials"
              isDirty={effectiveDirty}
            >
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => {
                  const isEmailVerified = user?.emailVerified || false
                  const showEmailVerification = isCurrentUser && mode === "edit"
                  // Show badge when editing another user (organization users edit page) and email is verified
                  // OR when it's the current user with verified email (existing behavior)
                  const showVerifiedBadge = (!isCurrentUser && mode === "edit" && isEmailVerified) || (showEmailVerification && isEmailVerified && !isEditingEmail)
                  const isReadOnly = (!isCurrentUser && mode === "edit") || (showEmailVerification && isEmailVerified && !isEditingEmail)

                  return (
                    <FormItem>
                      <FormLabel>Email Address</FormLabel>
                      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
                        <FormControl>
                          <div className="relative min-w-0 flex-1">
                            <Input
                              {...field}
                              type="email"
                              placeholder="user@example.com"
                              disabled={isReadOnly || (mode === "edit" && !isCurrentUser)}
                              readOnly={isReadOnly}
                              className={showVerifiedBadge ? "pr-20 bg-muted cursor-not-allowed" : ""}
                            />
                            {showVerifiedBadge && (
                              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                                <Badge variant="default" className="bg-green-500 text-xs">
                                  <CheckCircle2 className="h-3 w-3 mr-1" />
                                  Verified
                                </Badge>
                              </div>
                            )}
                          </div>
                        </FormControl>
                        {showEmailVerification && (
                          <div className="flex shrink-0 flex-wrap items-center gap-2">
                            {isEmailVerified && !isEditingEmail ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setIsEditingEmail(true)
                                  setOriginalEmail(field.value || user?.email || "")
                                }}
                                title="Edit email address"
                              >
                                <Pencil className="h-4 w-4 mr-1" />
                                Edit
                              </Button>
                            ) : (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  const validation = validateEmailAddress(field.value || "")
                                  if (!validation.ok) {
                                    toast.error(validation.message)
                                    return
                                  }
                                  setShowEmailVerificationDialog(true)
                                }}
                                disabled={!field.value || (originalEmail !== undefined && field.value?.trim() === originalEmail.trim())}
                                title={originalEmail !== undefined && field.value?.trim() === originalEmail.trim() 
                                  ? "Email address must be changed to verify" 
                                  : "Verify email address"}
                              >
                                <Shield className="h-4 w-4 mr-1" />
                                Verify
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                      <FormDescription>
                        {mode === "edit" && !isCurrentUser
                          ? "Email cannot be changed after account creation"
                          : isCurrentUser && mode === "edit"
                          ? "Click Edit to change your email. It will be saved automatically after verification."
                          : "This will be the user's login email"
                        }
                        {showEmailVerification && !isEmailVerified && isEditingEmail && (
                          <span className="block mt-1 text-yellow-600 dark:text-yellow-400">
                            Click Verify to save your new email address
                          </span>
                        )}
                      </FormDescription>
                      <FormMessage />
                      {showEmailVerification && (
                        <EmailVerificationDialog
                          open={showEmailVerificationDialog}
                          onOpenChange={setShowEmailVerificationDialog}
                          email={field.value || ""}
                          onVerificationComplete={handleEmailVerificationComplete}
                        />
                      )}
                    </FormItem>
                  )
                }}
              />

              <div className="grid gap-4 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>First Name</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="John" />
                      </FormControl>
                      {looksLikeIncompletePersonName(field.value) ? (
                        <FormDescription className="text-amber-700 dark:text-amber-400">
                          {SHORT_PERSON_NAME_WARNING}
                        </FormDescription>
                      ) : null}
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
                      <FormControl>
                        <Input {...field} placeholder="Doe" />
                      </FormControl>
                      {looksLikeIncompletePersonName(field.value) ? (
                        <FormDescription className="text-amber-700 dark:text-amber-400">
                          {SHORT_PERSON_NAME_WARNING}
                        </FormDescription>
                      ) : null}
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {showPhoneNumberField && (
              <FormField
                control={form.control}
                name="phoneNumber"
                render={({ field }) => {
                  const isPhoneVerified = user?.phoneVerified || false
                  const showVerification = isCurrentUser && showPhoneNumberField
                  // Make phone number read-only when editing another user (organization users edit page)
                  // OR when it's the current user with verified phone (existing behavior)
                  const isReadOnly = !isCurrentUser || (showVerification && isPhoneVerified && !isEditingPhone)
                  
                  const hasPhoneNumber = phoneNational.trim().length > 0

                  // Only show verified badge if phone exists and is verified
                  const showVerifiedBadge = isReadOnly && hasPhoneNumber && isPhoneVerified

                  const syncPhoneToForm = (country: CountryCode, national: string) => {
                    field.onChange(buildPhoneE164(country, national))
                  }

                  return (
                    <FormItem>
                      <FormLabel>
                        Phone Number
                        {showVerification && <span className="text-red-500 ml-1">*</span>}
                      </FormLabel>
                      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
                        <FormControl>
                          <div className="relative min-w-0 flex-1">
                            <PhoneInput
                              id="basic-info-phone-country"
                              inputId="basic-info-phone"
                              country={phoneCountry}
                              onCountryChange={(iso) => {
                                if (isReadOnly) return
                                phoneCountryTouched.current = true
                                setPhoneCountry(iso)
                                syncPhoneToForm(iso, phoneNational)
                              }}
                              nationalNumber={phoneNational}
                              onNationalNumberChange={(digits) => {
                                if (isReadOnly) return
                                setPhoneNational(digits)
                                syncPhoneToForm(phoneCountry, digits)
                              }}
                              disabled={isReadOnly}
                              placeholder="791234567"
                              aria-label="Phone number"
                              className={isReadOnly ? "[&_input]:bg-muted [&_input]:cursor-not-allowed" : ""}
                            />
                            {showVerifiedBadge && (
                              <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                                <Badge variant="default" className="bg-green-500 text-xs">
                                  <CheckCircle2 className="h-3 w-3 mr-1" />
                                  Verified
                                </Badge>
                              </div>
                            )}
                            {isReadOnly && !hasPhoneNumber && (
                              <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                                <Badge variant="secondary" className="text-xs">
                                  Not provided
                                </Badge>
                              </div>
                            )}
                          </div>
                        </FormControl>
                        {showVerification && (
                          <div className="flex shrink-0 flex-wrap items-center gap-2">
                            {isPhoneVerified && !isEditingPhone ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setIsEditingPhone(true)
                                  setOriginalPhoneNumber(field.value || user?.phoneNumber || "")
                                }}
                                title="Edit phone number"
                              >
                                <Pencil className="h-4 w-4 mr-1" />
                                Edit
                              </Button>
                            ) : (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setShowVerificationDialog(true)}
                                disabled={
                                  !phoneNational.trim() ||
                                  (originalPhoneNumber !== undefined &&
                                    (normalizePhoneToE164(field.value || "") ||
                                      field.value?.trim()) ===
                                      (normalizePhoneToE164(originalPhoneNumber) ||
                                        originalPhoneNumber.trim()))
                                }
                                title={
                                  originalPhoneNumber !== undefined &&
                                  (normalizePhoneToE164(field.value || "") ||
                                    field.value?.trim()) ===
                                    (normalizePhoneToE164(originalPhoneNumber) ||
                                      originalPhoneNumber.trim())
                                    ? "Phone number must be changed to verify"
                                    : "Verify phone number"
                                }
                              >
                                <Shield className="h-4 w-4 mr-1" />
                                Verify
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                      <FormDescription id="basic-info-phone-hint">
                        {!isCurrentUser
                          ? "Phone number cannot be changed after account creation"
                          : "Select your country, then enter your local number — no country code, leading zero, or + sign. Click Edit to change; phone is saved after verification."
                        }
                        {showVerification && !isPhoneVerified && isEditingPhone && (
                          <span className="block mt-1 text-yellow-600 dark:text-yellow-400">
                            Click Verify to save your new phone number
                          </span>
                        )}
                      </FormDescription>
                      <FormMessage />
                      {showVerification && (
                        <PhoneVerificationDialog
                          open={showVerificationDialog}
                          onOpenChange={setShowVerificationDialog}
                          phoneNumber={field.value || ""}
                          onVerificationComplete={handleVerificationComplete}
                          saveOnVerify={isCurrentUser}
                        />
                      )}
                    </FormItem>
                  )
                }}
              />
              )}

              {/* Only show organization field for super admin creating users */}
              {userRole === "super_admin" && mode === "create" && (
                <FormField
                  control={form.control}
                  name="organizationId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Organization</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                        disabled={false}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select organization" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {organizations.map((org) => (
                            <SelectItem key={org.id} value={org.id}>
                              {org.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {/* Show organization info for edit mode (read-only) */}
              {mode === "edit" && user?.organizationName && (
                <FormField
                  control={form.control}
                  name="organizationId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Organization</FormLabel>
                      <Input
                        value={user.organizationName}
                        disabled
                        aria-label="Organization"
                      />
                      <FormDescription>
                        Organization cannot be changed.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {mode === "create" && (
                <div className="grid gap-4 md:grid-cols-2">
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
                            placeholder="••••••••"
                            onChange={(e) => {
                              field.onChange(e)
                              handlePasswordChange(e.target.value)
                            }}
                          />
                          <button
                            type="button"
                            tabIndex={0}
                            aria-label={showPassword ? "Hide password" : "Show password"}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                            onClick={() => setShowPassword((v) => !v)}
                          >
                            {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
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
                        <FormLabel>Confirm Password</FormLabel>
                        <div className="relative">
                          <Input
                            {...field}
                            type={showConfirmPassword ? "text" : "password"}
                            placeholder="••••••••"
                          />
                          <button
                            type="button"
                            tabIndex={0}
                            aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                            onClick={() => setShowConfirmPassword((v) => !v)}
                          >
                            {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                          </button>
                        </div>
                        <FormDescription>
                          Re-enter the password to confirm
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}

              {mode === "edit" && (
                isCurrentUser && user ? (
                  <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
                    <div>
                      <p className="text-sm font-medium">Sign-in Methods</p>
                      <p className="text-sm text-muted-foreground">
                        Manage how you sign in to this platform account.
                      </p>
                    </div>

                    <div className="grid gap-3">
                      <div className="rounded-md border bg-background p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <div className="rounded-md border bg-muted p-1.5">
                              <Shield className="h-4 w-4 text-foreground" />
                            </div>
                            <div>
                              <p className="text-sm font-medium">Platform</p>
                              <p className="text-xs text-muted-foreground">Email and password</p>
                            </div>
                          </div>
                          <Badge variant={user.hasPassword === false ? "secondary" : "default"}>
                            {user.hasPassword === false ? "Not enabled" : "Enabled"}
                          </Badge>
                        </div>

                        <div className="mt-3">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => setShowPasswordDialog(true)}
                          >
                            <Key className="mr-2 h-4 w-4" />
                            {user.hasPassword === false ? "Create Password" : "Change Password"}
                          </Button>
                        </div>
                      </div>

                      <div className="rounded-md border bg-background p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <div className="rounded-md border bg-muted p-1.5">
                              <GoogleLogo className="h-4 w-4" />
                            </div>
                            <div>
                              <p className="text-sm font-medium">Google</p>
                              <p className="text-xs text-muted-foreground">Social sign-in</p>
                            </div>
                          </div>
                          <Badge
                            variant={(user.oauthProviders || []).some((p) => p.toLowerCase() === "google") ? "default" : "secondary"}
                          >
                            {(user.oauthProviders || []).some((p) => p.toLowerCase() === "google") ? "Enabled" : "Not enabled"}
                          </Badge>
                        </div>

                        {(user.oauthProviders || []).some((p) => p.toLowerCase() === "google") ? (
                          <p className="mt-3 text-xs text-muted-foreground">
                            Google sign-in is enabled for this account.
                          </p>
                        ) : (
                          <p className="mt-3 text-xs text-muted-foreground">
                            Not enabled yet. You can enable it from the login page by selecting{" "}
                            <span className="font-medium text-foreground">&quot;Sign in with Google&quot;</span> using this same email.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
                    <div>
                      <p className="text-sm font-medium">Sign-in Methods</p>
                      <p className="text-sm text-muted-foreground">
                        {isCurrentUser
                          ? "Manage how you sign in to this platform account."
                          : "Current sign-in methods for this user account."}
                      </p>
                    </div>

                    <div className="grid gap-3">
                      <div className="rounded-md border bg-background p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <div className="rounded-md border bg-muted p-1.5">
                              <Shield className="h-4 w-4 text-foreground" />
                            </div>
                            <div>
                              <p className="text-sm font-medium">Platform</p>
                              <p className="text-xs text-muted-foreground">Email and password</p>
                            </div>
                          </div>
                          <Badge variant={user?.hasPassword === false ? "secondary" : "default"}>
                            {user?.hasPassword === false ? "Not enabled" : "Enabled"}
                          </Badge>
                        </div>

                        <div className="mt-3">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => setShowPasswordDialog(true)}
                            disabled={!isCurrentUser && !!(user && isOAuthOnlyAccount(user))}
                          >
                            <Key className="mr-2 h-4 w-4" />
                            {user?.hasPassword === false ? "Create Password" : "Change Password"}
                          </Button>
                        </div>
                        {!isCurrentUser && user && isOAuthOnlyAccount(user) && (
                          <p className="mt-2 text-xs text-muted-foreground">
                            Admins cannot set a password for OAuth-only users from this panel.
                          </p>
                        )}
                      </div>

                      <div className="rounded-md border bg-background p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <div className="rounded-md border bg-muted p-1.5">
                              <GoogleLogo className="h-4 w-4" />
                            </div>
                            <div>
                              <p className="text-sm font-medium">Google</p>
                              <p className="text-xs text-muted-foreground">Social sign-in</p>
                            </div>
                          </div>
                          <Badge
                            variant={(user?.oauthProviders || []).some((p) => p.toLowerCase() === "google") ? "default" : "secondary"}
                          >
                            {(user?.oauthProviders || []).some((p) => p.toLowerCase() === "google") ? "Enabled" : "Not enabled"}
                          </Badge>
                        </div>

                        {(user?.oauthProviders || []).some((p) => p.toLowerCase() === "google") ? (
                          <p className="mt-3 text-xs text-muted-foreground">
                            Google sign-in is enabled for this account.
                          </p>
                        ) : (
                          <p className="mt-3 text-xs text-muted-foreground">
                            {isCurrentUser
                              ? (
                                <>
                                  Not enabled yet. This can be enabled from the login page by selecting{" "}
                                  <span className="font-medium text-foreground">&quot;Sign in with Google&quot;</span> using the same email.
                                </>
                              )
                              : (
                                <>
                                  Not enabled yet. This can be enabled by the user from the login page by selecting{" "}
                                  <span className="font-medium text-foreground">&quot;Sign in with Google&quot;</span> using the same email.
                                </>
                              )}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )
              )}

              {mode === "edit" && !isCurrentUser && (
                <FormField
                  control={form.control}
                  name="locked"
                  render={({ field }) => (
                    <FormItem className="flex min-w-0 flex-col gap-4 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">Account Lock</FormLabel>
                        <FormDescription>
                          Lock this account to prevent login
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              )}
            </FormSection>

            <FormFooter
              onSave={() => form.handleSubmit(onSubmit)()}
              onCancel={onCancel}
              isSaving={isSaving}
              isDirty={effectiveDirty}
              saveLabel={mode === "create" ? "Create User" : "Save Changes"}
            />
          </form>
        </Form>
      </CardContent>
      
      {/* Password Change Dialog */}
      <ChangePasswordDialog
        open={showPasswordDialog}
        onClose={() => setShowPasswordDialog(false)}
        userId={user?.id}
        userName={user ? `${user.firstName} ${user.lastName}` : undefined}
        isCurrentUser={isCurrentUser}
        requireCurrentPassword={!(isCurrentUser && user && isOAuthOnlyAccount(user))}
      />
    </Card>
  )
}
