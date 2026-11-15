"use client"

import { EmailPreviewDialog } from "@/components/email-engine/email-preview-dialog"
import { TemplateVariablesDialog } from "@/components/email-engine/template-variables-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { getEmailQueue, processEmailQueue } from "@/lib/actions/email-engine/email-engine-actions"
import type { EmailQueueResponse } from "@/lib/types/email-engine-schema"
import { handleApiErrorResponse } from "@/lib/utils/api-error-handler"
import { formatDistanceToNow } from "date-fns"
import { AlertCircle, CheckCircle, Clock, Eye, Loader2, Play, RefreshCw, XCircle } from "lucide-react"
import React, { useEffect, useState } from "react"
import { toast } from "sonner"

export function EmailQueueList() {
  const [emails, setEmails] = useState<EmailQueueResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [selectedEmail, setSelectedEmail] = useState<EmailQueueResponse | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)

  // Add custom styles for email content
  React.useEffect(() => {
    const style = document.createElement('style')
    style.textContent = `
      .email-content ul {
        list-style-type: disc !important;
        padding-left: 1.5rem !important;
        margin: 1rem 0 !important;
      }
      .email-content ul li {
        margin-bottom: 0.25rem !important;
        margin-left: 0.5rem !important;
        display: list-item !important;
      }
      .email-content ol {
        list-style-type: decimal !important;
        padding-left: 1.5rem !important;
        margin: 1rem 0 !important;
      }
      .email-content ol li {
        margin-bottom: 0.25rem !important;
        margin-left: 0.5rem !important;
        display: list-item !important;
      }
      .email-content p {
        margin-bottom: 1rem !important;
        line-height: 1.6 !important;
      }
      .email-content strong {
        font-weight: 600 !important;
      }
      .email-content a {
        color: #dc2626 !important;
        text-decoration: underline !important;
      }
      .email-content a:hover {
        color: #b91c1c !important;
      }
    `
    document.head.appendChild(style)
    return () => {
      if (document.head.contains(style)) {
        document.head.removeChild(style)
      }
    }
  }, [])

  useEffect(() => {
    loadQueue()
  }, [statusFilter])

  async function loadQueue() {
    setLoading(true)
    const result = await getEmailQueue(0, 100, statusFilter !== "all" ? statusFilter : undefined)

    if (handleApiErrorResponse(result, "Failed to load email queue")) {
      setLoading(false)
      return
    }

    if (result.status === "success" && result.data) {
      setEmails(result.data.queueItems || [])
    }
    setLoading(false)
  }

  async function handleProcessQueue() {
    setProcessing(true)
    const result = await processEmailQueue()

    if (handleApiErrorResponse(result, "Failed to process queue")) {
      setProcessing(false)
      return
    }

    if (result.status === "success" && result.data) {
      toast.success(`Processed ${result.data.processedCount} email(s)`)
      loadQueue()
    }
    setProcessing(false)
  }

  const handlePreview = (email: EmailQueueResponse) => {
    setSelectedEmail(email)
    setPreviewOpen(true)
  }

  function getStatusBadge(status: string, errorMessage?: string) {
    const config: Record<string, { variant: "default" | "secondary" | "outline" | "destructive"; icon: any; label: string }> = {
      pending: { variant: "secondary", icon: Clock, label: "Pending" },
      processing: { variant: "default", icon: Loader2, label: "Processing" },
      sent: { variant: "outline", icon: CheckCircle, label: "Sent" },
      failed: { variant: "destructive", icon: XCircle, label: "Failed" },
      cancelled: { variant: "outline", icon: AlertCircle, label: "Cancelled" },
    }

    const { variant, icon: Icon, label } = config[status] || config.pending

    const badge = (
      <Badge variant={variant} className="gap-1">
        <Icon className="h-3 w-3" />
        {label}
      </Badge>
    )

    // Show tooltip with error message for failed status
    if (status === "failed" && errorMessage) {
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

  function getPriorityBadge(priority: number) {
    if (priority <= 3) return <Badge variant="destructive">High</Badge>
    if (priority <= 6) return <Badge variant="default">Normal</Badge>
    return <Badge variant="secondary">Low</Badge>
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <TooltipProvider>
      <div className="space-y-4">
      {/* Actions */}
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-4">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="processing">Processing</SelectItem>
              <SelectItem value="sent">Sent</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">
            {emails.length} email{emails.length !== 1 ? "s" : ""} in queue
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={loadQueue}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button size="sm" onClick={handleProcessQueue} disabled={processing}>
            {processing ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Play className="h-4 w-4 mr-2" />
            )}
            Process Queue
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Recipients</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead>Template</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Attempts</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {emails.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                  No emails in queue
                </TableCell>
              </TableRow>
            ) : (
              emails.map((email) => (
                <TableRow key={email.id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">{email.toEmails[0]}</span>
                      {email.toEmails.length > 1 && (
                        <span className="text-xs text-muted-foreground">
                          +{email.toEmails.length - 1} more
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="max-w-xs truncate" title={email.subject}>
                    {email.subject}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      {email.templateKey && (
                        <code className="text-xs bg-muted px-2 py-1 rounded">
                          {email.templateKey}
                        </code>
                      )}
                      {email.templateId && (
                        <code className="text-xs bg-muted px-2 py-1 rounded">
                          {email.templateId}
                        </code>
                      )}
                      {!email.templateKey && !email.templateId && (
                        <span className="text-xs text-muted-foreground">Direct</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{getStatusBadge(email.status, email.errorMessage)}</TableCell>
                  <TableCell>{getPriorityBadge(email.priority)}</TableCell>
                  <TableCell>
                    <div className="flex flex-col text-sm">
                      <span className="font-medium">{email.attempts}/{email.maxAttempts}</span>
                      {email.errorMessage && (
                        <span className="text-xs text-destructive truncate max-w-20" title={email.errorMessage}>
                          Error
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDistanceToNow(new Date(email.createdAt), { addSuffix: true })}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {/* Email Preview Button */}
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Preview email"
                        onClick={() => handlePreview(email)}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>

                      {/* Template Variables Button */}
                      <TemplateVariablesDialog templateData={email.templateData} />
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Email Preview Dialog */}
      <EmailPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        emailData={selectedEmail as never}
      />
    </div>
    </TooltipProvider>
  )
}
