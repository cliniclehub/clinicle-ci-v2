import { z } from "zod"
import { emailAddressSchema } from "@/lib/utils/email-validation"
import {
  hasInsufficientPersonNameLetters,
  normalizePersonName,
  PERSON_NAME_TOO_SHORT_MESSAGE,
} from "@/lib/utils/name-utils"

const personNameField = (requiredMessage: string) =>
  z
    .string()
    .min(1, requiredMessage)
    .max(50)
    .refine((val) => !hasInsufficientPersonNameLetters(val), {
      message: PERSON_NAME_TOO_SHORT_MESSAGE,
    })
    .transform(normalizePersonName)

// User form schemas for validation
export const userBasicInfoSchema = z.object({
  email: emailAddressSchema,
  firstName: personNameField("First name is required"),
  lastName: personNameField("Last name is required"),
  phoneNumber: z.string()
    .refine((val) => !val || val.trim().startsWith("+"), {
      message: "Phone number must start with + for international format (e.g., +1234567890)"
    })
    .refine((val) => {
      if (!val) return true // Optional
      const cleaned = val.trim()
      return cleaned.length >= 8 && /^\+\d+$/.test(cleaned)
    }, {
      message: "Phone number must be in international format with country code (e.g., +1234567890)"
    })
    .transform((val) => val ? val.trim() : val)
    .optional(),
  password: z.string().min(8, "Password must be at least 8 characters").optional(),
  confirmPassword: z.string().optional(),
  locked: z.boolean(),
})

export const userRoleSchema = z.object({
  organizationId: z.string().min(1, "Organization is required"),
  roleKeys: z.array(z.string()).min(1, "At least one role is required"),
})

// Combined schema for create
export const userCreateFormSchema = z.object({
  ...userBasicInfoSchema.shape,
  ...userRoleSchema.shape,
  password: z.string().min(8, "Password must be at least 8 characters"),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords must match",
  path: ["confirmPassword"],
})

// Combined schema for edit (password optional)
export const userEditFormSchema = z.object({
  ...userBasicInfoSchema.shape,
  ...userRoleSchema.shape,
  customProfileSubmissionId: z.string().uuid().optional(),
})

// Type inference
export type UserBasicInfo = z.infer<typeof userBasicInfoSchema>
export type UserRole = z.infer<typeof userRoleSchema>
export type UserCreateForm = z.infer<typeof userCreateFormSchema>
export type UserEditForm = z.infer<typeof userEditFormSchema>

// Extended types for API responses
export interface User extends Omit<UserEditForm, 'password' | 'confirmPassword' | 'organizationId' | 'roleKeys'> {
  id: string
  createdAt: string
  updatedAt: string
  mustChangePassword: boolean
  lastLogin?: string
  // Authentication-related properties
  emailVerified?: boolean
  emailVerifiedAt?: string
  phoneNumber?: string
  phoneVerified?: boolean
  phoneVerifiedAt?: string

  /** False when the account is OAuth-only and has no local password. */
  hasPassword?: boolean
  /** Lowercase provider keys from linked identities, e.g. ["google"]. */
  oauthProviders?: string[]

  lockedUntil?: string
  customProfileSubmissionId?: string
  // For organization users endpoint, the API returns a flat structure
  organizationId?: string
  organizationName?: string
  organizationDomain?: string
  roles?: string[]
}



// Table column type
export interface UserTableRow {
  id: string
  email: string
  firstName: string
  lastName: string
  locked: boolean
  createdAt: string
  updatedAt: string
  roles?: string[]
  organizationId?: string
  organizationName?: string
  organizationDomain?: string
  groups?: any[] // Group memberships
  tags?: any[] // Deprecated: Tags feature removed, always returns empty array
  hasPassword?: boolean
  oauthProviders?: string[]
}

/** OAuth-linked account with no password — admin password reset must stay disabled. */
export function isOAuthOnlyAccount(user: {
  hasPassword?: boolean
  oauthProviders?: string[]
}): boolean {
  return user.hasPassword === false && (user.oauthProviders?.length ?? 0) > 0
}
