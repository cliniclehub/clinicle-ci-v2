"use client"

import {
    BarChart3,
    CheckCircle,
    Clock,
    Computer,
    Globe,
    History,
    LogOut,
    MapPin,
    Monitor,
    RefreshCw,
    Shield,
    Smartphone,
    Tablet,
    User,
    Users,
    XCircle
} from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
    getUserLoginHistory,
    getUserLoginStatistics,
    getUserSessions,
    revokeUserSession
} from "@/lib/actions/auth/auth-admin-actions"
import {
    getCurrentUserLoginHistory,
    getCurrentUserLoginStatistics,
    getCurrentUserSessions,
    revokeCurrentUserSession
} from "@/lib/actions/auth/auth-me-actions"
import { getCurrentUser } from "@/lib/actions/users/users-me-actions"
import { getUser as getOrgUser } from "@/lib/actions/users/users-org-actions"
import { getUser as getPlatformUser } from "@/lib/actions/users/users-platform-actions"
import { useAuth } from "@/lib/contexts/auth-context"
import {
    LoginHistoryInfo,
    LoginStatistics,
    SessionInfo
} from "@/lib/types/auth-schema"
import { User as UserType } from "@/lib/types/user-schema"
import { isServerActionAuthRedirect } from "@/lib/utils/api-error-handler"
import { formatDateTime } from "@/lib/utils/date-time-helper"
import { createClientLogger } from "@/lib/utils/logger-client"

interface AuthSectionProps {
  user: UserType
  isCurrentUser: boolean
  userRole: "super_admin" | "org_owner" | "org_admin" | "me"
  onDirtyChange: (isDirty: boolean) => void
  onCancel: () => void
  onSuccess: (user: UserType) => void
  /** Updates parent user state without clearing form dirty flags (used by Refresh). */
  onUserSnapshotUpdated?: (user: UserType) => void
}

function formatDateTimeWithHMS(date: Date | string | number) {
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date
  return d.toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', year: 'numeric', month: 'short', day: 'numeric' })
}

const formatSessionLocation = (deviceInfo?: Record<string, unknown>) => {
  if (!deviceInfo) return "—"
  const city = (deviceInfo.login_city ?? deviceInfo.loginCity) as string | undefined
  const country = (deviceInfo.login_country ?? deviceInfo.loginCountry) as string | undefined
  const parts = [city, country].filter(Boolean)
  return parts.length ? parts.join(", ") : "—"
}

const getSessionStatus = (session: SessionInfo) => {
  const now = Date.now()
  const expiresAt = session.expiresAt ? new Date(session.expiresAt).getTime() : null
  const isActive = !session.revoked && (!expiresAt || expiresAt > now)

  if (session.revoked) {
    return { label: "Revoked", variant: "destructive" }
  }
  if (expiresAt && expiresAt < now) {
    return { label: "Expired", variant: "warning" } // Use 'warning' for amber
  }
  if (isActive) {
    return { label: "Active", variant: "default" }
  }
  return { label: "Inactive", variant: "secondary" }
}

/** Most recent activity time for ordering (last used, else created). */
const getSessionRecencyTimeMs = (session: SessionInfo): number => {
  const last = session.lastUsedAt ? new Date(session.lastUsedAt).getTime() : NaN
  if (Number.isFinite(last)) return last
  const created = session.createdAt ? new Date(session.createdAt).getTime() : NaN
  return Number.isFinite(created) ? created : 0
}

const logger = createClientLogger("AuthSection")

