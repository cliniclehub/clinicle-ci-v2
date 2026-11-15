import { z } from "zod"

export const INVALID_EMAIL_MESSAGE = "Please enter a valid email address"

/** Shared Zod schema for user-entered email addresses (trim + RFC-style validation). */
export const emailAddressSchema = z
  .string()
  .trim()
  .min(1, "Email is required")
  .email(INVALID_EMAIL_MESSAGE)

export type EmailValidationResult =
  | { ok: true; email: string }
  | { ok: false; message: string }

export function validateEmailAddress(email: string): EmailValidationResult {
  const result = emailAddressSchema.safeParse(email)
  if (!result.success) {
    return {
      ok: false,
      message: result.error.issues[0]?.message ?? INVALID_EMAIL_MESSAGE,
    }
  }
  return { ok: true, email: result.data }
}
