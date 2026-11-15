import {
  DEFAULT_LANGUAGE,
  formatLocaleDate,
  formatLocaleDateTime,
  getIntlLocale,
  type Language,
  parseLanguage,
} from "@/lib/i18n/locale"

/**
 * Format a date string to a localized date string
 * @param dateString - ISO date string
 * @param options - Intl.DateTimeFormatOptions
 * @param language - App language (`en` | `es` | `ar`); defaults to English
 * @returns Formatted date string
 */
export function formatDate(
  dateString: string | Date,
  options?: Intl.DateTimeFormatOptions,
  language: Language = DEFAULT_LANGUAGE
): string {
  return formatLocaleDate(dateString, parseLanguage(language), options)
}

/**
 * Format a date string to a localized date and time string
 * @param dateString - ISO date string
 * @param options - Intl.DateTimeFormatOptions
 * @param language - App language (`en` | `es` | `ar`); defaults to English
 * @returns Formatted date and time string
 */
export function formatDateTime(
  dateString: string | Date,
  options?: Intl.DateTimeFormatOptions,
  language: Language = DEFAULT_LANGUAGE
): string {
  return formatLocaleDateTime(dateString, parseLanguage(language), options)
}

/**
 * Get relative time string (e.g., "2 hours ago", "in 3 days")
 * @param dateString - ISO date string
 * @param language - App language for RelativeTimeFormat
 * @returns Relative time string
 */
export function getRelativeTime(
  dateString: string | Date,
  language: Language = DEFAULT_LANGUAGE
): string {
  if (!dateString) return ""
  
  const date = typeof dateString === "string" ? new Date(dateString) : dateString
  const now = new Date()
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000)
  
  const units: Array<[number, string]> = [
    [60, "second"],
    [60, "minute"],
    [24, "hour"],
    [7, "day"],
    [4, "week"],
    [12, "month"],
    [Infinity, "year"],
  ]
  
  let value = Math.abs(diffInSeconds)
  let unit = "second"
  
  for (const [divisor, unitName] of units) {
    if (value < divisor) {
      unit = unitName
      break
    }
    value = Math.floor(value / divisor)
  }
  
  const rtf = new Intl.RelativeTimeFormat(getIntlLocale(parseLanguage(language)), {
    numeric: "auto",
  })
  return rtf.format(diffInSeconds < 0 ? value : -value, unit as Intl.RelativeTimeFormatUnit)
}

/**
 * Check if a date is in the past
 * @param dateString - ISO date string
 * @returns true if the date is in the past
 */
export function isPastDate(dateString: string | Date): boolean {
  if (!dateString) return false
  
  const date = typeof dateString === "string" ? new Date(dateString) : dateString
  return date < new Date()
}

/**
 * Check if a date is today
 * @param dateString - ISO date string
 * @returns true if the date is today
 */
export function isToday(dateString: string | Date): boolean {
  if (!dateString) return false
  
  const date = typeof dateString === "string" ? new Date(dateString) : dateString
  const today = new Date()
  
  return (
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear()
  )
}

/**
 * Convert a UTC ISO string (from API) to the value for <input type="datetime-local">.
 * datetime-local expects "YYYY-MM-DDTHH:mm" in the user's local timezone.
 * @param iso - ISO 8601 string (e.g. "2025-03-10T19:30:00.000Z")
 * @returns Local datetime string for the input, or "" if invalid
 */
export function toDatetimeLocalString(iso: string): string {
  if (!iso?.trim()) return ""
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ""
    const offset = d.getTimezoneOffset() * 60000
    const local = new Date(d.getTime() - offset)
    return local.toISOString().slice(0, 16)
  } catch {
    return ""
  }
}

/**
 * Convert the value from <input type="datetime-local"> (user's local time) to UTC ISO for the API.
 * @param localValue - "YYYY-MM-DDTHH:mm" in user's local timezone
 * @returns UTC ISO string (e.g. "2025-03-10T19:30:00.000Z"), or "" if invalid
 */
export function fromDatetimeLocalToISO(localValue: string): string {
  if (!localValue?.trim()) return ""
  try {
    return new Date(localValue).toISOString()
  } catch {
    return ""
  }
}