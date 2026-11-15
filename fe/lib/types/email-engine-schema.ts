import { z } from "zod"

// =====================================================
// Email Queue Schemas
// =====================================================

export const EmailQueueBaseSchema = z.object({
  toEmails: z.array(z.string().email()).min(1, "At least one recipient is required"),
  subject: z.string().min(1, "Subject is required"),
  bodyHtml: z.string().optional(),
  bodyText: z.string().optional(),
  fromEmail: z.string().email("Invalid email format").max(255, "Email must be less than 255 characters"),
  fromName: z.string().max(255, "Name must be less than 255 characters").optional(),
  replyTo: z.string().email("Invalid email format").max(255, "Email must be less than 255 characters").optional(),
  ccEmails: z.array(z.string().email()).optional(),
  bccEmails: z.array(z.string().email()).optional(),
  priority: z.number().int().min(1).max(10).default(5)
})

export const EmailQueueSchema = EmailQueueBaseSchema.extend({
  id: z.number().int().positive(),
  organizationId: z.string().uuid(),
  templateId: z.string().uuid().optional(),
  templateKey: z.string().optional(),
  templateData: z.record(z.any()).optional(),
  status: z.enum(['pending', 'processing', 'sent', 'failed', 'cancelled']),
  errorMessage: z.string().optional(),
  errorDetails: z.string().optional(),
  sentAt: z.string().datetime().optional(),
  scheduledAt: z.string().datetime().optional(),
  attempts: z.number().int().min(0).default(0),
  maxAttempts: z.number().int().min(1).default(3),
  lastAttemptAt: z.string().datetime().optional(),
  nextRetryAt: z.string().datetime().optional(),
  providerMessageId: z.string().optional(),
  createdBy: z.string().uuid().optional(),
  batchId: z.string().uuid().optional(),
  batchName: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
})

// =====================================================
// Email Log Schemas
// =====================================================

export const EmailLogBaseSchema = z.object({
  toEmails: z.array(z.string().email()).min(1, "At least one recipient is required"),
  ccEmails: z.array(z.string().email()).optional(),
  bccEmails: z.array(z.string().email()).optional(),
  subject: z.string().min(1, "Subject is required"),
  bodyHtml: z.string().optional(),
  bodyText: z.string().optional(),
  fromEmail: z.string().email("Invalid email format").max(255, "Email must be less than 255 characters"),
  fromName: z.string().max(255, "Name must be less than 255 characters").optional(),
  replyTo: z.string().email("Invalid email format").max(255, "Email must be less than 255 characters").optional(),
  templateData: z.record(z.any()).optional(),
  status: z.enum(['sent', 'delivered', 'bounced', 'failed', 'opened', 'clicked', 'complained']),
  priority: z.number().int().min(1).max(10).default(5),
  attempts: z.number().int().min(0).default(0),
  maxAttempts: z.number().int().min(1).default(3),
  errorMessage: z.string().optional(),
  errorCode: z.string().optional(),
  errorDetails: z.record(z.any()).optional(),
  providerMessageId: z.string().optional(),
  openCount: z.number().int().min(0).default(0),
  clickCount: z.number().int().min(0).default(0),
  bounceType: z.string().optional(),
  bounceReason: z.string().optional(),
  complaintFeedbackType: z.string().optional(),
  userAgent: z.string().optional(),
  ipAddress: z.string().optional()
})

export const EmailLogSchema = EmailLogBaseSchema.extend({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  queueId: z.string().uuid().optional(),
  templateId: z.string().uuid().optional(),
  templateKey: z.string().optional(),
  userId: z.string().uuid().optional(),
  sentAt: z.string().datetime().optional(),
  deliveredAt: z.string().datetime().optional(),
  openedAt: z.string().datetime().optional(),
  firstClickedAt: z.string().datetime().optional(),
  bouncedAt: z.string().datetime().optional(),
  complainedAt: z.string().datetime().optional(),
  batchId: z.string().uuid().optional(),
  batchName: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
})

