"use server"

import { ApiResponse } from "@/lib/types/api-response-schema"
import type {
  EmailAnalytics,
  EmailLogResponse,
  EmailQueueResponse
} from "@/lib/types/email-engine-schema"
import { ORG_EMAIL_MANAGE } from "@/lib/types/permission-schema"
import { apiCaller } from "@/lib/utils/api-caller-helper"
import { createServerLogger } from "@/lib/utils/logger-server"

const logger = createServerLogger('EmailSendingActions')

const BASE_URL = "/email-engine"

// =====================================================
// Template-based Email Sending
// =====================================================

export async function sendEmail(
  toEmails: string[],
  templateKey?: string,
  templateData?: Record<string, any>,
  customVariables?: Record<string, any>,
  fromName?: string,
  fromEmail?: string,
  replyTo?: string,
  ccEmails?: string[],
  bccEmails?: string[],
  priority: number = 5
): Promise<ApiResponse<EmailQueueResponse>> {
  const methodLogger = logger.forMethod('sendEmail')
  methodLogger.info('Sending email', { 
    templateKey, 
    recipientCount: toEmails.length
  })

  // Map frontend data to the backend API envelope.
  const sendData = {
    to_emails: toEmails,
    template_key: templateKey,
    template_data: templateData,
    custom_variables: customVariables,
    from_name: fromName,
    from_email: fromEmail,
    reply_to: replyTo,
    cc_emails: ccEmails,
    bcc_emails: bccEmails,
    priority: priority
  }

  const response = await apiCaller.post<EmailQueueResponse>('/email-engine/send', sendData, {
    requireAuth: true,
    requirePermission: ORG_EMAIL_MANAGE
  })
  return response
}



// =====================================================
// Queue Management
// =====================================================

export async function getEmailQueue(
  skip: number = 0,
  limit: number = 100,
  statusFilter?: string
): Promise<ApiResponse<{ queueItems: EmailQueueResponse[]; totalCount: number }>> {
  const params = new URLSearchParams({
    skip: skip.toString(),
    limit: limit.toString(),
  })
  
  if (statusFilter) {
    params.append('status_filter', statusFilter)
  }

  const response = await apiCaller.get<{ queueItems: EmailQueueResponse[]; totalCount: number }>(
    `${BASE_URL}/queue?${params.toString()}`
  )
  return response
}

export async function processEmailQueue(
  limit: number = 10
): Promise<ApiResponse<{ processedCount: number }>> {
  const methodLogger = logger.forMethod('processEmailQueue')
  methodLogger.info('Processing email queue', { limit })

  const response = await apiCaller.post<{ processedCount: number }>(
    `/email-engine/process-queue?limit=${limit}`,
    undefined,
    {
      requireAuth: true,
      requirePermission: ORG_EMAIL_MANAGE
    }
  )
  return response
}

// =====================================================
// Email Logs and Analytics
// =====================================================

export async function getEmailLogs(
  skip: number = 0,
  limit: number = 100,
  statusFilter?: string,
  statusFilters?: string[],
  templateId?: string,
  search?: string
): Promise<ApiResponse<{ logs: EmailLogResponse[]; totalCount: number }>> {
  const params = new URLSearchParams({
    skip: skip.toString(),
    limit: limit.toString(),
  })
  
  if (statusFilter) {
    params.append('statusFilter', statusFilter)
  }
  
  if (statusFilters && statusFilters.length > 0) {
    statusFilters.forEach(filter => {
      params.append('statusFilters', filter)
    })
  }
  
  if (templateId) {
    params.append('templateId', templateId)
  }
  
  if (search) {
    params.append('search', search)
  }

  const response = await apiCaller.get<{ logs: EmailLogResponse[]; totalCount: number }>(
    `${BASE_URL}/logs?${params.toString()}`
  )
  return response
}

export async function getEmailAnalytics(): Promise<ApiResponse<EmailAnalytics>> {
  const response = await apiCaller.get<EmailAnalytics>('/email-engine/analytics')
  return response
}