export function AuthSection({
  user,
  isCurrentUser,
  userRole,
  onDirtyChange,
  onCancel,
  onSuccess,
  onUserSnapshotUpdated,
}: AuthSectionProps) {
  const { user: authUser, refreshUser } = useAuth()
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [loginHistory, setLoginHistory] = useState<LoginHistoryInfo[]>([])
  const [loginStats, setLoginStats] = useState<LoginStatistics | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [loadingStats, setLoadingStats] = useState(false)
  const [loadingProfile, setLoadingProfile] = useState(false)
  const [revokingSession, setRevokingSession] = useState<number | null>(null)
  const [revokingAll, setRevokingAll] = useState(false)
  const [showRevokeDialog, setShowRevokeDialog] = useState(false)
  const [showRevokeAllDialog, setShowRevokeAllDialog] = useState(false)
  const [sessionToRevoke, setSessionToRevoke] = useState<SessionInfo | null>(null)
  const [activeTab, setActiveTab] = useState("sessions")

  useEffect(() => {
    fetchSessions()
    fetchLoginHistory()
    fetchLoginStatistics()
  }, [user.id])

  const fetchSessions = async () => {
    try {
      setLoading(true)
      
      let response
      if (userRole === "me" || isCurrentUser) {
        response = await getCurrentUserSessions()
      } else {
        response = await getUserSessions(user.id)
      }
      
      if (response.status === "success" && response.data) {
        setSessions(response.data.sessions || [])
      } else {
        toast.error(response.message || "Failed to fetch sessions")
      }
    } catch (error) {
      if (isServerActionAuthRedirect(error)) {
        return
      }
      toast.error("Failed to fetch user sessions")
    } finally {
      setLoading(false)
    }
  }

  const fetchLoginHistory = async () => {
    try {
      setLoadingHistory(true)
      
      let response
      if (userRole === "me" || isCurrentUser) {
        response = await getCurrentUserLoginHistory(30, true)
      } else {
        response = await getUserLoginHistory(user.id, 30, true)
      }
      
      if (response.status === "success" && response.data) {
        setLoginHistory(response.data.loginHistory || [])
      } else {
        toast.error(response.message || "Failed to fetch login history")
      }
    } catch (error) {
      if (isServerActionAuthRedirect(error)) {
        return
      }
      toast.error("Failed to fetch login history")
    } finally {
      setLoadingHistory(false)
    }
  }

  const fetchLoginStatistics = async () => {
    try {
      setLoadingStats(true)
      
      let response
      if (userRole === "me" || isCurrentUser) {
        response = await getCurrentUserLoginStatistics(30)
      } else {
        response = await getUserLoginStatistics(user.id, 30)
      }
      
      if (response.status === "success" && response.data) {
        setLoginStats(response.data)
      } else {
        toast.error(response.message || "Failed to fetch login statistics")
      }
    } catch (error) {
      if (isServerActionAuthRedirect(error)) {
        return
      }
      toast.error("Failed to fetch login statistics")
    } finally {
      setLoadingStats(false)
    }
  }

  const fetchLatestUserSnapshot = async () => {
    try {
      setLoadingProfile(true)
      let response
      if (userRole === "me" || isCurrentUser) {
        response = await getCurrentUser()
      } else if (userRole === "super_admin") {
        response = await getPlatformUser(user.id)
      } else {
        response = await getOrgUser(user.id)
      }
      if (response.status === "success" && response.data) {
        onUserSnapshotUpdated?.(response.data)
      } else {
        toast.error(response.message || "Failed to refresh account status")
      }
    } catch (error) {
      if (isServerActionAuthRedirect(error)) {
        return
      }
      logger.error("Failed to refresh user profile for auth section", error as Error, {
        userId: user.id,
        userRole,
      })
      toast.error("Failed to refresh account status")
    } finally {
      setLoadingProfile(false)
    }
  }

  const handleRefreshAuthData = async () => {
    const tasks: Promise<void>[] = [
      fetchSessions(),
      fetchLoginHistory(),
      fetchLoginStatistics(),
      fetchLatestUserSnapshot(),
    ]
    if (userRole === "me" || isCurrentUser) {
      tasks.push(refreshUser())
    }
    await Promise.all(tasks)
  }

  const handleRevokeSession = async (session: SessionInfo) => {
    setSessionToRevoke(session)
    setShowRevokeDialog(true)
  }

  const handleRevokeAllSessions = () => {
    setShowRevokeAllDialog(true)
  }

  const confirmRevokeSession = async () => {
    if (!sessionToRevoke) return

    try {
      setRevokingSession(sessionToRevoke.id)
      const sessionId = String(sessionToRevoke.id)
      
      let response
      if (userRole === "me" || isCurrentUser) {
        response = await revokeCurrentUserSession(sessionId)
      } else {
        response = await revokeUserSession(sessionId, user.id)
      }
      
      if (response.status === "success") {
        toast.success("Session revoked successfully")
        fetchSessions()
      } else {
        toast.error(response.message || "Failed to revoke session")
      }
    } catch (error) {
      if (isServerActionAuthRedirect(error)) {
        return
      }
      toast.error("Failed to revoke session")
    } finally {
      setRevokingSession(null)
      setShowRevokeDialog(false)
      setSessionToRevoke(null)
    }
  }

  const confirmRevokeAllSessions = async () => {
    try {
      setRevokingAll(true)
      
      // Revoke all sessions except current one
      const sessionsToRevoke = sessions.filter(s => !s.isCurrent)
      
      for (const session of sessionsToRevoke) {
        try {
          const sessionId = String(session.id)
          if (userRole === "me" || isCurrentUser) {
            await revokeCurrentUserSession(sessionId)
          } else {
            await revokeUserSession(sessionId, user.id)
          }
        } catch (error) {
          if (isServerActionAuthRedirect(error)) {
            return
          }
          logger.error("Failed to revoke session", error as Error, { sessionId: session.id })
        }
      }
      
      toast.success("All other sessions revoked successfully")
      fetchSessions()
    } catch (error) {
      if (isServerActionAuthRedirect(error)) {
        return
      }
      toast.error("Failed to revoke sessions")
    } finally {
      setRevokingAll(false)
      setShowRevokeAllDialog(false)
    }
  }

  const getDeviceIcon = (deviceType?: string) => {
    switch (deviceType) {
      case "mobile":
        return <Smartphone className="h-4 w-4" />
      case "tablet":
        return <Tablet className="h-4 w-4" />
      case "desktop":
        return <Monitor className="h-4 w-4" />
      default:
        return <Computer className="h-4 w-4" />
    }
  }

  const getDeviceTypeLabel = (deviceType?: string) => {
    switch (deviceType) {
      case "mobile":
        return "Mobile"
      case "tablet":
        return "Tablet"
      case "desktop":
        return "Desktop"
      default:
        return "Unknown"
    }
  }

  const getLoginStatusIcon = (success: boolean) => {
    return success ? (
      <CheckCircle className="h-4 w-4 text-green-600" />
    ) : (
      <XCircle className="h-4 w-4 text-red-600" />
    )
  }

const getLoginAttemptDeviceInfo = (login: LoginHistoryInfo) => {
  const info = (login.deviceInfo ?? {}) as Record<string, unknown>
  const device = (info.device as string | undefined) || "Unknown device"
  const os = (info.os as string | undefined) || "Unknown OS"
  const browser = (info.browser as string | undefined) || "Unknown browser"
  return { device, os, browser }
}

const shouldShowLoginUserAgent = (userAgent?: string) => {
  if (!userAgent) return false
  const ua = userAgent.trim().toLowerCase()
  return ua.length > 0 && ua !== "node" && ua !== "unknown"
}

const getSessionDeviceSummary = (session: SessionInfo) => {
  const device = getDeviceTypeLabel(session.deviceInfo.device?.toLowerCase())
  const os = session.deviceInfo.os || "Unknown OS"
  const browser = session.deviceInfo.browser || "Unknown Browser"
  return `${device} • ${os} • ${browser}`
}

const getLoginDeviceSummary = (login: LoginHistoryInfo) => {
  const info = getLoginAttemptDeviceInfo(login)
  const device = getDeviceTypeLabel(info.device?.toLowerCase())
  return `${device} • ${info.os} • ${info.browser}`
}

  const now = Date.now()
  const activeSessions = [...sessions]
    .filter((session) => !session.revoked && (!session.expiresAt || new Date(session.expiresAt).getTime() > now))
    .sort((a, b) => {
      if (a.isCurrent !== b.isCurrent) {
        return Number(b.isCurrent) - Number(a.isCurrent)
      }
      return getSessionRecencyTimeMs(b) - getSessionRecencyTimeMs(a)
    })
  const revokedSessions = [...sessions]
    .filter((session) => session.revoked)
    .sort((a, b) => getSessionRecencyTimeMs(b) - getSessionRecencyTimeMs(a))
  const hasOtherActiveSessions = activeSessions.some((session) => !session.isCurrent)

  const lockedUntilValue = user.lockedUntil
  const lockedUntilMs = lockedUntilValue ? new Date(lockedUntilValue).getTime() : null
  const hasActiveTempLockout =
    lockedUntilMs != null &&
    !Number.isNaN(lockedUntilMs) &&
    lockedUntilMs > Date.now()
  const isAdminLocked = Boolean(authUser?.locked ?? user.locked)

  return (
    <div className="min-w-0 space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Authentication & Sessions</h3>
        <p className="text-sm text-muted-foreground">
          Manage user authentication status and active sessions
        </p>
      </div>

      {/* Authentication Status */}
      <Card className="min-w-0 overflow-hidden">
        <CardHeader>
          <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Authentication Status
              </CardTitle>
              <CardDescription>
                Current authentication state and security information
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleRefreshAuthData()}
              disabled={loading || loadingHistory || loadingStats || loadingProfile}
            >
              <RefreshCw
                className={`h-4 w-4 ${loading || loadingHistory || loadingStats || loadingProfile ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {(loading || loadingHistory || loadingStats || loadingProfile) && (
            <div className="flex items-center justify-center py-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <RefreshCw className="h-4 w-4 animate-spin" />
                Updating authentication data...
              </div>
            </div>
          )}
          <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)] md:gap-x-4 md:gap-y-2 md:items-start">
            <div className="order-1 col-span-full flex min-w-0 items-center justify-between gap-3 md:order-none md:contents">
              <span className="text-sm font-medium">Account Status</span>
              <Badge
                variant={(authUser?.locked ?? user.locked) ? "destructive" : "default"}
                className="shrink-0 md:justify-self-end"
              >
                {(authUser?.locked ?? user.locked) ? "Locked" : "Active"}
              </Badge>
            </div>
            <div className="order-3 col-span-full grid min-w-0 grid-cols-1 gap-x-3 gap-y-1 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start md:order-none md:contents">
              <span className="text-sm font-medium">Lock Status</span>
              <div className="flex min-w-0 flex-col gap-1 sm:items-end sm:text-right">
                {hasActiveTempLockout ? (
                  <>
                    <Badge variant="destructive" className="w-fit sm:ml-auto">
                      Temporarily locked
                    </Badge>
                    {lockedUntilValue && (
                      <span className="text-xs text-muted-foreground break-words sm:max-w-[min(100%,18rem)]">
                        Try again after {formatDateTimeWithHMS(lockedUntilValue)}
                      </span>
                    )}
                  </>
                ) : isAdminLocked ? (
                  <Badge variant="destructive" className="w-fit sm:ml-auto">
                    Locked
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="w-fit sm:ml-auto">
                    Not locked
                  </Badge>
                )}
              </div>
            </div>
            <div className="order-2 col-span-full flex min-w-0 items-center justify-between gap-3 md:order-none md:contents">
              <span className="text-sm font-medium">Email Verified</span>
              <Badge
                variant={(authUser?.emailVerified ?? user.emailVerified) ? "default" : "secondary"}
                className="shrink-0 md:justify-self-end"
              >
                {(authUser?.emailVerified ?? user.emailVerified) ? "Verified" : "Not Verified"}
              </Badge>
            </div>
            <div className="order-4 col-span-full flex min-w-0 items-center justify-between gap-3 md:order-none md:contents">
              <span className="text-sm font-medium">Password Change Required</span>
              <Badge
                variant={(authUser?.mustChangePassword ?? user.mustChangePassword) ? "destructive" : "secondary"}
                className="shrink-0 md:justify-self-end"
              >
                {(authUser?.mustChangePassword ?? user.mustChangePassword) ? "Required" : "Not Required"}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Login Statistics */}
      {loginStats && (
        <Card className="min-w-0 overflow-hidden">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Login Statistics (Last 30 Days)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">
                  {loginStats.successfulLogins}
                </div>
                <div className="text-sm text-muted-foreground">Successful Logins</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-red-600">
                  {loginStats.failedLogins}
                </div>
                <div className="text-sm text-muted-foreground">Failed Attempts</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">
                  {loginStats.successRate?.toFixed(1) || '0.0'}%
                </div>
                <div className="text-sm text-muted-foreground">Success Rate</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-purple-600">
                  {loginStats.uniqueIps}
                </div>
                <div className="text-sm text-muted-foreground">Unique IPs</div>
              </div>
            </div>
            {loginStats.lastSuccessfulLogin && (
              <div className="mt-4 pt-4 border-t">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  <span>
                    Last successful login: {formatDateTime(loginStats.lastSuccessfulLogin)}
                  </span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tabs for Sessions and Login History */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="min-w-0">
        <TabsList className="grid w-full min-w-0 grid-cols-2">
          <TabsTrigger value="sessions" className="flex min-w-0 items-center justify-center gap-1 truncate sm:gap-2">
            <Users className="h-4 w-4 shrink-0" />
            <span className="truncate">Sessions ({sessions.length})</span>
          </TabsTrigger>
          <TabsTrigger value="history" className="flex min-w-0 items-center justify-center gap-1 truncate sm:gap-2">
            <History className="h-4 w-4 shrink-0" />
            <span className="truncate">History ({loginHistory.length})</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="sessions" className="min-w-0 space-y-4">
          <Card className="min-w-0 overflow-hidden">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5 shrink-0" />
                Active Sessions ({activeSessions.length})
              </CardTitle>
              <CardDescription className="mt-1">
                Manage active sessions for this user
              </CardDescription>
            </CardHeader>
            <CardContent className="min-w-0 overflow-hidden">
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw className="h-6 w-6 animate-spin" />
                </div>
              ) : activeSessions.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <User className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No active sessions found</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {activeSessions.map((session) => {
                    const now = Date.now()
                    const expiresAt = session.expiresAt ? new Date(session.expiresAt).getTime() : null
                    const isActive = !session.revoked && (!expiresAt || expiresAt > now)
                    return (
                      <div
                        key={session.id}
                        className={`relative min-w-0 overflow-hidden rounded-lg border p-4 ${
                          session.isCurrent
                            ? "border-primary bg-primary/5"
                            : "border-border"
                        }`}
                      >
                        {session.isCurrent && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleRevokeAllSessions}
                            disabled={revokingAll || !hasOtherActiveSessions}
                            className="absolute right-2 top-2 shrink-0"
                          >
                            {revokingAll ? (
                              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <LogOut className="mr-2 h-4 w-4" />
                            )}
                            Revoke All Other Sessions
                          </Button>
                        )}
                        <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0 flex-1 space-y-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="flex items-center gap-2 text-muted-foreground">
                                {getDeviceIcon(session.deviceInfo.device?.toLowerCase())}
                                <span className="text-sm">{getSessionDeviceSummary(session)}</span>
                              </div>
                              {session.isCurrent && (
                                <Badge variant="default" className="text-xs">
                                  Current Session
                                </Badge>
                              )}
                            </div>
                            <div className="space-y-1 text-sm text-muted-foreground">
                              <div className="flex items-center gap-1 break-all">
                                <MapPin className="h-3 w-3 shrink-0" />
                                <span>{formatSessionLocation(session.deviceInfo)}</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <Clock className="h-3 w-3 shrink-0" />
                                <span>
                                  Last used:{" "}
                                  {(session.lastUsedAt || session.createdAt)
                                    ? formatDateTimeWithHMS(session.lastUsedAt || session.createdAt)
                                    : "Never"}
                                </span>
                              </div>
                            </div>
                          </div>
                          {isActive && !session.isCurrent && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleRevokeSession(session)}
                              disabled={revokingSession === session.id}
                              className="shrink-0 self-start sm:self-auto"
                            >
                              {revokingSession === session.id ? (
                                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                              ) : (
                                <LogOut className="mr-2 h-4 w-4" />
                              )}
                              Revoke
                            </Button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="min-w-0 overflow-hidden">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="h-5 w-5 shrink-0" />
                Revoked Sessions ({revokedSessions.length})
              </CardTitle>
              <CardDescription className="mt-1">
                Previously revoked sessions for this user
              </CardDescription>
            </CardHeader>
            <CardContent className="min-w-0 overflow-hidden">
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw className="h-6 w-6 animate-spin" />
                </div>
              ) : revokedSessions.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <History className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No revoked sessions found</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {revokedSessions.map((session) => (
                    <div
                      key={session.id}
                      className="relative min-w-0 overflow-hidden rounded-lg border border-border p-4"
                    >
                      <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 flex-1 space-y-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="flex items-center gap-2 text-muted-foreground">
                              {getDeviceIcon(session.deviceInfo.device?.toLowerCase())}
                              <span className="text-sm">{getSessionDeviceSummary(session)}</span>
                            </div>
                            <Badge variant="destructive" className="text-xs">
                              Revoked
                            </Badge>
                          </div>
                          <div className="space-y-1 text-sm text-muted-foreground">
                            <div className="flex items-center gap-1 break-all">
                              <Globe className="h-3 w-3 shrink-0" />
                              <span>{session.deviceInfo.hostname || "—"}</span>
                            </div>
                            <div className="flex items-center gap-1 break-all">
                              <MapPin className="h-3 w-3 shrink-0" />
                              <span>{formatSessionLocation(session.deviceInfo)}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <Clock className="h-3 w-3 shrink-0" />
                              <span>
                                Last used:{" "}
                                {(session.lastUsedAt || session.createdAt)
                                  ? formatDateTimeWithHMS(session.lastUsedAt || session.createdAt)
                                  : "Never"}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="min-w-0 space-y-4">
          <Card className="min-w-0 overflow-hidden">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="h-5 w-5" />
                Login History
              </CardTitle>
              <CardDescription>
                Recent login attempts and their status
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingHistory ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw className="h-6 w-6 animate-spin" />
                </div>
              ) : loginHistory.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <History className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No login history found</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {loginHistory.map((login) => (
                    <div
                      key={login.id}
                      className={`min-w-0 overflow-hidden rounded-lg border p-3 ${
                        login.success ? "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30" : "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30"
                      }`}
                    >
                      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            {getLoginStatusIcon(login.success)}
                            <span className="font-medium">
                              {login.success ? "Successful Login" : "Failed Login Attempt"}
                            </span>
                            <Badge variant={login.success ? "default" : "destructive"} className="text-xs">
                              {login.success ? "Success" : "Failed"}
                            </Badge>
                          </div>
                          <div className="space-y-1 text-sm text-muted-foreground">
                            <div className="flex items-center gap-1 break-all">
                              {getDeviceIcon(getLoginAttemptDeviceInfo(login).device?.toLowerCase())}
                              <span>{getLoginDeviceSummary(login)}</span>
                            </div>
                            <div className="flex items-center gap-1 break-all">
                              <MapPin className="h-3 w-3 shrink-0" />
                              <span>
                                {[login.loginCity, login.loginCountry].filter(Boolean).join(", ") || "—"}
                              </span>
                            </div>
                            <div className="flex items-center gap-1">
                              <Clock className="h-3 w-3 shrink-0" />
                              <span>{formatDateTimeWithHMS(login.attemptedAt)}</span>
                            </div>
                            {shouldShowLoginUserAgent(login.userAgent) && (
                              <div className="min-w-0 truncate text-xs">
                                {login.userAgent}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Revoke Session Dialog */}
      <AlertDialog open={showRevokeDialog} onOpenChange={setShowRevokeDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke Session</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to revoke this session? The user will be logged out from this device.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRevokeSession}
              className="bg-destructive text-destructive-foreground"
            >
              Revoke Session
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Revoke All Sessions Dialog */}
      <AlertDialog open={showRevokeAllDialog} onOpenChange={setShowRevokeAllDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke All Other Sessions</AlertDialogTitle>
            <AlertDialogDescription>
              This will log out the user from all other devices except the current one. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRevokeAllSessions}
              className="bg-destructive text-destructive-foreground"
            >
              Revoke All Sessions
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  )
}