// =====================================================
// Email Sending Request Schemas
// =====================================================

export const SendTemplateEmailRequestSchema = z.object({
  templateKey: z.string().min(1, "Template key is required"),
  toEmails: z.array(z.string().email()).min(1, "At least one recipient is required"),
  templateVariables: z.record(z.any()).optional(),
  ccEmails: z.array(z.string().email()).optional(),
  bccEmails: z.array(z.string().email()).optional(),
  priority: z.number().int().min(1).max(10).default(5)
})

export const SendBulkEmailRequestSchema = z.object({
  templateKey: z.string().min(1, "Template key is required"),
  cohortId: z.string().uuid().optional(),
  userIds: z.array(z.string().uuid()).optional(),
  emailAddresses: z.array(z.string().email()).optional(),
  templateVariables: z.record(z.any()).optional(),
  ccEmails: z.array(z.string().email()).optional(),
  bccEmails: z.array(z.string().email()).optional(),
  priority: z.number().int().min(1).max(10).default(5)
}).refine(
  (data) => data.cohortId || data.userIds || data.emailAddresses,
  {
    message: "At least one of cohortId, userIds, or emailAddresses must be provided",
    path: ["cohortId"]
  }
)

export const DirectEmailRequestSchema = z.object({
  toEmails: z.array(z.string().email()).min(1, "At least one recipient is required"),
  subject: z.string().min(1, "Subject is required"),
  bodyHtml: z.string().optional(),
  bodyText: z.string().optional(),
  ccEmails: z.array(z.string().email()).optional(),
  bccEmails: z.array(z.string().email()).optional(),
  replyTo: z.string().email("Invalid email format").optional()
})

export const UserEmailRequestSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1, "At least one user ID is required"),
  subject: z.string().min(1, "Subject is required"),
  bodyHtml: z.string().min(1, "HTML body is required"),
  bodyText: z.string().optional(),
  sendToMe: z.boolean().default(false)
})

export const TestEmailRequestSchema = z.object({
  recipientEmail: z.string().email("Invalid email format").max(255, "Email must be less than 255 characters"),
  templateVariables: z.record(z.any()).optional()
})

// =====================================================
// Analytics Schemas
// =====================================================

export const EmailAnalyticsSchema = z.object({
  totalEmails: z.number().int().min(0),
  sent: z.number().int().min(0),
  delivered: z.number().int().min(0),
  bounced: z.number().int().min(0),
  failed: z.number().int().min(0),
  opened: z.number().int().min(0).optional(),
  clicked: z.number().int().min(0).optional(),
  deliveryRate: z.number().min(0).max(100),
  bounceRate: z.number().min(0).max(100),
  failureRate: z.number().min(0).max(100),
  openRate: z.number().min(0).max(100).optional(),
  clickRate: z.number().min(0).max(100).optional(),
  statusBreakdown: z.record(z.number().int().min(0)),
  templateUsage: z.array(z.object({
    templateId: z.string(),
    count: z.number().int().min(0)
  }))
})

// =====================================================
// TypeScript Types
// =====================================================

export type EmailQueueBase = z.infer<typeof EmailQueueBaseSchema>
export type EmailQueue = z.infer<typeof EmailQueueSchema>
export type EmailQueueResponse = EmailQueue

export type EmailLogBase = z.infer<typeof EmailLogBaseSchema>
export type EmailLog = z.infer<typeof EmailLogSchema>
export type EmailLogResponse = EmailLog

export type SendTemplateEmailRequest = z.infer<typeof SendTemplateEmailRequestSchema>
export type SendBulkEmailRequest = z.infer<typeof SendBulkEmailRequestSchema>
export type DirectEmailRequest = z.infer<typeof DirectEmailRequestSchema>
export type UserEmailRequest = z.infer<typeof UserEmailRequestSchema>
export type TestEmailRequest = z.infer<typeof TestEmailRequestSchema>

export type EmailAnalytics = z.infer<typeof EmailAnalyticsSchema>
