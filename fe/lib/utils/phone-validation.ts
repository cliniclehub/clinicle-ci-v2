import {
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js"

import { DEFAULT_PHONE_COUNTRY } from "@/lib/constants/phone-countries"

/**
 * Mirrors backend phone normalization (E.164).
 * Returns a user-facing error message, or null when valid.
 */
export function getPhoneValidationError(raw: string): string | null {
  const s = raw.trim()
  if (!s) {
    return "Phone number is required"
  }
  const digitsAndPlus = [...s].filter((c) => c === "+" || /\d/.test(c)).join("")
  const digitsOnly = digitsAndPlus.replace(/\+/g, "")
  const candidate = "+" + digitsOnly
  if (candidate.length < 8) {
    return "Phone number is too short"
  }
  if (!/^\+[0-9]+$/.test(candidate)) {
    return "Phone number must contain only digits after the country code"
  }
  const parsed = parsePhoneNumberFromString(candidate)
  if (!parsed || !parsed.isValid()) {
    return "Invalid phone number for the selected country"
  }
  return null
}

export function normalizePhoneToE164(raw: string): string | null {
  if (getPhoneValidationError(raw) !== null) {
    return null
  }
  const digitsAndPlus = [...raw.trim()].filter((c) => c === "+" || /\d/.test(c)).join("")
  const digitsOnly = digitsAndPlus.replace(/\+/g, "")
  const candidate = "+" + digitsOnly
  const parsed = parsePhoneNumberFromString(candidate)
  return parsed?.format("E.164") ?? null
}

/** Strip trunk prefix 0 users often type for local format (not used in NANP +1). */
export function stripLocalLeadingZero(
  nationalDigits: string,
  countryIso: CountryCode
): string {
  const digits = nationalDigits.replace(/\D/g, "")
  if (!digits.startsWith("0")) {
    return digits
  }
  if (getCountryCallingCode(countryIso) === "1") {
    return digits
  }
  return digits.replace(/^0+/, "")
}

/**
 * National field only — strip country code, international prefixes, and trunk 0
 * when the dropdown already supplies the country code.
 */
export function normalizeNationalPhoneDigits(
  raw: string,
  countryIso: CountryCode
): string {
  let digits = raw.replace(/\D/g, "")
  if (!digits) {
    return ""
  }

  if (digits.startsWith("00")) {
    digits = digits.slice(2)
  }

  const code = getCountryCallingCode(countryIso)
  while (digits.startsWith(code) && digits.length > code.length) {
    digits = digits.slice(code.length)
  }
  if (digits === code) {
    digits = ""
  }

  return stripLocalLeadingZero(digits, countryIso)
}

/** Combine independent country + national fields into E.164 for API validation. */
export function buildPhoneE164(countryIso: CountryCode, nationalDigits: string): string {
  const digits = normalizeNationalPhoneDigits(nationalDigits, countryIso)
  if (!digits) return ""
  const parsed = parsePhoneNumberFromString(digits, countryIso)
  if (parsed?.isValid()) {
    return parsed.format("E.164")
  }
  return `+${getCountryCallingCode(countryIso)}${digits}`
}

export function parsePhoneInputValue(
  value: string,
  preferredCountry: CountryCode = DEFAULT_PHONE_COUNTRY
): { countryIso: CountryCode; nationalNumber: string } {
  const trimmed = value.trim()
  if (!trimmed) {
    return { countryIso: preferredCountry, nationalNumber: "" }
  }

  // Only detect country from complete valid numbers — partial values like +10
  // are otherwise misread as Caribbean +1 destinations.
  const parsed = parsePhoneNumberFromString(trimmed)
  if (parsed?.isValid() && parsed.country && parsed.nationalNumber) {
    return {
      countryIso: parsed.country,
      nationalNumber: parsed.nationalNumber,
    }
  }

  if (trimmed.startsWith("+")) {
    const digits = trimmed.replace(/\D/g, "")
    const preferredCode = getCountryCallingCode(preferredCountry)

    if (digits.startsWith(preferredCode)) {
      return {
        countryIso: preferredCountry,
        nationalNumber: digits.slice(preferredCode.length),
      }
    }

    let best: { iso: CountryCode; national: string } | null = null
    for (const iso of getCountries()) {
      const code = getCountryCallingCode(iso)
      if (digits.startsWith(code)) {
        const national = digits.slice(code.length)
        if (!best || code.length > getCountryCallingCode(best.iso).length) {
          best = { iso, national }
        }
      }
    }

    if (best) {
      return { countryIso: best.iso, nationalNumber: best.national }
    }

    return { countryIso: preferredCountry, nationalNumber: "" }
  }

  const digits = trimmed.replace(/\D/g, "")
  return { countryIso: preferredCountry, nationalNumber: digits }
}
