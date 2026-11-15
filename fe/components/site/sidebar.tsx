"use client"

import { AppVersionLabel } from "@/components/site/app-version-label"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import * as authActions from "@/lib/actions/auth/auth-public-actions"
import { useAuth } from "@/lib/contexts/auth-context"
import { useLanguage } from "@/lib/contexts/language-context"
import { useRoles } from "@/lib/contexts/role-context"
import { useOrgWhiteLabelData } from "@/lib/hooks/use-org-white-label-data"
import type { RoleId } from "@/lib/types/role-schema"
import {
  ORG_CONFIGURATIONS_MANAGE,
  ORG_EMAIL_MANAGE,
  ORG_MEDIA_MANAGE,
  ORG_NOTIFICATIONS_MANAGE,
  ORG_SETTINGS_MANAGE,
  ORG_USERS_READ,
  ORG_USERS_WRITE,
  PLATFORM_ORGANIZATIONS_READ,
  PLATFORM_SETTINGS_MANAGE,
  PLATFORM_USERS_READ,
  hasAnyPermission,
  hasPermission,
} from "@/lib/types/permission-schema"
import {
  Bell,
  BookOpen,
  Bot,
  Brain,
  Building,
  ChartLine,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Code2,
  Flag,
  FolderTree,
  GitBranch,
  HelpCircle,
  ImageIcon,
  LayoutDashboard,
  LayoutGrid,
  LogOut,
  Mail,
  MessageSquare,
  Moon,
  Network,
  RefreshCw,
  Settings,
  SlidersHorizontal,
  SquareUser,
  Sun,
  Terminal,
  UserIcon,
  Users,
  UsersRound,
  Workflow,
} from "lucide-react"
import { useTheme } from "next-themes"
import Image from "next/image"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { toast } from "sonner"

const SIDEBAR_COLLAPSED_WIDTH = 64
const SIDEBAR_DEFAULT_WIDTH = 320
const SIDEBAR_MIN_EXPANDED_WIDTH = 220
const SIDEBAR_MAX_WIDTH = 480
/** Drag below this width collapses the sidebar to icon-only. */
const SIDEBAR_COLLAPSE_DRAG_THRESHOLD = 140
const SIDEBAR_WIDTH_STORAGE_KEY = "sidebarWidth"

function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_EXPANDED_WIDTH, width))
}

function readStoredSidebarWidth(): number {
  if (typeof window === "undefined") return SIDEBAR_DEFAULT_WIDTH
  const raw = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)
  const parsed = raw ? Number.parseInt(raw, 10) : NaN
  if (!Number.isFinite(parsed)) return SIDEBAR_DEFAULT_WIDTH
  return clampSidebarWidth(parsed)
}

const SIDEBAR_LANGUAGES = [
  { code: "en" as const, nameKey: "profile.english" },
  { code: "es" as const, nameKey: "profile.spanish" },
  { code: "ar" as const, nameKey: "profile.arabic" },
]

