"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useRoles } from "@/lib/contexts/role-context"
import type { RoleId } from "@/lib/types/role-schema"
import { Archive, Bell, Check, Filter, MoreHorizontal, Trash2 } from "lucide-react"
import { useState } from "react"

type NotificationPriority = "high" | "medium" | "low"
type NotificationType = "system" | "feature" | "security" | "request" | "user"

interface Notification {
  id: number
  title: string
  message: string
  time: string
  type: NotificationType
  isRead: boolean
  priority: NotificationPriority
}

const notificationsByRole: Record<RoleId, Notification[]> = {
  user: [
    {
      id: 1,
      title: "Welcome",
      message: "Your account is ready. Complete your profile to get started.",
      time: "2 hours ago",
      type: "user",
      isRead: false,
      priority: "medium",
    },
    {
      id: 2,
      title: "Settings updated",
      message: "Your notification preferences were saved.",
      time: "1 day ago",
      type: "system",
      isRead: true,
      priority: "low",
    },
  ],
  org_admin: [
    {
      id: 1,
      title: "New user",
      message: "A new user joined your organization this week.",
      time: "5 hours ago",
      type: "user",
      isRead: false,
      priority: "medium",
    },
    {
      id: 2,
      title: "Access request",
      message: "A team member requested an organization role change.",
      time: "1 day ago",
      type: "request",
      isRead: true,
      priority: "medium",
    },
    {
      id: 3,
      title: "System update",
      message: "Platform maintenance is scheduled for the weekend.",
      time: "2 days ago",
      type: "system",
      isRead: false,
      priority: "low",
    },
  ],
  super_admin: [
    {
      id: 1,
      title: "System alert",
      message: "Database backup completed successfully.",
      time: "1 hour ago",
      type: "system",
      isRead: false,
      priority: "low",
    },
    {
      id: 2,
      title: "New feature",
      message: "A new reporting module is ready for review.",
      time: "6 hours ago",
      type: "feature",
      isRead: true,
      priority: "medium",
    },
    {
      id: 3,
      title: "Security update",
      message: "Critical security patches were applied.",
      time: "1 day ago",
      type: "security",
      isRead: false,
      priority: "high",
    },
  ],
}

const priorityColors = {
  high: "bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400",
  medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400",
  low: "bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400",
}

const typeColors = {
  system: "bg-slate-100 text-slate-800 dark:bg-slate-900/20 dark:text-slate-400",
  feature: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400",
  security: "bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400",
  request: "bg-amber-100 text-amber-800 dark:bg-amber-900/20 dark:text-amber-400",
  user: "bg-teal-100 text-teal-800 dark:bg-teal-900/20 dark:text-teal-400",
}

export default function NotificationsPage() {
  const { activeRole } = useRoles()
  const [notifications, setNotifications] = useState(() => {
    return notificationsByRole[activeRole ?? "user"] || []
  })

  const [filter, setFilter] = useState<"all" | "unread" | "read">("all")
  const [selectedNotifications, setSelectedNotifications] = useState<Set<number>>(new Set())

  const filteredNotifications = notifications.filter((notification) => {
    if (filter === "unread") return !notification.isRead
    if (filter === "read") return notification.isRead
    return true
  })

  const unreadCount = notifications.filter((n) => !n.isRead).length
  const selectedCount = selectedNotifications.size

  const markAsRead = (id: number) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
    )
  }

  const markAllAsRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })))
    setSelectedNotifications(new Set())
  }

  const deleteNotification = (id: number) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id))
    setSelectedNotifications((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  const deleteSelected = () => {
    setNotifications((prev) => prev.filter((n) => !selectedNotifications.has(n.id)))
    setSelectedNotifications(new Set())
  }

  const toggleSelection = (id: number) => {
    setSelectedNotifications((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Notifications</h1>
          <p className="text-muted-foreground">
            {unreadCount} unread notification{unreadCount !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selectedCount > 0 && (
            <>
              <Button variant="outline" size="sm" onClick={deleteSelected}>
                <Trash2 className="h-4 w-4 mr-2" />
                Delete Selected ({selectedCount})
              </Button>
              <Button variant="outline" size="sm" onClick={markAllAsRead}>
                <Check className="h-4 w-4 mr-2" />
                Mark as Read
              </Button>
            </>
          )}
          <Button onClick={markAllAsRead} disabled={unreadCount === 0}>
            <Check className="h-4 w-4 mr-2" />
            Mark All as Read
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Filter className="h-5 w-5" />
              Filters
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant={filter === "all" ? "default" : "outline"}
                size="sm"
                onClick={() => setFilter("all")}
              >
                All ({notifications.length})
              </Button>
              <Button
                variant={filter === "unread" ? "default" : "outline"}
                size="sm"
                onClick={() => setFilter("unread")}
              >
                Unread ({unreadCount})
              </Button>
              <Button
                variant={filter === "read" ? "default" : "outline"}
                size="sm"
                onClick={() => setFilter("read")}
              >
                Read ({notifications.length - unreadCount})
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      <div className="space-y-4">
        {filteredNotifications.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Bell className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">No notifications</h3>
              <p className="text-muted-foreground text-center">
                {filter === "all"
                  ? "You're all caught up! No notifications to show."
                  : `No ${filter} notifications to show.`}
              </p>
            </CardContent>
          </Card>
        ) : (
          filteredNotifications.map((notification) => (
            <Card
              key={notification.id}
              className={`transition-all duration-200 ${
                !notification.isRead ? "border-l-4 border-l-blue-500 bg-blue-50/50 dark:bg-blue-950/20" : ""
              } ${selectedNotifications.has(notification.id) ? "ring-2 ring-blue-500" : ""}`}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-4">
                  <input
                    type="checkbox"
                    checked={selectedNotifications.has(notification.id)}
                    onChange={() => toggleSelection(notification.id)}
                    className="mt-1"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className={`font-medium ${!notification.isRead ? "text-blue-900 dark:text-blue-100" : ""}`}>
                            {notification.title}
                          </h3>
                          <Badge className={`text-xs ${typeColors[notification.type]}`}>
                            {notification.type}
                          </Badge>
                          <Badge className={`text-xs ${priorityColors[notification.priority]}`}>
                            {notification.priority}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground mb-2">
                          {notification.message}
                        </p>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span>{notification.time}</span>
                          {!notification.isRead && (
                            <span className="text-blue-600 dark:text-blue-400 font-medium">
                              Unread
                            </span>
                          )}
                        </div>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => markAsRead(notification.id)}>
                            <Check className="h-4 w-4 mr-2" />
                            Mark as Read
                          </DropdownMenuItem>
                          <DropdownMenuItem>
                            <Archive className="h-4 w-4 mr-2" />
                            Archive
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => deleteNotification(notification.id)}
                            className="text-red-600 dark:text-red-400"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  )
}
