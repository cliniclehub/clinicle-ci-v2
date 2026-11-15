"use client"

import type React from "react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Switch } from "@/components/ui/switch"
import { logoutUser } from "@/lib/actions/auth/auth-public-actions"
import { useAuth } from "@/lib/contexts/auth-context"
import { useLanguage } from "@/lib/contexts/language-context"
import type { Language } from "@/lib/i18n/locale"
import { ChevronDown, Globe, HelpCircle, LogOut, Mail, Moon, Settings, Sun, UserIcon } from "lucide-react"
import { useTheme } from "next-themes"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { toast } from "sonner"

const LANGUAGES: ReadonlyArray<{ code: Language; nameKey: string }> = [
  { code: "en", nameKey: "profile.english" },
  { code: "es", nameKey: "profile.spanish" },
  { code: "ar", nameKey: "profile.arabic" },
]

export function ProfileMenu() {
  const [profileOpen, setProfileOpen] = useState(false)
  const [languageOpen, setLanguageOpen] = useState(false)
  const { theme, setTheme } = useTheme()
  const { language, setLanguage, t } = useLanguage()
  const [mounted, setMounted] = useState(false)
  const { user, isLoading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      if (profileOpen && !target.closest('[data-profile-menu="true"]')) {
        setProfileOpen(false)
        setLanguageOpen(false)
      }
    }

    document.addEventListener("mousedown", handleClickOutside)
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [profileOpen])

  const handleLanguageChange = (newLanguage: Language, e: React.MouseEvent) => {
    e.stopPropagation()
    setLanguage(newLanguage)
    setLanguageOpen(false)
  }

  const handleLogout = async () => {
    try {
      const result = await logoutUser()

      if (result.success) {
        toast.success("Logged out successfully")
        setProfileOpen(false)
        router.replace("/login")
      } else {
        toast.error(result.error || "Logout failed")
      }
    } catch (error) {
      console.error("Logout failed:", error)
      toast.error("Logout failed")
      router.replace("/login")
    }
  }

  const currentLanguage = LANGUAGES.find((lang) => lang.code === language) || LANGUAGES[0]

  const getUserDisplayName = () => {
    if (!user) return "User"
    return `${user.firstName} ${user.lastName}`.trim() || user.email
  }

  return (
    <div className="relative z-50" data-profile-menu="true">
      <button onClick={() => setProfileOpen(!profileOpen)} className="flex items-center gap-2 dark-text-primary">
        <Avatar className="h-8 w-8">
          <AvatarFallback className="bg-muted text-muted-foreground">
            <UserIcon className="h-4 w-4" />
          </AvatarFallback>
        </Avatar>
        <span className="hidden md:block">{getUserDisplayName()}</span>
        <ChevronDown className="h-4 w-4 hidden md:block" />
      </button>

      {profileOpen && (
        <div className="absolute end-0 mt-2 w-72 dark-card rounded-md shadow-lg border border-border z-50">
          <div className="p-2">
            <div className="p-3 border-b border-border">
              <div className="text-base font-medium dark-text-primary">{getUserDisplayName()}</div>
              {user && <div className="text-sm text-muted-foreground mt-1">{user.email}</div>}
            </div>

            <div className="space-y-2 mt-2">
              {mounted && (
                <div className="flex items-center justify-between p-3 rounded-md dark-menu-item">
                  <div className="flex items-center gap-2">
                    {theme === "dark" ? (
                      <Moon className="h-5 w-5 dark-text-secondary" />
                    ) : (
                      <Sun className="h-5 w-5 dark-text-secondary" />
                    )}
                    <span className="dark-text-primary">{t("profile.theme")}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Sun className="h-5 w-5 dark-text-secondary" />
                    <Switch
                      checked={theme === "dark"}
                      onCheckedChange={(checked) => {
                        setTheme(checked ? "dark" : "light")
                      }}
                      aria-label="Toggle theme"
                    />
                    <Moon className="h-5 w-5 dark-text-secondary" />
                  </div>
                </div>
              )}

              {mounted && (
                <div className="relative">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setLanguageOpen(!languageOpen)
                    }}
                    className="w-full flex items-center justify-between p-3 rounded-md dark-menu-item"
                    type="button"
                  >
                    <div className="flex items-center gap-2">
                      <Globe className="h-5 w-5 dark-text-secondary" />
                      <span className="dark-text-primary">{t("profile.language")}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="dark-text-secondary">{t(currentLanguage.nameKey)}</span>
                      <ChevronDown
                        className={`h-4 w-4 transition-transform ${languageOpen ? "rotate-180" : ""}`}
                      />
                    </div>
                  </button>

                  {languageOpen && (
                    <div className="absolute top-full inset-x-0 mt-1 bg-card border border-border rounded-md shadow-lg z-10 max-h-48 overflow-y-auto">
                      {LANGUAGES.map((lang) => (
                        <button
                          key={lang.code}
                          onClick={(e) => handleLanguageChange(lang.code, e)}
                          className={`w-full flex items-center gap-3 px-3 py-2 hover:bg-muted ${
                            language === lang.code
                              ? "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
                              : "dark-text-primary"
                          }`}
                          type="button"
                        >
                          <span>{t(lang.nameKey)}</span>
                          {language === lang.code && <span className="ms-auto text-xs">✓</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <Link
                href="/settings"
                className="flex items-center gap-2 p-3 rounded-md dark-menu-item"
                onClick={() => setProfileOpen(false)}
              >
                <Settings className="h-5 w-5 dark-text-secondary" />
                <span className="dark-text-primary">{t("common.settings")}</span>
              </Link>
              <Link
                href="/help"
                className="flex items-center gap-2 p-3 rounded-md dark-menu-item"
                onClick={() => setProfileOpen(false)}
              >
                <HelpCircle className="h-5 w-5 dark-text-secondary" />
                <span className="dark-text-primary">{t("common.help")}</span>
              </Link>
              <Link
                href="/contact"
                className="flex items-center gap-2 p-3 rounded-md dark-menu-item"
                onClick={() => setProfileOpen(false)}
              >
                <Mail className="h-5 w-5 dark-text-secondary" />
                <span className="dark-text-primary">{t("auth.contactUs")}</span>
              </Link>
              <button
                onClick={handleLogout}
                disabled={isLoading}
                className="w-full flex items-center gap-2 p-3 rounded-md dark-menu-item text-red-500 dark:text-red-400 disabled:opacity-50"
                type="button"
                aria-label="Logout"
                tabIndex={0}
              >
                <LogOut className="h-5 w-5" />
                <span>{isLoading ? t("auth.loggingOut") : t("common.logout")}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
