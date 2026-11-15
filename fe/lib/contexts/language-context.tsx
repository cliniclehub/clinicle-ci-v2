"use client"

import type React from "react"
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"

import { getMessages, translateKey } from "@/lib/i18n/messages"
import {
  applyDocumentLocale,
  DEFAULT_LANGUAGE,
  type Language,
  LOCALE_COOKIE_NAME,
  parseLanguage,
  writeLocaleCookie,
} from "@/lib/i18n/locale"

interface LanguageContextType {
  language: Language
  setLanguage: (language: Language) => void
  t: (key: string, vars?: Record<string, string | number>) => string
  dir: "ltr" | "rtl"
  isRtl: boolean
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined)

function readInitialLanguage(): Language {
  if (typeof document === "undefined") return DEFAULT_LANGUAGE

  const cookieMatch = document.cookie.match(new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE_NAME}=([^;]*)`))
  if (cookieMatch?.[1]) {
    try {
      return parseLanguage(decodeURIComponent(cookieMatch[1].trim()))
    } catch {
      /* fall through */
    }
  }

  try {
    const saved = localStorage.getItem("language")
    return parseLanguage(saved)
  } catch {
    return DEFAULT_LANGUAGE
  }
}

export function LanguageProvider({
  children,
  initialLanguage = DEFAULT_LANGUAGE,
}: {
  children: React.ReactNode
  /** From server cookie so first client render matches html lang/dir. */
  initialLanguage?: Language
}) {
  const [language, setLanguageState] = useState<Language>(initialLanguage)

  useEffect(() => {
    const fromStorage = readInitialLanguage()
    if (fromStorage !== language) {
      setLanguageState(fromStorage)
    }
    applyDocumentLocale(fromStorage === language ? language : fromStorage)
    // Sync once on mount; intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only hydrate from cookie/localStorage
  }, [])

  useEffect(() => {
    writeLocaleCookie(language)
    try {
      localStorage.setItem("language", language)
    } catch {
      /* private mode */
    }
    applyDocumentLocale(language)
  }, [language])

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(parseLanguage(next))
  }, [])

  const messages = useMemo(() => getMessages(language), [language])

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => translateKey(messages, key, vars),
    [messages]
  )

  const value = useMemo<LanguageContextType>(
    () => ({
      language,
      setLanguage,
      t,
      dir: language === "ar" ? "rtl" : "ltr",
      isRtl: language === "ar",
    }),
    [language, setLanguage, t]
  )

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLanguage() {
  const context = useContext(LanguageContext)
  if (context === undefined) {
    throw new Error("useLanguage must be used within a LanguageProvider")
  }
  return context
}

export type { Language }
