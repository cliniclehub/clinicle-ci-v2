/**
 * Email Verification Actions
 */
"use server"

import { ApiResponse } from "@/lib/types/api-response-schema"
import { apiCaller } from "@/lib/utils/api-caller-helper"

export interface SendEmailVerificationRequest {
  email: string
}

export interface SendEmailVerificationResponse {
  verificationId: string
  status: string
  email: string
}

export interface VerifyEmailCodeRequest {
  email: string
  code: string
}

export interface VerifyEmailCodeResponse {
  verified: boolean
  status: string
  email: string
}

export interface EmailVerificationStatus {
  emailVerified: boolean
  emailVerifiedAt: string | null
  email: string | null
}

/**
 * Send email verification code
 */
export async function sendEmailVerificationCode(
  data: SendEmailVerificationRequest
): Promise<ApiResponse<SendEmailVerificationResponse>> {
  const response = await apiCaller.post<SendEmailVerificationResponse>(
    "/users/me/email/send-verification",
    data,
    {
      requireAuth: true,
    }
  )
  return response
}

/**
 * Verify email code
 */
export async function verifyEmailCode(
  data: VerifyEmailCodeRequest
): Promise<ApiResponse<VerifyEmailCodeResponse>> {
  const response = await apiCaller.post<VerifyEmailCodeResponse>(
    "/users/me/email/verify",
    data,
    {
      requireAuth: true,
    }
  )
  return response
}

/**
 * Get email verification status
 */
export async function getEmailVerificationStatus(): Promise<ApiResponse<EmailVerificationStatus>> {
  const response = await apiCaller.get<EmailVerificationStatus>(
    "/users/me/email/verification-status",
    {
      requireAuth: true,
    }
  )
  return response
}
