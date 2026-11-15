"use client"

import { EmailPreviewDialog } from "@/components/email-engine/email-preview-dialog"
import { TemplateVariablesDialog } from "@/components/email-engine/template-variables-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { DataTableServerSide } from "@/components/ui/data-table-server-side"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { getEmailAnalytics, getEmailLogs } from "@/lib/actions/email-engine/email-engine-actions"
import type { EmailAnalytics, EmailLogResponse } from "@/lib/types/email-engine-schema"
import { handleApiErrorResponse } from "@/lib/utils/api-error-handler"
import { ColumnDef } from "@tanstack/react-table"
import { formatDistanceToNow } from "date-fns"
import {
  Ban,
  CheckCircle,
  Eye,
  EyeIcon,
  Mail,
  Minus,
  MousePointer,
  TrendingDown,
  TrendingUp,
  XCircle
} from "lucide-react"
import { useEffect, useState } from "react"

export function EmailLogsList() {
  const [logs, setLogs] = useState<EmailLogResponse[]>([])
  const [analytics, setAnalytics] = useState<EmailAnalytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [selectedLog, setSelectedLog] = useState<EmailLogResponse | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [searchTerm, setSearchTerm] = useState("")
  const [sortBy, setSortBy] = useState("sentAt")
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc")
  const [activeFilters, setActiveFilters] = useState<Record<string, string[]>>({})

  useEffect(() => {
    loadData()
  }, [currentPage, pageSize, searchTerm, activeFilters, sortBy, sortOrder])

  async function loadData() {
    setLoading(true)

    // Get status filters from activeFilters
    const statusFilters = activeFilters.status || []
    const hasStatusFilters = statusFilters.length > 0 && !statusFilters.includes("all")

    // Load logs
    const logsResult = await getEmailLogs(
      (currentPage - 1) * pageSize,
      pageSize,
      undefined, // statusFilter (single)
      hasStatusFilters ? statusFilters : undefined, // statusFilters (multiple)
      undefined, // templateId
      searchTerm || undefined
    )

    if (handleApiErrorResponse(logsResult, "Failed to load email logs")) {
      setLoading(false)
      return
    }

    if (logsResult.status === "success" && logsResult.data) {
      setLogs(logsResult.data.logs || [])
      setTotal(logsResult.data.totalCount || 0)
    }

    // Load analytics
    const analyticsResult = await getEmailAnalytics()

    if (handleApiErrorResponse(analyticsResult, "Failed to load email analytics")) {
      setLoading(false)
      return
    }

    if (analyticsResult.status === "success" && analyticsResult.data) {
      setAnalytics(analyticsResult.data)
    }

    setLoading(false)
  }

  function getStatusBadge(status: string, errorMessage?: string) {
    const config: Record<string, { variant: "default" | "secondary" | "outline" | "destructive"; icon: any }> = {
      sent: { variant: "outline", icon: Mail },
      delivered: { variant: "default", icon: CheckCircle },
      opened: { variant: "default", icon: Eye },
      clicked: { variant: "default", icon: MousePointer },
      bounced: { variant: "destructive", icon: XCircle },
      complained: { variant: "destructive", icon: XCircle },
      failed: { variant: "destructive", icon: XCircle },
      blocked: { variant: "secondary", icon: Ban },
    }

    const { variant, icon: Icon } = config[status] || { variant: "outline", icon: Mail }

    const badge = (
      <Badge variant={variant} className="gap-1">
        <Icon className="h-3 w-3" />
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    )

    // Show error/reason tooltip for failed and blocked statuses
    if ((status === "failed" || status === "blocked") && errorMessage) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            {badge}
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <p className="text-sm">{errorMessage}</p>
          </TooltipContent>
        </Tooltip>
      )
    }

    return badge
  }

  function formatRate(rate: number | undefined) {
    if (rate === undefined || rate === null || isNaN(rate)) {
      return "0.0%"
    }
    return `${rate.toFixed(1)}%`
  }

  function getRateIcon(rate: number | undefined, threshold: number = 50) {
    if (rate === undefined || rate === null || isNaN(rate)) {
      return <Minus className="h-4 w-4 text-muted-foreground" />
    }
    if (rate > threshold) return <TrendingUp className="h-4 w-4 text-green-600" />
    if (rate < threshold / 2) return <TrendingDown className="h-4 w-4 text-red-600" />
    return <Minus className="h-4 w-4 text-muted-foreground" />
  }

  function formatRecipients(toEmails: string[] | null | undefined, ccEmails?: string[] | null, bccEmails?: string[] | null) {
    if (!toEmails || toEmails.length === 0) return "No recipients"
    
    let recipients = toEmails.join(", ")
    
    if (ccEmails && ccEmails.length > 0) {
      recipients += ` (CC: ${ccEmails.join(", ")})`
    }
    
    if (bccEmails && bccEmails.length > 0) {
      recipients += ` (BCC: ${bccEmails.length} recipient${bccEmails.length !== 1 ? 's' : ''})`
    }
    
    return recipients
  }

  function handlePreview(log: EmailLogResponse) {
    setSelectedLog(log)
    setPreviewOpen(true)
  }

  // Column definitions for the table
  const columns: ColumnDef<EmailLogResponse>[] = [
    {
      accessorKey: "toEmails",
      header: "Recipients",
      cell: ({ row }) => {
        const log = row.original
        return (
          <div className="max-w-xs truncate" title={formatRecipients(log.toEmails, log.ccEmails, log.bccEmails)}>
            {formatRecipients(log.toEmails, log.ccEmails, log.bccEmails)}
          </div>
        )
      },
    },
    {
      accessorKey: "subject",
      header: "Subject",
      cell: ({ row }) => {
        const log = row.original
        return (
          <div className="max-w-xs truncate" title={log.subject}>
            {log.subject}
          </div>
        )
      },
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => {
        const log = row.original
        return getStatusBadge(log.status, log.errorMessage)
      },
    },
    {
      accessorKey: "attempts",
      header: "Attempts",
      cell: ({ row }) => {
        const log = row.original
        return (
          <span className="text-sm">
            {log.attempts || 0}/{log.maxAttempts || 3}
          </span>
        )
      },
    },
    {
      accessorKey: "sentAt",
      header: "Sent",
      cell: ({ row }) => {
        const log = row.original
        return (
          <span className="text-sm text-muted-foreground">
            {log.sentAt
              ? formatDistanceToNow(new Date(log.sentAt), { addSuffix: true })
              : "Not sent"}
          </span>
        )
      },
    },
    {
      id: "actions",
      header: "Actions",
      cell: ({ row }) => {
        const log = row.original
        return (
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handlePreview(log)}
              className="h-8 w-8 p-0"
            >
              <EyeIcon className="h-4 w-4" />
            </Button>
            <TemplateVariablesDialog templateData={log.templateData} />
          </div>
        )
      },
    },
  ]

  // Filterable columns configuration
  const filterableColumns = [
    {
      id: "status",
      title: "Status",
      options: [
        { label: "All Status", value: "all" },
        { label: "Sent", value: "sent" },
        { label: "Delivered", value: "delivered" },
        { label: "Opened", value: "opened" },
        { label: "Clicked", value: "clicked" },
        { label: "Blocked", value: "blocked" },
        { label: "Bounced", value: "bounced" },
        { label: "Complained", value: "complained" },
        { label: "Failed", value: "failed" },
      ],
    },
  ]

  if (loading && logs.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading email logs...</p>
        </div>
      </div>
    )
  }

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Analytics Cards */}
        {analytics && (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Emails</CardTitle>
                <Mail className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{analytics.totalEmails}</div>
                <p className="text-xs text-muted-foreground">
                  Total emails processed
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Successfully Sent</CardTitle>
                <CheckCircle className="h-4 w-4 text-green-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{analytics.sent || 0}</div>
                <p className="text-xs text-muted-foreground">
                  Sent to MailerSend
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Delivery Rate</CardTitle>
                {getRateIcon(analytics.deliveryRate, 95)}
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatRate(analytics.deliveryRate)}</div>
                <p className="text-xs text-muted-foreground">
                  {analytics.delivered} of {analytics.totalEmails} delivered
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Failure Rate</CardTitle>
                {analytics.failureRate > 10 ? (
                  <TrendingUp className="h-4 w-4 text-red-600" />
                ) : (
                  <TrendingDown className="h-4 w-4 text-green-600" />
                )}
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatRate(analytics.failureRate)}</div>
                <p className="text-xs text-muted-foreground">
                  {analytics.failed || 0} failed to send
                </p>
              </CardContent>
            </Card>

            {/* Additional cards for webhook data when available */}
            {analytics.delivered > 0 && (
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Bounce Rate</CardTitle>
                  {analytics.bounceRate > 5 ? (
                    <TrendingUp className="h-4 w-4 text-red-600" />
                  ) : (
                    <TrendingDown className="h-4 w-4 text-green-600" />
                  )}
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{formatRate(analytics.bounceRate)}</div>
                  <p className="text-xs text-muted-foreground">
                    {analytics.bounced} bounced
                  </p>
                </CardContent>
              </Card>
            )}

            {analytics.openRate !== undefined && analytics.openRate > 0 && (
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Open Rate</CardTitle>
                  {getRateIcon(analytics.openRate, 20)}
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{formatRate(analytics.openRate)}</div>
                  <p className="text-xs text-muted-foreground">
                    {analytics.opened || 0} opened
                  </p>
                </CardContent>
              </Card>
            )}

            {analytics.clickRate !== undefined && analytics.clickRate > 0 && (
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Click Rate</CardTitle>
                  {getRateIcon(analytics.clickRate, 5)}
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{formatRate(analytics.clickRate)}</div>
                  <p className="text-xs text-muted-foreground">
                    {analytics.clicked || 0} clicked
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* Logs Table */}
        <Card>
          <CardHeader>
            <CardTitle>Email Logs</CardTitle>
            <CardDescription>
              View and manage email sending history
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DataTableServerSide
              columns={columns}
              data={logs}
              searchKey="subject"
              searchPlaceholder="Search by subject, recipients, or template..."
              filterableColumns={filterableColumns}
              pageSize={pageSize}
              pageSizeOptions={[10, 20, 30, 50, 100]}
              totalItems={total}
              currentPage={currentPage}
              isLoading={loading}
              onPageChange={(page) => setCurrentPage(page)}
              onPageSizeChange={(size) => {
                setPageSize(size)
                setCurrentPage(1)
              }}
              onSearchChange={(search) => {
                setSearchTerm(search)
                setCurrentPage(1)
              }}
              onFilterChange={(columnId, value) => {
                setActiveFilters(prev => ({
                  ...prev,
                  [columnId]: value
                }))
                setCurrentPage(1)
              }}
              onSortChange={(columnId, direction) => {
                if (direction) {
                  setSortBy(columnId)
                  setSortOrder(direction)
                }
              }}
              activeFilters={activeFilters}
              sortColumn={sortBy}
              sortDirection={sortOrder}
            />
          </CardContent>
        </Card>

        {/* Email Preview Dialog */}
        <EmailPreviewDialog
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          emailData={selectedLog}
        />
      </div>
    </TooltipProvider>
  )
}
