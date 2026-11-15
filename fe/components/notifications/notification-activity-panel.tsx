"use client"

import { RefreshCw } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  listNotificationDeliveries,
  listNotificationSchedules,
} from "@/lib/actions/notifications/notification-actions"
import {
  NotificationDelivery,
  NotificationSchedule,
} from "@/lib/types/notification-schema"
import { handleApiErrorResponse } from "@/lib/utils/api-error-handler"
import { cn } from "@/lib/utils/cn"
import { createClientLogger } from "@/lib/utils/logger-client"

const logger = createClientLogger("NotificationActivityPanel")

const STATUS_OPTIONS = [
  { label: "Active", value: "active" },
  { label: "All statuses", value: "all" },
  { label: "Pending", value: "pending" },
  { label: "Dispatched", value: "dispatched" },
  { label: "Sent", value: "sent" },
  { label: "Skipped", value: "skipped" },
  { label: "Failed", value: "failed" },
  { label: "Cancelled", value: "cancelled" },
]

function formatDateTime(value?: string | null): string {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}

function statusClassName(status: string): string {
  switch (status) {
    case "pending":
      return "bg-amber-100 text-amber-800"
    case "dispatched":
    case "sent":
      return "bg-emerald-100 text-emerald-800"
    case "skipped":
      return "bg-slate-100 text-slate-700"
    case "failed":
      return "bg-red-100 text-red-800"
    case "cancelled":
      return "bg-zinc-100 text-zinc-700"
    default:
      return "bg-muted text-muted-foreground"
  }
}

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="surface" className={cn("capitalize", statusClassName(status))}>
      {status}
    </Badge>
  )
}

function targetLabel(item: Pick<NotificationSchedule | NotificationDelivery, "sourceType" | "sourceId">) {
  return `${item.sourceType}: ${item.sourceId}`
}

export function NotificationActivityPanel() {
  const [status, setStatus] = useState("active")
  const [schedules, setSchedules] = useState<NotificationSchedule[]>([])
  const [deliveries, setDeliveries] = useState<NotificationDelivery[]>([])
  const [loading, setLoading] = useState(false)

  const loadActivity = useCallback(async () => {
    try {
      setLoading(true)
      const query = {
        ...(status === "active"
          ? { excludeStatuses: "cancelled" }
          : status !== "all"
            ? { status }
            : {}),
        page: 1,
        pageSize: 10,
      }
      const [scheduleResponse, deliveryResponse] = await Promise.all([
        listNotificationSchedules(query),
        listNotificationDeliveries(query),
      ])
      if (handleApiErrorResponse(scheduleResponse, "Failed to load notification schedules")) return
      if (handleApiErrorResponse(deliveryResponse, "Failed to load notification deliveries")) return
      if (scheduleResponse.status === "success") {
        setSchedules(scheduleResponse.data?.items || [])
      }
      if (deliveryResponse.status === "success") {
        setDeliveries(deliveryResponse.data?.items || [])
      }
    } catch (error) {
      logger.error("Failed to load notification activity", error as Error)
      toast.error("Failed to load notification activity")
    } finally {
      setLoading(false)
    }
  }, [status])

  useEffect(() => {
    void loadActivity()
  }, [loadActivity])

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <CardTitle>Notification activity</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Review scheduled reminders and delivery outcomes. Use Cron Jobs to run dispatch or reconcile.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" variant="outline" onClick={loadActivity} disabled={loading} className="gap-2">
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Scheduled reminders</h3>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reminder</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Fire time</TableHead>
                  <TableHead>Event time</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {schedules.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      No scheduled reminders found.
                    </TableCell>
                  </TableRow>
                ) : (
                  schedules.map((schedule) => (
                    <TableRow key={schedule.id}>
                      <TableCell className="font-medium">
                        {schedule.ruleDisplayName || schedule.ruleKey}
                      </TableCell>
                      <TableCell>{targetLabel(schedule)}</TableCell>
                      <TableCell>{formatDateTime(schedule.fireAt)}</TableCell>
                      <TableCell>{formatDateTime(schedule.eventAt)}</TableCell>
                      <TableCell>
                        <StatusBadge status={schedule.status} />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-medium">Recent deliveries</h3>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reminder</TableHead>
                  <TableHead>Recipient</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Sent time</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deliveries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      No deliveries found.
                    </TableCell>
                  </TableRow>
                ) : (
                  deliveries.map((delivery) => (
                    <TableRow key={delivery.id}>
                      <TableCell className="font-medium">
                        {delivery.ruleDisplayName || delivery.ruleKey}
                      </TableCell>
                      <TableCell>
                        <div>{delivery.userName || "User"}</div>
                        {delivery.userEmail && (
                          <div className="text-xs text-muted-foreground">{delivery.userEmail}</div>
                        )}
                      </TableCell>
                      <TableCell>{targetLabel(delivery)}</TableCell>
                      <TableCell>{formatDateTime(delivery.deliveredAt || delivery.createdAt)}</TableCell>
                      <TableCell>
                        <StatusBadge status={delivery.status} />
                      </TableCell>
                      <TableCell className="max-w-[280px] truncate text-muted-foreground">
                        {delivery.errorMessage || "-"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
