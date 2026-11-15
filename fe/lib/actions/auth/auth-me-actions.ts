'use server'

import { ApiResponse } from "@/lib/types/api-response-schema"
import {
  LoginStatistics,
  UserLoginHistoryResponse,
  UserSessionsResponse,
  UserTokenInfo
} from "@/lib/types/auth-schema"
import { apiCaller } from "@/lib/utils/api-caller-helper"
import { createServerLogger } from "@/lib/utils/logger-server"

const logger = createServerLogger('AuthMeActions')

// Get current user information
export async function getCurrentUser(): Promise<ApiResponse<UserTokenInfo>> {
  const methodLogger = logger.forMethod('getCurrentUser')
  
  try {
    const response = await apiCaller.get<UserTokenInfo>('/auth/me', { 
      requireAuth: true 
    })
    
    methodLogger.info('Current user retrieved successfully')
    return response
  } catch (error: any) {
    methodLogger.error('Failed to get current user', error)
    throw error
  }
}

// Get current user's active sessions
export async function getCurrentUserSessions(): Promise<ApiResponse<UserSessionsResponse>> {
  const methodLogger = logger.forMethod('getCurrentUserSessions')
  
  try {
    const response = await apiCaller.get<UserSessionsResponse>('/auth/me/sessions', { 
      requireAuth: true,
      cache: "no-store",
    })
    
    if (response.status === 'success' && response.data) {
      methodLogger.info('User sessions retrieved successfully', { 
        total: response.data.total 
      })
    }
    return response
  } catch (error: any) {
    methodLogger.error('Failed to get user sessions', error)
    throw error
  }
}

// Revoke a specific session for current user
export async function revokeCurrentUserSession(sessionId: string): Promise<ApiResponse<void>> {
  const methodLogger = logger.forMethod('revokeCurrentUserSession')
  
  try {
    const response = await apiCaller.delete<void>(`/auth/me/sessions/${sessionId}`, { 
      requireAuth: true 
    })
    
    methodLogger.info('Session revoked successfully', { sessionId })
    return response
  } catch (error: any) {
    methodLogger.error('Failed to revoke session', error, { sessionId })
    throw error
  }
}

// Get current user's login history
export async function getCurrentUserLoginHistory(
  days: number = 30,
  includeFailed: boolean = false
): Promise<ApiResponse<UserLoginHistoryResponse>> {
  const methodLogger = logger.forMethod('getCurrentUserLoginHistory')
  
  try {
    const params = new URLSearchParams({
      days: days.toString(),
      include_failed: includeFailed.toString()
    })
    
    const response = await apiCaller.get<UserLoginHistoryResponse>(
      `/auth/me/login-history?${params.toString()}`, 
      { requireAuth: true, cache: "no-store" }
    )
    
    if (response.status === 'success' && response.data) {
      methodLogger.info('Login history retrieved successfully', { 
        days, 
        includeFailed, 
        total: response.data.total 
      })
    }
    return response
  } catch (error: any) {
    methodLogger.error('Failed to get login history', error, { days, includeFailed })
    throw error
  }
}

// Get current user's login statistics
export async function getCurrentUserLoginStatistics(
  days: number = 30
): Promise<ApiResponse<LoginStatistics>> {
  const methodLogger = logger.forMethod('getCurrentUserLoginStatistics')
  
  try {
    const params = new URLSearchParams({
      days: days.toString()
    })
    
    const response = await apiCaller.get<LoginStatistics>(
      `/auth/me/login-statistics?${params.toString()}`, 
      { requireAuth: true, cache: "no-store" }
    )
    
    if (response.status === 'success' && response.data) {
      methodLogger.info('Login statistics retrieved successfully', { 
        days, 
        successRate: response.data.successRate 
      })
    }
    return response
  } catch (error: any) {
    methodLogger.error('Failed to get login statistics', error, { days })
    throw error
  }
}
