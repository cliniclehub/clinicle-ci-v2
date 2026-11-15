"use server"

import { ApiResponse } from "@/lib/types/api-response-schema"
import type {
  EmailTemplateCreate,
  EmailTemplateResponse,
  EmailTemplateUpdate,
  TemplatePreviewRequest,
  TemplatePreviewResponse,
  TemplateTestRequest,
  TemplateTestResponse,
} from "@/lib/types/email-template-schema"
import { ORG_EMAIL_MANAGE } from "@/lib/types/permission-schema"
import { apiCaller } from "@/lib/utils/api-caller-helper"

/** Resource paths under `/email-templates/{id}`. */
const BASE_URL = "/email-templates"
/**
 * Collection list/create must use a trailing slash. The API uses `redirect_slashes=False`, so
 * `/email-templates` and `/email-templates/` are different routes; the backend registers `@router.post("/")`
 * on prefix `/email-templates` → `/email-templates/` only.
 */
const COLLECTION_URL = `${BASE_URL}/`

const EMAIL_TEMPLATE_AUTH = {
  requireAuth: true,
  requirePermission: ORG_EMAIL_MANAGE,
} as const

// =====================================================
// Email Template CRUD
// =====================================================

export async function createEmailTemplate(
  data: EmailTemplateCreate
): Promise<ApiResponse<EmailTemplateResponse>> {
  const response = await apiCaller.post<EmailTemplateResponse>(
    COLLECTION_URL,
    data,
    EMAIL_TEMPLATE_AUTH
  )
  return response
}

export async function getEmailTemplates(
  skip: number = 0,
  limit: number = 100,
  isActive?: boolean,
  category?: string
): Promise<ApiResponse<{ templates: EmailTemplateResponse[]; totalCount: number }>> {
  const params = new URLSearchParams({
    skip: skip.toString(),
    limit: limit.toString(),
  })

  if (isActive !== undefined) {
    params.append("isActive", isActive.toString())
  }

  if (category) {
    params.append("category", category)
  }

  const response = await apiCaller.get<{ templates: EmailTemplateResponse[]; totalCount: number }>(
    `${COLLECTION_URL}?${params.toString()}`,
    EMAIL_TEMPLATE_AUTH
  )
  return response
}

export async function getEmailTemplate(
  templateId: string
): Promise<ApiResponse<EmailTemplateResponse>> {
  const response = await apiCaller.get<EmailTemplateResponse>(
    `${BASE_URL}/${templateId}`,
    EMAIL_TEMPLATE_AUTH
  )
  return response
}

export async function updateEmailTemplate(
  templateId: string,
  data: EmailTemplateUpdate
): Promise<ApiResponse<EmailTemplateResponse>> {
  const response = await apiCaller.put<EmailTemplateResponse>(
    `${BASE_URL}/${templateId}`,
    data,
    EMAIL_TEMPLATE_AUTH
  )
  return response
}

export async function restoreEmailTemplateToDefault(
  templateId: string
): Promise<ApiResponse<EmailTemplateResponse>> {
  const response = await apiCaller.post<EmailTemplateResponse>(
    `${BASE_URL}/${templateId}/restore-default`,
    {},
    EMAIL_TEMPLATE_AUTH
  )
  return response
}

export async function deleteEmailTemplate(
  templateId: string
): Promise<ApiResponse<null>> {
  const response = await apiCaller.delete<null>(`${BASE_URL}/${templateId}`, EMAIL_TEMPLATE_AUTH)
  return response
}

// =====================================================
// Template Preview and Testing
// =====================================================

export async function previewTemplate(
  templateId: string,
  variables?: Record<string, any>
): Promise<ApiResponse<TemplatePreviewResponse>> {
  const data: TemplatePreviewRequest = { variables }
  const response = await apiCaller.post<TemplatePreviewResponse>(
    `${BASE_URL}/${templateId}/preview`,
    data,
    EMAIL_TEMPLATE_AUTH
  )
  return response
}

export async function testTemplateRendering(
  templateId: string,
  testVariables: Record<string, any>
): Promise<ApiResponse<TemplateTestResponse>> {
  const data: TemplateTestRequest = { testVariables }
  const response = await apiCaller.post<TemplateTestResponse>(
    `${BASE_URL}/${templateId}/test`,
    data,
    EMAIL_TEMPLATE_AUTH
  )
  return response
}
