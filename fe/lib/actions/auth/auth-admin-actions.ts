'use server'

import { ApiResponse } from "@/lib/types/api-response-schema"
import {
    LoginStatistics,
    UserLoginHistoryResponse,
    UserSessionsResponse
} from "@/lib/types/auth-schema"
import { ORG_USERS_WRITE, PLATFORM_USERS_WRITE } from "@/lib/types/permission-schema"
import { apiCaller } from "@/lib/utils/api-caller-helper"
import { createServerLogger } from "@/lib/utils/logger-server"

const logger = createServerLogger('AuthAdminActions')

// Get user's active sessions (admin only)
export async function getUserSessions(userId: string): Promise<ApiResponse<UserSessionsResponse>> {
  const methodLogger = logger.forMethod('getUserSessions')
  
  try {
    const response = await apiCaller.get<UserSessionsResponse>(`/auth/admin/sessions/${userId}`, { 
      requireAuth: true,
      requirePermission: [ORG_USERS_WRITE, PLATFORM_USERS_WRITE],
      cache: "no-store",
    })
    
    if (response.status === 'success' && response.data) {
      methodLogger.info('User sessions retrieved successfully', { 
        userId, 
        total: response.data.total 
      })
    }
    return response
  } catch (error: any) {
    methodLogger.error('Failed to get user sessions', error, { userId })
    throw error
  }
}

// Revoke a specific session for a user (admin only)
export async function revokeUserSession(sessionId: string, userId: string): Promise<ApiResponse<void>> {
  const methodLogger = logger.forMethod('revokeUserSession')
  
  try {
    const response = await apiCaller.delete<void>(`/auth/admin/sessions/${sessionId}/${userId}`, { 
      requireAuth: true,
      requirePermission: [ORG_USERS_WRITE, PLATFORM_USERS_WRITE]
    })
    
    methodLogger.info('User session revoked successfully', { sessionId, userId })
    return response
  } catch (error: any) {
    methodLogger.error('Failed to revoke user session', error, { sessionId, userId })
    throw error
  }
}

// Get user's login history (admin only)
export async function getUserLoginHistory(
  userId: string,
  days: number = 30,
  includeFailed: boolean = false
): Promise<ApiResponse<UserLoginHistoryResponse>> {
  const methodLogger = logger.forMethod('getUserLoginHistory')
  
  try {
    const params = new URLSearchParams({
      days: days.toString(),
      include_failed: includeFailed.toString()
    })
    
    const response = await apiCaller.get<UserLoginHistoryResponse>(
      `/auth/admin/login-history/${userId}?${params.toString()}`, 
      {
        requireAuth: true,
        requirePermission: [ORG_USERS_WRITE, PLATFORM_USERS_WRITE],
        cache: "no-store",
      }
    )
    
    if (response.status === 'success' && response.data) {
      methodLogger.info('User login history retrieved successfully', { 
        userId, 
        days, 
        includeFailed, 
        total: response.data.total 
      })
    }
    return response
  } catch (error: any) {
    methodLogger.error('Failed to get user login history', error, { userId, days, includeFailed })
    throw error
  }
}

// Get user's login statistics (admin only)
export async function getUserLoginStatistics(
  userId: string,
  days: number = 30
): Promise<ApiResponse<LoginStatistics>> {
  const methodLogger = logger.forMethod('getUserLoginStatistics')
  
  try {
    const params = new URLSearchParams({
      days: days.toString()
    })
    
    const response = await apiCaller.get<LoginStatistics>(
      `/auth/admin/login-statistics/${userId}?${params.toString()}`, 
      {
        requireAuth: true,
        requirePermission: [ORG_USERS_WRITE, PLATFORM_USERS_WRITE],
        cache: "no-store",
      }
    )
    
    if (response.status === 'success' && response.data) {
      methodLogger.info('User login statistics retrieved successfully', { 
        userId, 
        days, 
        successRate: response.data.successRate 
      })
    }
    return response
  } catch (error: any) {
    methodLogger.error('Failed to get user login statistics', error, { userId, days })
    throw error
  }
}
