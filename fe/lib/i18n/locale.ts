/**
 * Locale helpers for the custom LanguageProvider stack.
 * URL locales / next-intl are deferred until SEO or ICU plurals require them.
 */

export const SUPPORTED_LANGUAGES = ["en", "es", "ar"] as const

export type Language = (typeof SUPPORTED_LANGUAGES)[number]

export const DEFAULT_LANGUAGE: Language = "en"

/** Cookie read by the root layout for first-paint lang/dir (avoids flash). */
export const LOCALE_COOKIE_NAME = "NEXT_LOCALE"

export const LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365

const RTL_LANGUAGES: ReadonlySet<Language> = new Set(["ar"])

/** BCP 47 tags used for Intl date/number formatting. */
const INTL_LOCALE_BY_LANGUAGE: Record<Language, string> = {
  en: "en-US",
  es: "es-ES",
  /** Western (Latin) numerals — clearer for mixed UI with English content. */
  ar: "ar-EG",
}

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && (SUPPORTED_LANGUAGES as readonly string[]).includes(value)
}

export function parseLanguage(value: unknown, fallback: Language = DEFAULT_LANGUAGE): Language {
  return isLanguage(value) ? value : fallback
}

export function isRtl(language: Language): boolean {
  return RTL_LANGUAGES.has(language)
}

export function getDir(language: Language): "ltr" | "rtl" {
  return isRtl(language) ? "rtl" : "ltr"
}

export function getHtmlLang(language: Language): string {
  return language
}

export function getIntlLocale(language: Language): string {
  return INTL_LOCALE_BY_LANGUAGE[language]
}

/** Parse `document.cookie` / raw Cookie header for NEXT_LOCALE. */
export function readLanguageFromCookieString(
  cookieHeader: string | null | undefined,
  fallback: Language = DEFAULT_LANGUAGE
): Language {
  if (!cookieHeader) return fallback
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE_NAME}=([^;]*)`))
  if (!match?.[1]) return fallback
  try {
    return parseLanguage(decodeURIComponent(match[1].trim()), fallback)
  } catch {
    return fallback
  }
}

/** Client-side: persist preference for the next server render. */
export function writeLocaleCookie(language: Language): void {
  if (typeof document === "undefined") return
  const secure = typeof window !== "undefined" && window.location.protocol === "https:" ? "; Secure" : ""
  document.cookie = `${LOCALE_COOKIE_NAME}=${encodeURIComponent(language)}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${secure}`
}

export function applyDocumentLocale(language: Language): void {
  if (typeof document === "undefined") return
  document.documentElement.lang = getHtmlLang(language)
  document.documentElement.dir = getDir(language)
  document.documentElement.classList.toggle("rtl", isRtl(language))
}

export function formatLocaleDate(
  value: string | Date,
  language: Language,
  options?: Intl.DateTimeFormatOptions
): string {
  if (!value) return ""
  const date = typeof value === "string" ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleDateString(getIntlLocale(language), {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...options,
  })
}

export function formatLocaleDateTime(
  value: string | Date,
  language: Language,
  options?: Intl.DateTimeFormatOptions
): string {
  if (!value) return ""
  const date = typeof value === "string" ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleString(getIntlLocale(language), {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...options,
  })
}

export function formatLocaleNumber(
  value: number,
  language: Language,
  options?: Intl.NumberFormatOptions
): string {
  if (!Number.isFinite(value)) return ""
  return new Intl.NumberFormat(getIntlLocale(language), options).format(value)
}