function SidebarProfileMenu({ sidebarOpen }: { sidebarOpen: boolean }) {
  const { user, setUser, isLoading } = useAuth()
  const { language, setLanguage, t } = useLanguage()
  const { theme, setTheme } = useTheme()
  const [profileOpen, setProfileOpen] = useState(false)
  const [languageOpen, setLanguageOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const router = useRouter()

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element
      if (profileOpen && !target.closest('[data-profile-menu="true"]')) {
        setProfileOpen(false)
        setLanguageOpen(false)
      }
    }

    if (profileOpen) {
      document.addEventListener("mousedown", handleClickOutside)
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [profileOpen])

  useEffect(() => {
    setMounted(true)
  }, [])

  const getUserDisplayName = () => {
    if (user) {
      const firstName = user.firstName || ""
      const lastName = user.lastName || ""
      const fullName = `${firstName} ${lastName}`.trim()
      if (fullName) return fullName
      if (user.email) return user.email
    }
    return "Loading..."
  }

  const handleLogout = async () => {
    try {
      setUser(null)
      setProfileOpen(false)

      const result = await authActions.logoutUser()

      if (result.success) {
        toast.success("Logged out successfully")
      } else {
        toast.error(result.error || "Logout failed")
      }

      router.replace("/login")
    } catch (error) {
      console.error("Logout failed:", error)
      toast.error("Logout failed")
      router.replace("/login")
    }
  }

  const currentLanguage =
    SIDEBAR_LANGUAGES.find((lang) => lang.code === language) || SIDEBAR_LANGUAGES[0]

  return (
    <div className="relative" data-profile-menu="true">
      <button
        onClick={() => setProfileOpen(!profileOpen)}
        className="flex items-center gap-2 w-full p-2 rounded-md hover:bg-muted transition-colors"
        type="button"
      >
        <Avatar className="h-6 w-6 flex-shrink-0">
          <AvatarFallback className="bg-muted text-muted-foreground">
            <UserIcon className="h-4 w-4" />
          </AvatarFallback>
        </Avatar>
        {isLoading || !user ? (
          <div className="flex-1 min-w-0">
            <div className="h-4 bg-muted rounded animate-pulse" style={{ width: sidebarOpen ? "80px" : "100%" }} />
          </div>
        ) : (
          <span className="text-sm text-foreground truncate">{getUserDisplayName()}</span>
        )}
        {sidebarOpen && <ChevronUp className="h-3 w-3 text-muted-foreground flex-shrink-0 ms-auto" />}
      </button>

      {profileOpen && (
        <div className="absolute bottom-full start-0 mb-2 w-64 bg-card rounded-md shadow-lg border border-border z-50 max-h-96 overflow-y-auto">
          <div className="p-2">
            <div className="p-2 border-b border-border">
              <div className="font-medium text-foreground text-sm flex items-center gap-2">
                <UserIcon className="h-4 w-4" />
                {user ? getUserDisplayName() : <div className="h-4 bg-muted rounded animate-pulse w-24" />}
              </div>
              {user && (
                <div className="text-sm text-muted-foreground mt-1 truncate">{user.email}</div>
              )}
            </div>

            {mounted && (
              <div className="flex items-center justify-between p-2">
                <div className="flex items-center gap-2">
                  {theme === "dark" ? (
                    <Moon className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <Sun className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className="text-sm text-foreground">{t("profile.theme")}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Sun className="h-4 w-4 text-muted-foreground" />
                  <Switch
                    checked={theme === "dark"}
                    onCheckedChange={(checked) => {
                      setTheme(checked ? "dark" : "light")
                    }}
                    aria-label="Toggle theme"
                  />
                  <Moon className="h-4 w-4 text-muted-foreground" />
                </div>
              </div>
            )}

            {mounted && (
              <div className="relative px-1 py-0.5">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setLanguageOpen(!languageOpen)
                  }}
                  className="w-full flex items-center justify-between px-2 py-2 text-sm text-foreground hover:bg-muted rounded"
                >
                  <span>{t("profile.language")}</span>
                  <span className="text-muted-foreground">{t(currentLanguage.nameKey)}</span>
                </button>
                {languageOpen && (
                  <div className="mt-1 border border-border rounded-md overflow-hidden">
                    {SIDEBAR_LANGUAGES.map((lang) => (
                      <button
                        key={lang.code}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setLanguage(lang.code)
                          setLanguageOpen(false)
                        }}
                        className={`w-full text-start px-2 py-2 text-sm hover:bg-muted ${
                          language === lang.code ? "bg-primary/10 font-medium" : "text-foreground"
                        }`}
                      >
                        {t(lang.nameKey)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="p-1 space-y-0.5">
              <button
                onClick={() => {
                  setProfileOpen(false)
                  router.push("/settings")
                }}
                className="w-full text-start px-2 py-2 text-sm text-foreground hover:bg-muted rounded flex items-center gap-2"
                type="button"
              >
                <Settings className="h-4 w-4" />
                {t("common.settings")}
              </button>
              <button
                onClick={() => {
                  setProfileOpen(false)
                  router.push("/help")
                }}
                className="w-full text-start px-2 py-2 text-sm text-foreground hover:bg-muted rounded flex items-center gap-2"
                type="button"
              >
                <HelpCircle className="h-4 w-4" />
                {t("common.help")}
              </button>
              <button
                onClick={handleLogout}
                className="w-full text-start px-2 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded flex items-center gap-2"
                type="button"
              >
                <LogOut className="h-4 w-4" />
                {t("common.logout")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

interface MenuItem {
  titleKey: string
  href?: string
  icon: typeof LayoutDashboard
  subItems?: MenuItem[]
}

const roleMenuItems: Record<RoleId, MenuItem[]> = {
  user: [
    { titleKey: "common.dashboard", href: "/dashboard", icon: LayoutDashboard },
  ],
  org_owner: [],
  org_admin: [],
  super_admin: [],
}

const ORG_ADMIN_SURFACE_PERMISSIONS = [
  ORG_USERS_READ,
  ORG_SETTINGS_MANAGE,
  ORG_CONFIGURATIONS_MANAGE,
  ORG_MEDIA_MANAGE,
  ORG_EMAIL_MANAGE,
  ORG_NOTIFICATIONS_MANAGE,
] as const

function buildIntelligenceMenuItems(): MenuItem[] {
  return [
    {
      titleKey: "common.navWorkspace",
      icon: LayoutGrid,
      subItems: [
        { titleKey: "common.menuChat", href: "/chat", icon: MessageSquare },
        { titleKey: "common.menuTaskBoard", href: "/task-board", icon: Network },
        { titleKey: "common.menuTeams", href: "/teams", icon: UsersRound },
        { titleKey: "common.menuOrgGraph", href: "/org-graph", icon: FolderTree },
        { titleKey: "common.menuMeetings", href: "/meetings", icon: SquareUser },
        { titleKey: "common.menuScheduled", href: "/scheduled", icon: Clock },
      ],
    },
    {
      titleKey: "common.navReview",
      icon: Flag,
      subItems: [
        { titleKey: "common.menuReviewQueue", href: "/review-queue", icon: Flag },
        { titleKey: "common.menuPendingEdits", href: "/pending-edits", icon: RefreshCw },
        { titleKey: "common.menuWorktrees", href: "/worktrees", icon: GitBranch },
      ],
    },
    {
      titleKey: "common.navAutomation",
      icon: Bot,
      subItems: [
        { titleKey: "common.menuAgents", href: "/agents", icon: Bot },
        { titleKey: "common.menuWorkflows", href: "/workflows", icon: Workflow },
      ],
    },
    {
      titleKey: "common.navKnowledge",
      icon: BookOpen,
      subItems: [
        { titleKey: "common.menuKnowledgeBase", href: "/knowledge-base", icon: BookOpen },
        { titleKey: "common.menuMemory", href: "/memory", icon: Brain },
      ],
    },
    {
      titleKey: "common.navInsights",
      icon: ChartLine,
      subItems: [
        { titleKey: "common.menuAlerts", href: "/alerts", icon: Bell },
        { titleKey: "common.menuAnalytics", href: "/analytics", icon: ChartLine },
      ],
    },
  ]
}

function buildMenuItemsFromPermissions(permissions: string[]): MenuItem[] {
  const items: MenuItem[] = []

  const hasPlatform = hasAnyPermission(permissions, [
    PLATFORM_ORGANIZATIONS_READ,
    PLATFORM_USERS_READ,
    PLATFORM_SETTINGS_MANAGE,
  ])
  const hasOrgAdminSurface = hasAnyPermission(permissions, ORG_ADMIN_SURFACE_PERMISSIONS)

  if (hasPlatform) {
    items.push({
      titleKey: "common.dashboard",
      href: "/dashboard-super-admin",
      icon: LayoutDashboard,
    })
    if (hasPermission(permissions, PLATFORM_ORGANIZATIONS_READ)) {
      items.push({
        titleKey: "common.organizations",
        href: "/platform-organizations",
        icon: Building,
      })
    }
    if (hasPermission(permissions, PLATFORM_USERS_READ)) {
      items.push({
        titleKey: "common.users",
        href: "/platform-users",
        icon: Users,
      })
    }
    if (hasPermission(permissions, PLATFORM_SETTINGS_MANAGE)) {
      // /platform-settings is a mockup — omit from nav until implemented
      items.push({
        titleKey: "common.mediaManager",
        href: "/platform-media-manager",
        icon: ImageIcon,
      })
      items.push({
        titleKey: "common.cronJobs",
        href: "/platform-cron-jobs",
        icon: Clock,
      })
      items.push({
        titleKey: "common.apiTools",
        href: "/platform-api-tools",
        icon: Code2,
      })
    }
    return items
  }

  if (hasOrgAdminSurface) {
    items.push({
      titleKey: "common.dashboard",
      href: "/dashboard-org-admin",
      icon: LayoutDashboard,
    })
    items.push(...buildIntelligenceMenuItems())

    if (hasPermission(permissions, ORG_USERS_READ)) {
      const userSubs: MenuItem[] = [
        {
          titleKey: "common.allUsers",
          href: "/organization-users",
          icon: Users,
        },
      ]
      if (hasPermission(permissions, ORG_USERS_WRITE)) {
        userSubs.push({
          titleKey: "common.roles",
          href: "/organization-roles",
          icon: SlidersHorizontal,
        })
      }
      items.push({
        titleKey: "common.users",
        icon: Users,
        subItems: userSubs,
      })
    }

    const adminSubs: MenuItem[] = [
      { titleKey: "common.menuSystem", href: "/system", icon: Settings },
      { titleKey: "common.menuLogs", href: "/logs", icon: Terminal },
    ]
    if (hasAnyPermission(permissions, [ORG_SETTINGS_MANAGE, ORG_CONFIGURATIONS_MANAGE])) {
      adminSubs.push({
        titleKey: "common.siteSettings",
        href: "/organization-settings",
        icon: Settings,
      })
    }
    if (hasPermission(permissions, ORG_MEDIA_MANAGE)) {
      adminSubs.push({
        titleKey: "common.mediaManager",
        href: "/organization-media-manager",
        icon: ImageIcon,
      })
    }
    if (hasPermission(permissions, ORG_EMAIL_MANAGE)) {
      adminSubs.push({
        titleKey: "common.emailEngine",
        href: "/organization-email-manager",
        icon: Mail,
      })
    }
    if (hasPermission(permissions, ORG_NOTIFICATIONS_MANAGE)) {
      adminSubs.push({
        titleKey: "common.notifications",
        href: "/organization-notifications",
        icon: Bell,
      })
    }
    items.push({
      titleKey: "common.siteConfigurations",
      icon: Settings,
      subItems: adminSubs,
    })
    return items
  }

  return roleMenuItems.user
}

interface SidebarProps {
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  isMobile: boolean
  org?: {
    name?: string
    logoUrl?: string
    privacyNotice?: string
    headlineText?: string
    [key: string]: any
  }
}

function isHrefActive(href: string, pathname: string | null): boolean {
  if (!href || !pathname) return false
  return pathname === href || pathname.startsWith(`${href}/`)
}

function menuItemStorageKey(item: MenuItem, parentKey = ""): string {
  return parentKey ? `${parentKey}/${item.titleKey}` : item.titleKey
}

function menuItemHasActiveHref(item: MenuItem, pathname: string | null): boolean {
  if (item.href && isHrefActive(item.href, pathname)) return true
  return (item.subItems ?? []).some((subItem) => menuItemHasActiveHref(subItem, pathname))
}

function collectActiveMenuKeys(
  items: MenuItem[],
  pathname: string | null,
  parentKey = ""
): string[] {
  const keys: string[] = []
  for (const item of items) {
    const itemKey = menuItemStorageKey(item, parentKey)
    if (menuItemHasActiveHref(item, pathname) && item.subItems?.length) {
      keys.push(itemKey)
      keys.push(...collectActiveMenuKeys(item.subItems, pathname, itemKey))
    }
  }
  return keys
}

function collectMenuHrefs(items: MenuItem[]): string[] {
  return items.flatMap((item) => [
    ...(item.href ? [item.href] : []),
    ...collectMenuHrefs(item.subItems ?? []),
  ])
}

function collectExpandableMenuKeys(items: MenuItem[], parentKey = ""): string[] {
  const keys: string[] = []
  for (const item of items) {
    const itemKey = menuItemStorageKey(item, parentKey)
    if (item.subItems?.length) {
      keys.push(itemKey)
      keys.push(...collectExpandableMenuKeys(item.subItems, itemKey))
    }
  }
  return keys
}

function resolveMenuLabel(titleKey: string, translate: (key: string) => string): string {
  return titleKey.includes(".") ? translate(titleKey) : titleKey
}

export function Sidebar({ sidebarOpen, setSidebarOpen, isMobile }: SidebarProps) {
  const { t, isRtl } = useLanguage()
  const { activeRole, permissions, isLoading: rolesLoading } = useRoles()
  const pathname = usePathname()
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH)
  const [isResizing, setIsResizing] = useState(false)
  const dragStartXRef = useRef(0)
  const dragStartWidthRef = useRef(SIDEBAR_DEFAULT_WIDTH)

  useEffect(() => {
    setSidebarWidth(readStoredSidebarWidth())
  }, [])

  useEffect(() => {
    if (typeof window === "undefined" || isMobile) return
    localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(clampSidebarWidth(sidebarWidth)))
  }, [sidebarWidth, isMobile])

  const handleResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (isMobile) return
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      dragStartXRef.current = event.clientX
      dragStartWidthRef.current = sidebarOpen ? sidebarWidth : SIDEBAR_COLLAPSED_WIDTH
      setIsResizing(true)
      if (!sidebarOpen) {
        setSidebarOpen(true)
        dragStartWidthRef.current = SIDEBAR_MIN_EXPANDED_WIDTH
        setSidebarWidth(SIDEBAR_MIN_EXPANDED_WIDTH)
      }
    },
    [isMobile, sidebarOpen, sidebarWidth, setSidebarOpen]
  )

  const handleResizePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!isResizing || isMobile) return
      const rawDelta = event.clientX - dragStartXRef.current
      const delta = isRtl ? -rawDelta : rawDelta
      const nextWidth = dragStartWidthRef.current + delta
      if (nextWidth <= SIDEBAR_COLLAPSE_DRAG_THRESHOLD) {
        setSidebarOpen(false)
        return
      }
      if (!sidebarOpen) {
        setSidebarOpen(true)
      }
      setSidebarWidth(clampSidebarWidth(nextWidth))
    },
    [isMobile, isResizing, isRtl, setSidebarOpen, sidebarOpen]
  )

  const endResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!isResizing) return
      try {
        event.currentTarget.releasePointerCapture(event.pointerId)
      } catch {
        // Pointer may already be released.
      }
      setIsResizing(false)
      if (sidebarOpen) {
        setSidebarWidth((width) => clampSidebarWidth(width))
      }
    },
    [isResizing, sidebarOpen]
  )

  useEffect(() => {
    if (!isResizing) return
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    return () => {
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
    }
  }, [isResizing])

  const { logoUrl, name } = useOrgWhiteLabelData()
  const [expandedMenus, setExpandedMenus] = useState<Set<string>>(new Set())
  const didInitExpandedMenus = useRef(false)

  const menuItems = useMemo(() => {
    if (rolesLoading) return []
    if (permissions.length > 0 || activeRole) {
      return buildMenuItemsFromPermissions(permissions)
    }
    return roleMenuItems.user
  }, [activeRole, permissions, rolesLoading])

  useEffect(() => {
    if (isMobile && pathname) {
      setSidebarOpen(false)
    }
  }, [pathname, isMobile, setSidebarOpen])

  useEffect(() => {
    if (didInitExpandedMenus.current || menuItems.length === 0) return
    didInitExpandedMenus.current = true
    setExpandedMenus(new Set(collectExpandableMenuKeys(menuItems)))
  }, [menuItems])

  useEffect(() => {
    if (!pathname) return
    const activeKeys = collectActiveMenuKeys(menuItems, pathname)
    if (activeKeys.length === 0) return
    setExpandedMenus((prev) => {
      let changed = false
      const next = new Set(prev)
      for (const key of activeKeys) {
        if (!next.has(key)) {
          next.add(key)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [pathname, menuItems])

  useEffect(() => {
    if (!isMobile && typeof window !== "undefined") {
      const saved = localStorage.getItem("sidebarOpen")
      if (saved === null) {
        setSidebarOpen(true)
      }
    }
  }, [isMobile, setSidebarOpen])

  const allHrefs = useMemo(() => collectMenuHrefs(menuItems), [menuItems])

  const activeHref = useMemo(() => {
    const matching = allHrefs.filter((href) => isHrefActive(href, pathname))
    return matching.sort((a, b) => b.length - a.length)[0] ?? null
  }, [pathname, allHrefs])

  const isActive = (href: string) => Boolean(href) && activeHref === href

  const toggleMenu = (menuKey: string) => {
    setExpandedMenus((prev) => {
      const next = new Set(prev)
      if (next.has(menuKey)) {
        next.delete(menuKey)
      } else {
        next.add(menuKey)
      }
      return next
    })
  }

  const closeMobileSidebar = () => {
    if (isMobile) {
      setSidebarOpen(false)
    }
  }

  const renderMenuItem = (item: MenuItem, depth = 0, parentKey = "") => {
    const itemKey = menuItemStorageKey(item, parentKey)
    const isExpanded = expandedMenus.has(itemKey)
    const hasSubItems = Boolean(item.subItems?.length)
    const hasActiveChild = hasSubItems && menuItemHasActiveHref(item, pathname)
    const isCurrentItemActive = item.href
      ? isActive(item.href)
      : depth > 0 && hasActiveChild
    const isHighlighted = isCurrentItemActive
    const menuLabel = resolveMenuLabel(item.titleKey, t)
    const Icon = item.icon

    if (depth === 0) {
      const topLevelClassName = `w-full flex items-center p-3 rounded-md transition-all duration-200 text-start hover:bg-muted ${
        sidebarOpen ? "justify-between" : "justify-center"
      } ${isHighlighted ? "font-medium text-foreground" : "text-foreground"}`
      const topLevelContent = (
        <>
          <div className="flex items-center gap-3">
            <Icon className="h-5 w-5 flex-shrink-0" />
            {sidebarOpen && <span className="truncate">{menuLabel}</span>}
          </div>
          {sidebarOpen && hasSubItems && (
            <ChevronDown
              className={`h-4 w-4 transition-transform duration-200 ${
                isExpanded ? "rotate-180" : ""
              }`}
            />
          )}
        </>
      )

      return (
        <div key={itemKey} className="relative">
          {isHighlighted && !hasSubItems ? (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute start-0 top-2 bottom-2 w-1 rounded-e-full bg-primary"
            />
          ) : null}
          {hasSubItems ? (
            <button
              className={topLevelClassName}
              onClick={() => {
                if (sidebarOpen) {
                  toggleMenu(itemKey)
                } else {
                  setSidebarOpen(true)
                  setTimeout(() => toggleMenu(itemKey), 100)
                }
              }}
              title={sidebarOpen ? undefined : menuLabel}
              type="button"
            >
              {topLevelContent}
            </button>
          ) : item.href ? (
            <Link
              href={item.href}
              className={topLevelClassName}
              onClick={closeMobileSidebar}
              title={sidebarOpen ? undefined : menuLabel}
            >
              {topLevelContent}
            </Link>
          ) : (
            <button className={topLevelClassName} title={sidebarOpen ? undefined : menuLabel} type="button">
              {topLevelContent}
            </button>
          )}

          <div
            className={`overflow-hidden transition-all duration-300 ease-in-out ${
              sidebarOpen && hasSubItems && isExpanded
                ? "max-h-[60rem] opacity-100"
                : "max-h-0 opacity-0"
            }`}
          >
            <div className="relative ms-5 mt-1 mb-1 space-y-0.5 border-s-2 border-border/50 ps-3">
              {(item.subItems ?? []).map((subItem) =>
                renderMenuItem(subItem, depth + 1, itemKey)
              )}
            </div>
          </div>
        </div>
      )
    }

    const nestedClassName = `w-full flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm transition-all duration-200 text-start hover:bg-muted ${
      isCurrentItemActive
        ? "font-medium text-foreground bg-primary/10"
        : "text-muted-foreground hover:text-foreground"
    }`
    const nestedContent = (
      <>
        <div className="flex items-center gap-3 min-w-0">
          <Icon className="h-4 w-4 flex-shrink-0" />
          <span className="truncate">{menuLabel}</span>
        </div>
        {hasSubItems && (
          <ChevronDown
            className={`h-3.5 w-3.5 flex-shrink-0 transition-transform duration-200 ${
              isExpanded ? "rotate-180" : ""
            }`}
          />
        )}
      </>
    )

    return (
      <div key={itemKey} className="relative">
        {hasSubItems ? (
          <button className={nestedClassName} onClick={() => toggleMenu(itemKey)} type="button">
            {nestedContent}
          </button>
        ) : item.href ? (
          <Link href={item.href} className={nestedClassName} onClick={closeMobileSidebar}>
            {nestedContent}
          </Link>
        ) : (
          <button className={nestedClassName} type="button">
            {nestedContent}
          </button>
        )}
        {isCurrentItemActive && depth >= 1 ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -start-[calc(0.75rem+2px)] top-1 bottom-1 w-0.5 rounded-full bg-primary"
          />
        ) : null}

        <div
          className={`overflow-hidden transition-all duration-300 ease-in-out ${
            sidebarOpen && hasSubItems && isExpanded
              ? "max-h-[40rem] opacity-100"
              : "max-h-0 opacity-0"
          }`}
        >
          <div className="ms-3 mt-1 space-y-0.5 border-s-2 border-border/40 ps-3">
            {(item.subItems ?? []).map((subItem) =>
              renderMenuItem(subItem, depth + 1, itemKey)
            )}
          </div>
        </div>
      </div>
    )
  }

  const desktopWidth = sidebarOpen ? sidebarWidth : SIDEBAR_COLLAPSED_WIDTH

  return (
    <>
      {isMobile && sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black bg-opacity-50" onClick={() => setSidebarOpen(false)}></div>
      )}

      <div
        className={`fixed md:relative z-50 h-full bg-card border-e border-border flex flex-col ${
          isResizing ? "" : "transition-[width] duration-200 ease-out"
        } ${isMobile ? "start-0 transform" : ""} ${
          isMobile && !sidebarOpen ? "-translate-x-full rtl:translate-x-full" : ""
        } ${isMobile ? "shadow-lg w-64" : ""}`}
        style={isMobile ? undefined : { width: desktopWidth }}
      >
        <div
          className={`flex items-center border-b border-border flex-shrink-0 py-5 ${
            sidebarOpen ? "justify-between px-6" : "justify-center px-2"
          }`}
        >
          {sidebarOpen ? (
            <>
              <div className="flex items-center gap-3 min-w-0">
                <Image
                  src={logoUrl || "/favicon.ico"}
                  alt="Organization logo"
                  width={48}
                  height={48}
                  className="rounded-lg size-12 object-contain shrink-0"
                />
                <span className="font-semibold text-foreground truncate">
                  {name || "Organization"}
                </span>
              </div>
              {isMobile && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSidebarOpen(false)}
                  className="h-8 w-8 p-0 shrink-0"
                  aria-label="Close sidebar"
                  title="Close sidebar"
                >
                  <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
                </Button>
              )}
            </>
          ) : (
            <Image
              src={logoUrl || "/favicon.ico"}
              alt="Organization logo"
              width={30}
              height={30}
              className="rounded-md size-[30px] object-contain"
            />
          )}
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          <nav className="p-4 space-y-2">
            {menuItems.map((item) => renderMenuItem(item))}
          </nav>
        </div>

        <div className="border-t border-border p-4 flex-shrink-0">
          <div className="w-full">
            <SidebarProfileMenu sidebarOpen={sidebarOpen} />
            <AppVersionLabel
              className={`mt-2 ${sidebarOpen ? "text-center" : "text-center px-0.5"}`}
            />
          </div>
        </div>

        {!isMobile && (
          <>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize sidebar"
              aria-valuemin={SIDEBAR_MIN_EXPANDED_WIDTH}
              aria-valuemax={SIDEBAR_MAX_WIDTH}
              aria-valuenow={sidebarOpen ? sidebarWidth : SIDEBAR_COLLAPSED_WIDTH}
              title="Drag to resize"
              className={`group absolute top-0 end-0 z-50 h-full w-1.5 cursor-col-resize touch-none ${
                isResizing ? "bg-primary/40" : "bg-transparent hover:bg-primary/25"
              }`}
              onPointerDown={handleResizePointerDown}
              onPointerMove={handleResizePointerMove}
              onPointerUp={endResize}
              onPointerCancel={endResize}
            >
              <div
                aria-hidden
                className={`pointer-events-none absolute bottom-5 start-1/2 flex -translate-x-1/2 rtl:translate-x-1/2 items-center gap-[3px] transition-opacity ${
                  isResizing ? "opacity-100" : "opacity-60 group-hover:opacity-100"
                }`}
              >
                <span className="block h-5 w-[2px] shrink-0 rounded-full bg-muted-foreground/80" />
                <span className="block h-5 w-[2px] shrink-0 rounded-full bg-muted-foreground/80" />
              </div>
            </div>

            <button
              type="button"
              aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
              title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
              className="absolute top-1/2 -end-3 z-[60] flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => {
                if (sidebarOpen) {
                  setSidebarOpen(false)
                  return
                }
                setSidebarOpen(true)
                setSidebarWidth((width) => clampSidebarWidth(width || SIDEBAR_DEFAULT_WIDTH))
              }}
            >
              {sidebarOpen ? (
                <ChevronLeft className="h-3.5 w-3.5 rtl:rotate-180" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" />
              )}
            </button>
          </>
        )}
      </div>
    </>
  )
}
