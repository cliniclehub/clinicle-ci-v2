/**
 * Phone Verification Actions
 */
"use server"

import { ApiResponse } from "@/lib/types/api-response-schema"
import { apiCaller } from "@/lib/utils/api-caller-helper"

export interface SendPhoneVerificationRequest {
  phoneNumber: string
}

export interface SendPhoneVerificationResponse {
  verificationSid: string
  status: string
  phoneNumber: string
}

export interface VerifyPhoneCodeRequest {
  phoneNumber: string
  code: string
  updateUser?: boolean  // If true, update user immediately (for first-time verification). If false/undefined, don't update (for settings page changes).
}

export interface VerifyPhoneCodeResponse {
  verified: boolean
  status: string
  phoneNumber: string
}

export interface PhoneVerificationStatus {
  phoneVerified: boolean
  phoneVerifiedAt: string | null
  phoneNumber: string | null
}

/**
 * Send phone verification code
 */
export async function sendPhoneVerificationCode(
  data: SendPhoneVerificationRequest
): Promise<ApiResponse<SendPhoneVerificationResponse>> {
  const response = await apiCaller.post<SendPhoneVerificationResponse>(
    "/users/me/phone/send-verification",
    data,
    {
      requireAuth: true,
    }
  )
  return response
}

/**
 * Verify phone code
 */
export async function verifyPhoneCode(
  data: VerifyPhoneCodeRequest
): Promise<ApiResponse<VerifyPhoneCodeResponse>> {
  const response = await apiCaller.post<VerifyPhoneCodeResponse>(
    "/users/me/phone/verify",
    data,
    {
      requireAuth: true,
    }
  )
  return response
}

/**
 * Get phone verification status
 */
export async function getPhoneVerificationStatus(): Promise<ApiResponse<PhoneVerificationStatus>> {
  const response = await apiCaller.get<PhoneVerificationStatus>(
    "/users/me/phone/verification-status",
    {
      requireAuth: true,
    }
  )
  return response
}



