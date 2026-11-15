import { describe, expect, it } from "vitest"

import {
  INVALID_EMAIL_MESSAGE,
  emailAddressSchema,
  validateEmailAddress,
} from "@/lib/utils/email-validation"

describe("email validation", () => {
  it("rejects emails ending with a period", () => {
    const result = validateEmailAddress("student4@example.com.")
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message.length).toBeGreaterThan(0)
    }
  })

  it("accepts and trims valid emails", () => {
    const result = validateEmailAddress("  student4@example.com  ")
    expect(result).toEqual({ ok: true, email: "student4@example.com" })
  })

  it("emailAddressSchema rejects trailing period", () => {
    expect(emailAddressSchema.safeParse("student4@example.com.").success).toBe(false)
  })

  it("rejects empty and malformed emails", () => {
    expect(validateEmailAddress("")).toEqual({
      ok: false,
      message: "Email is required",
    })
    const bad = validateEmailAddress("not-an-email")
    expect(bad.ok).toBe(false)
    if (!bad.ok) {
      expect(bad.message).toBe(INVALID_EMAIL_MESSAGE)
    }
  })
})
