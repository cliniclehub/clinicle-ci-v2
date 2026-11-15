"use client"

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { formatDistanceToNow } from "date-fns"
import { useEffect } from "react"

/** Escape HTML entities for safe insertion */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

/** Convert plain-text URLs to clickable links (for bodyText) */
function linkifyPlainText(text: string): string {
  const urlRegex = /(https?:\/\/[^\s<>"']+)/g
  const parts: string[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  const re = new RegExp(urlRegex.source, "g")
  while ((match = re.exec(text)) !== null) {
    parts.push(escapeHtml(text.slice(lastIndex, match.index)))
    const url = match[1]
    const safeHref = url.replace(/&/g, "&amp;").replace(/"/g, "&quot;")
    parts.push(`<a href="${safeHref}" target="_blank" rel="noopener noreferrer" class="text-primary underline hover:text-primary/90 cursor-pointer">${escapeHtml(url)}</a>`)
    lastIndex = match.index + url.length
  }
  parts.push(escapeHtml(text.slice(lastIndex)))
  return parts.join("")
}

/** Ensure links in HTML have target="_blank" and rel for security (for bodyHtml) */
function ensureLinksClickable(html: string): string {
  return html.replace(/<a\s+([^>]*?)>/gi, (_, attrs) => {
    const hasTarget = /target\s*=/i.test(attrs)
    const hasRel = /rel\s*=/i.test(attrs)
    let extra = ""
    if (!hasTarget) extra += ' target="_blank"'
    if (!hasRel) extra += ' rel="noopener noreferrer"'
    return `<a ${attrs}${extra}>`
  })
}

interface EmailPreviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  emailData: {
    // Common fields for both queue and logs
    id: string
    toEmails?: string[]
    toEmail?: string // For backward compatibility with queue
    ccEmails?: string[] | null
    bccEmails?: string[] | null
    subject: string
    bodyHtml?: string | null
    bodyText?: string | null
    fromName?: string | null
    fromEmail: string
    replyTo?: string | null
    status: string
    errorMessage?: string | null
    sentAt?: string | null
    createdAt: string
    updatedAt?: string | null
    
    // Additional fields for logs
    templateData?: Record<string, any> | null
    templateKey?: string | null
    priority?: number | null
    attempts?: number | null
    maxAttempts?: number | null
    providerMessageId?: string | null
    openCount?: number | null
    clickCount?: number | null
    deliveredAt?: string | null
    openedAt?: string | null
    firstClickedAt?: string | null
    bouncedAt?: string | null
    complainedAt?: string | null
    errorCode?: string | null
    errorDetails?: Record<string, any> | string | null
    batchName?: string | null
  } | null
}

export function EmailPreviewDialog({ open, onOpenChange, emailData }: EmailPreviewDialogProps) {
  // Format recipients for display
  function formatRecipients(toEmails?: string[] | null, toEmail?: string, ccEmails?: string[] | null, bccEmails?: string[] | null) {
    // Handle both new array format and old single email format
    const recipients = toEmails || (toEmail ? [toEmail] : [])
    
    if (!recipients || recipients.length === 0) return "No recipients"
    
    let result = recipients.join(", ")
    
    if (ccEmails && ccEmails.length > 0) {
      result += ` (CC: ${ccEmails.join(", ")})`
    }
    
    if (bccEmails && bccEmails.length > 0) {
      result += ` (BCC: ${bccEmails.length} recipient${bccEmails.length !== 1 ? 's' : ''})`
    }
    
    return result
  }

  // Inject custom CSS for email content styling (HTML and linkified plain text)
  useEffect(() => {
    if (open && (emailData?.bodyHtml || emailData?.bodyText)) {
      const style = document.createElement('style')
      style.textContent = `
        .email-preview-content ul {
          list-style-type: disc !important;
          padding-left: 1.5rem !important;
          margin: 0.5rem 0 !important;
        }
        .email-preview-content ol {
          list-style-type: decimal !important;
          padding-left: 1.5rem !important;
          margin: 0.5rem 0 !important;
        }
        .email-preview-content li {
          display: list-item !important;
          margin: 0.25rem 0 !important;
        }
        .email-preview-content p {
          margin: 0.5rem 0 !important;
        }
        .email-preview-content h1, .email-preview-content h2, .email-preview-content h3 {
          margin: 1rem 0 0.5rem 0 !important;
        }
        .email-preview-content a:not([style*="background"]) {
          color: #2563eb !important;
          text-decoration: underline !important;
          cursor: pointer !important;
        }
        .email-preview-content a[style*="background"],
        .email-preview-content a.email-cta-button {
          color: #ffffff !important;
          text-decoration: none !important;
          font-weight: 600 !important;
          -webkit-text-fill-color: #ffffff !important;
        }
        .email-preview-content a[style*="background"] *,
        .email-preview-content a.email-cta-button * {
          color: #ffffff !important;
          -webkit-text-fill-color: #ffffff !important;
        }
      `
      document.head.appendChild(style)
      
      return () => {
        document.head.removeChild(style)
      }
    }
  }, [open, emailData?.bodyHtml, emailData?.bodyText])

  if (!emailData) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Email Preview</DialogTitle>
          <DialogDescription>
            View email content as it would appear to the recipient
          </DialogDescription>
        </DialogHeader>
        
        <div className="bg-muted">
          {/* Email Client Header */}
          <div className="bg-card border-b px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-muted rounded-full flex items-center justify-center">
                  <span className="text-sm font-medium text-muted-foreground">
                    {emailData.fromName ? emailData.fromName.split(' ').map(n => n[0]).join('').toUpperCase() : 'OR'}
                  </span>
                </div>
                <div>
                  <div className="font-medium text-foreground">{emailData.fromName || 'Organization'}</div>
                  <div className="text-sm text-muted-foreground">{emailData.fromEmail}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="text-sm text-muted-foreground">
                  {emailData.sentAt ? formatDistanceToNow(new Date(emailData.sentAt), { addSuffix: true }) : 
                   formatDistanceToNow(new Date(emailData.createdAt), { addSuffix: true })}
                </div>
              </div>
            </div>
            <div className="mt-3">
              <div className="text-sm text-muted-foreground">To: {formatRecipients(emailData.toEmails, emailData.toEmail, emailData.ccEmails, emailData.bccEmails)}</div>
              <div className="text-lg font-semibold text-foreground mt-2">{emailData.subject}</div>
            </div>
          </div>

          {/* Email Content */}
          <div className="bg-card px-6 py-6">
            <div className="email-preview-content">
              {emailData.bodyHtml ? (
                <div
                  dangerouslySetInnerHTML={{ __html: ensureLinksClickable(emailData.bodyHtml) }}
                  className="[&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-2 [&_ul]:my-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:space-y-2 [&_ol]:my-4 [&_li]:ml-2 [&_li]:mb-1 [&_p]:mb-4 [&_p]:leading-relaxed [&_h1]:mb-4 [&_h1]:text-xl [&_h1]:font-bold [&_h2]:mb-3 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_strong]:font-semibold [&_a:not([style*='background']):not(.email-cta-button)]:text-primary [&_a:not([style*='background']):not(.email-cta-button)]:underline [&_a:not([style*='background']):not(.email-cta-button)]:cursor-pointer [&_a:not([style*='background']):not(.email-cta-button)]:hover:text-primary/90 [&_a[style*='background']]:text-white [&_a[style*='background']]:no-underline [&_a.email-cta-button]:text-white [&_a.email-cta-button]:no-underline"
                />
              ) : emailData.bodyText ? (
                <div
                  dangerouslySetInnerHTML={{ __html: linkifyPlainText(emailData.bodyText) }}
                  className="whitespace-pre-wrap font-sans leading-relaxed [&_a]:text-primary [&_a]:underline [&_a]:cursor-pointer [&_a]:hover:text-primary/90"
                />
              ) : (
                <div className="text-muted-foreground italic">No content available</div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
