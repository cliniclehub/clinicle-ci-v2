"use client"

import { useLanguage } from "@/lib/contexts/language-context"
import {
  formatLocaleDate,
  formatLocaleDateTime,
  formatLocaleNumber,
} from "@/lib/i18n/locale"

/** Locale-aware date/number formatting bound to the active language. */
export function useLocaleFormat() {
  const { language } = useLanguage()

  return {
    language,
    formatDate: (value: string | Date, options?: Intl.DateTimeFormatOptions) =>
      formatLocaleDate(value, language, options),
    formatDateTime: (value: string | Date, options?: Intl.DateTimeFormatOptions) =>
      formatLocaleDateTime(value, language, options),
    formatNumber: (value: number, options?: Intl.NumberFormatOptions) =>
      formatLocaleNumber(value, language, options),
  }
}
