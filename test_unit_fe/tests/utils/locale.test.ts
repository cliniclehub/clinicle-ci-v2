import { describe, expect, it } from "vitest"

import {
  formatLocaleDate,
  formatLocaleNumber,
  getDir,
  getHtmlLang,
  getIntlLocale,
  isLanguage,
  isRtl,
  parseLanguage,
  readLanguageFromCookieString,
} from "@/lib/i18n/locale"
import { translateKey } from "@/lib/i18n/messages"

describe("locale helpers", () => {
  it("parses supported languages and rejects others", () => {
    expect(isLanguage("ar")).toBe(true)
    expect(isLanguage("fr")).toBe(false)
    expect(parseLanguage("es")).toBe("es")
    expect(parseLanguage("de")).toBe("en")
  })

  it("maps Arabic to rtl and html lang", () => {
    expect(isRtl("ar")).toBe(true)
    expect(getDir("ar")).toBe("rtl")
    expect(getDir("en")).toBe("ltr")
    expect(getHtmlLang("ar")).toBe("ar")
    expect(getIntlLocale("ar")).toBe("ar-EG")
  })

  it("reads NEXT_LOCALE from cookie strings", () => {
    expect(readLanguageFromCookieString("NEXT_LOCALE=ar; other=1")).toBe("ar")
    expect(readLanguageFromCookieString("foo=bar")).toBe("en")
  })

  it("formats dates and numbers for Arabic", () => {
    const date = new Date("2024-06-15T12:00:00Z")
    const formatted = formatLocaleDate(date, "ar", { timeZone: "UTC" })
    expect(formatted.length).toBeGreaterThan(0)
    expect(formatLocaleNumber(1234.5, "en")).toMatch(/1[,.]?234/)
  })
})

describe("translateKey", () => {
  it("resolves nested keys and interpolates vars", () => {
    const messages = {
      auth: { welcomeTo: "Welcome to {name}" },
    }
    expect(translateKey(messages, "auth.welcomeTo", { name: "Acme" })).toBe("Welcome to Acme")
    expect(translateKey(messages, "auth.missing")).toBe("auth.missing")
  })
})
