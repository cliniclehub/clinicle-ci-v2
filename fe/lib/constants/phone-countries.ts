import { getCountries, getCountryCallingCode, type CountryCode } from "libphonenumber-js"

import { COUNTRIES_SORTED } from "@/lib/constants/countries"
import { countryCodeToFlag } from "@/lib/utils/country-flag"

export interface PhoneCountry {
  readonly iso: CountryCode
  readonly name: string
  readonly callingCode: string
  readonly flag: string
}

const nameByIso = new Map(COUNTRIES_SORTED.map((c) => [c.code, c.name]))

/** Countries with dial codes, sorted by display name. */
export const PHONE_COUNTRIES: PhoneCountry[] = getCountries()
  .map((iso) => ({
    iso,
    name: nameByIso.get(iso) ?? iso,
    callingCode: getCountryCallingCode(iso),
    flag: countryCodeToFlag(iso),
  }))
  .sort((a, b) => a.name.localeCompare(b.name))

export const DEFAULT_PHONE_COUNTRY: CountryCode = "US"

export function getPhoneCountry(iso: CountryCode): PhoneCountry | undefined {
  return PHONE_COUNTRIES.find((c) => c.iso === iso)
}

/** Map org country (ISO code or display name) to a phone country, when known. */
export function resolveCountryCodeForPhone(country?: string | null): CountryCode {
  if (!country?.trim()) {
    return DEFAULT_PHONE_COUNTRY
  }
  const trimmed = country.trim()
  if (trimmed.length === 2) {
    const iso = trimmed.toUpperCase() as CountryCode
    if (getPhoneCountry(iso)) {
      return iso
    }
  }
  const byName = PHONE_COUNTRIES.find(
    (c) => c.name.toLowerCase() === trimmed.toLowerCase()
  )
  return byName?.iso ?? DEFAULT_PHONE_COUNTRY
}
