import type { Language } from "@/lib/i18n/locale"

import arAuth from "@/translations/ar/auth.json"
import arCommon from "@/translations/ar/common.json"
import arFooter from "@/translations/ar/footer.json"
import arNotifications from "@/translations/ar/notifications.json"
import arProfile from "@/translations/ar/profile.json"

import enAuth from "@/translations/en/auth.json"
import enCommon from "@/translations/en/common.json"
import enFooter from "@/translations/en/footer.json"
import enNotifications from "@/translations/en/notifications.json"
import enProfile from "@/translations/en/profile.json"

import esAuth from "@/translations/es/auth.json"
import esCommon from "@/translations/es/common.json"
import esFooter from "@/translations/es/footer.json"
import esNotifications from "@/translations/es/notifications.json"
import esProfile from "@/translations/es/profile.json"

export type TranslationValue = string | { [key: string]: TranslationValue }
export type Translations = { [key: string]: TranslationValue }

/** Namespace files under fe/translations/{lang}/ — en is the source of truth. */
export const MESSAGE_NAMESPACES = [
  "common",
  "profile",
  "notifications",
  "footer",
  "auth",
] as const

export type MessageNamespace = (typeof MESSAGE_NAMESPACES)[number]

function mergeNamespaces(parts: Record<MessageNamespace, Translations>): Translations {
  return { ...parts }
}

const catalogs: Record<Language, Translations> = {
  en: mergeNamespaces({
    common: enCommon as Translations,
    profile: enProfile as Translations,
    notifications: enNotifications as Translations,
    footer: enFooter as Translations,
    auth: enAuth as Translations,
  }),
  es: mergeNamespaces({
    common: esCommon as Translations,
    profile: esProfile as Translations,
    notifications: esNotifications as Translations,
    footer: esFooter as Translations,
    auth: esAuth as Translations,
  }),
  ar: mergeNamespaces({
    common: arCommon as Translations,
    profile: arProfile as Translations,
    notifications: arNotifications as Translations,
    footer: arFooter as Translations,
    auth: arAuth as Translations,
  }),
}

export function getMessages(language: Language): Translations {
  return catalogs[language]
}

export function translateKey(
  messages: Translations,
  key: string,
  vars?: Record<string, string | number>
): string {
  const keys = key.split(".")
  let value: TranslationValue | undefined = messages

  for (const part of keys) {
    if (value && typeof value === "object" && part in value) {
      value = value[part]
    } else {
      return key
    }
  }

  if (typeof value !== "string") return key
  if (!vars) return value
  return value.replace(/\{(\w+)\}/g, (match, name: string) =>
    vars[name] !== undefined ? String(vars[name]) : match
  )
}
