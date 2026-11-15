import { describe, expect, it } from "vitest"

import {
  buildPhoneE164,
  getPhoneValidationError,
  normalizeNationalPhoneDigits,
  normalizePhoneToE164,
  parsePhoneInputValue,
  stripLocalLeadingZero,
} from "@/lib/utils/phone-validation"

describe("phone-validation", () => {
  it("validates and normalizes E.164 numbers", () => {
    expect(getPhoneValidationError("")).toBe("Phone number is required")
    expect(getPhoneValidationError("   ")).toBe("Phone number is required")
    expect(getPhoneValidationError("12")).toBe("Phone number is too short")
    expect(getPhoneValidationError("+1 415 555 2671")).toBeNull()
    expect(getPhoneValidationError("+999999999999999")).toMatch(/Invalid phone/)
    expect(normalizePhoneToE164("+1 (415) 555-2671")).toBe("+14155552671")
    expect(normalizePhoneToE164("bad")).toBeNull()
  })

  it("normalizes national digits and builds E.164", () => {
    expect(stripLocalLeadingZero("0791234567", "JO")).toBe("791234567")
    expect(stripLocalLeadingZero("791234567", "JO")).toBe("791234567")
    expect(stripLocalLeadingZero("04155552671", "US")).toBe("04155552671")
    expect(normalizeNationalPhoneDigits("", "US")).toBe("")
    expect(normalizeNationalPhoneDigits("00 1 415 555 2671", "US")).toBe("4155552671")
    expect(normalizeNationalPhoneDigits("+1 415 555 2671", "US")).toBe("4155552671")
    expect(normalizeNationalPhoneDigits("1", "US")).toBe("")
    expect(normalizeNationalPhoneDigits("0791234567", "JO")).toBe("791234567")
    expect(buildPhoneE164("US", "4155552671")).toBe("+14155552671")
    expect(buildPhoneE164("US", "")).toBe("")
    // Short national may be treated as already including country code digits
    expect(buildPhoneE164("US", "12")).toMatch(/^\+1/)
  })

  it("parses phone input into country + national", () => {
    expect(parsePhoneInputValue("")).toEqual({ countryIso: "US", nationalNumber: "" })
    expect(parsePhoneInputValue("+14155552671")).toEqual({
      countryIso: "US",
      nationalNumber: "4155552671",
    })
    // Partial + values keep preferred country when code matches
    expect(parsePhoneInputValue("+1415", "US")).toEqual({
      countryIso: "US",
      nationalNumber: "415",
    })
    // National digits without +
    expect(parsePhoneInputValue("(415) 555-2671", "US")).toEqual({
      countryIso: "US",
      nationalNumber: "4155552671",
    })
    // Unknown + prefix falls back
    const unknown = parsePhoneInputValue("+999", "US")
    expect(unknown.countryIso).toBe("US")
  })
})
