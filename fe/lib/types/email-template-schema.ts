import { z } from "zod"

// =====================================================
// Email Template Schemas
// =====================================================

export const EmailTemplateBaseSchema = z.object({
  templateKey: z.string().min(1, "Template key is required").max(100, "Template key must be less than 100 characters"),
  name: z.string().min(1, "Name is required").max(255, "Name must be less than 255 characters"),
  subject: z.string().min(1, "Subject is required"),
  bodyHtml: z.string().optional(),
  bodyText: z.string().optional(),
  fromEmail: z.string().email("Invalid email format").max(255, "Email must be less than 255 characters").optional(),
  fromName: z.string().max(255, "Name must be less than 255 characters").optional(),
  replyTo: z.string().email("Invalid email format").max(255, "Email must be less than 255 characters").optional(),
  category: z.string().max(100, "Category must be less than 100 characters").optional(),
  description: z.string().optional(),
  isActive: z.boolean().default(true),
  availableFields: z.array(z.object({
    field: z.string(),
    description: z.string().optional(),
    example: z.string().optional(),
    required: z.boolean().default(false)
  })).optional()
})

export const EmailTemplateCreateSchema = EmailTemplateBaseSchema

export const EmailTemplateUpdateSchema = z.object({
  templateKey: z.string().min(1).max(100).optional(),
  name: z.string().min(1).max(255).optional(),
  subject: z.string().min(1).optional(),
  bodyHtml: z.string().optional(),
  bodyText: z.string().optional(),
  fromEmail: z.string().email().max(255).optional(),
  fromName: z.string().max(255).optional(),
  replyTo: z.string().email().max(255).optional(),
  category: z.string().max(100).optional(),
  description: z.string().optional(),
  isActive: z.boolean().optional(),
  availableFields: z.array(z.object({
    field: z.string(),
    description: z.string().optional(),
    example: z.string().optional(),
    required: z.boolean().default(false)
  })).optional()
})

export const EmailTemplateSchema = EmailTemplateBaseSchema.extend({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  isSystemDefault: z.boolean().default(false),
  createdBy: z.string().uuid().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
})

export const TemplatePreviewRequestSchema = z.object({
  variables: z.record(z.any()).optional()
})

export const TemplatePreviewResponseSchema = z.object({
  subject: z.string(),
  htmlContent: z.string(),
  textContent: z.string(),
  variablesUsed: z.array(z.string())
})

export const TemplateTestRequestSchema = z.object({
  testVariables: z.record(z.any())
})

export const TemplateTestResponseSchema = z.object({
  subject: z.string(),
  htmlContent: z.string(),
  textContent: z.string(),
  variablesUsed: z.array(z.string())
})

// =====================================================
// TypeScript Types
// =====================================================

export type EmailTemplateBase = z.infer<typeof EmailTemplateBaseSchema>
export type EmailTemplateCreate = z.infer<typeof EmailTemplateCreateSchema>
export type EmailTemplateUpdate = z.infer<typeof EmailTemplateUpdateSchema>
export type EmailTemplate = z.infer<typeof EmailTemplateSchema>
export type EmailTemplateResponse = EmailTemplate

export type TemplatePreviewRequest = z.infer<typeof TemplatePreviewRequestSchema>
export type TemplatePreviewResponse = z.infer<typeof TemplatePreviewResponseSchema>
export type TemplateTestRequest = z.infer<typeof TemplateTestRequestSchema>
export type TemplateTestResponse = z.infer<typeof TemplateTestResponseSchema>
