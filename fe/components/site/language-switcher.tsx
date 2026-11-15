"use client"

import { useLanguage } from "@/lib/contexts/language-context"
import type { Language } from "@/lib/i18n/locale"
import { Globe } from "lucide-react"

const OPTIONS: ReadonlyArray<{ code: Language; nameKey: string }> = [
  { code: "en", nameKey: "profile.english" },
  { code: "es", nameKey: "profile.spanish" },
  { code: "ar", nameKey: "profile.arabic" },
]

/** Compact locale control for auth / public shells. */
export function LanguageSwitcher({ className = "" }: { className?: string }) {
  const { language, setLanguage, t } = useLanguage()

  return (
    <label className={`inline-flex items-center gap-2 text-sm text-muted-foreground ${className}`}>
      <Globe className="h-4 w-4 shrink-0" aria-hidden />
      <span className="sr-only">{t("profile.language")}</span>
      <select
        className="rounded-md border border-border bg-background px-2 py-1 text-foreground"
        value={language}
        onChange={(event) => setLanguage(event.target.value as Language)}
        aria-label={t("profile.language")}
      >
        {OPTIONS.map((option) => (
          <option key={option.code} value={option.code}>
            {t(option.nameKey)}
          </option>
        ))}
      </select>
    </label>
  )
}
