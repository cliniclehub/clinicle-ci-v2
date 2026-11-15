'use server'

import { ApiResponse } from '@/lib/types/api-response-schema'
import { EmailVerificationRequest, ForgotPasswordRequest, LoginRequest, LoginResponse, RegisterRequest, ResetPasswordRequest, TokenResponse, UserTokenInfo } from '@/lib/types/auth-schema'
import { apiCaller } from '@/lib/utils/api-caller-helper'
import { shouldForceReloginAfter401 } from '@/lib/utils/auth-invalid-session'
import { clearAuthCookies, getRefreshToken, setAuthCookies } from '@/lib/utils/auth-server-helper'
import { createServerLogger } from '@/lib/utils/logger-server'
import { isNextRedirectError } from '@/lib/utils/next-redirect-error'

const logger = createServerLogger('AuthsActions')

//--------------------------------
//login user
//--------------------------------
export async function loginUser(data: LoginRequest & { deviceInfo?: any }): Promise<
  | { success: true; tokens: TokenResponse; user: UserTokenInfo }
  | { success: false; error: string; lockedUntil?: string }
> {
  const methodLogger = logger.forMethod('loginUser')
  
  try {
    methodLogger.info('User login attempt')
    
    const response = await apiCaller.post<LoginResponse>('/auth/login', data, {
      requireAuth: false,
      // Inherit LOG_HTTP_* (off on Render; on locally with redaction)
    })
    
    if (response.status === 'error') {
      const d = response.details as Record<string, unknown> | undefined
      const lockedUntilRaw = d?.lockedUntil ?? d?.locked_until
      const lockedUntil =
        typeof lockedUntilRaw === 'string' && lockedUntilRaw.length > 0 ? lockedUntilRaw : undefined
      return {
        success: false,
        error: response.message || 'Login request failed',
        ...(lockedUntil ? { lockedUntil } : {}),
      }
    }
    
    // Check if response has the expected structure
    if (!response.data || !response.data.tokens || !response.data.user) {
      methodLogger.error('Invalid response structure', new Error('missing tokens or user'))
      return {
        success: false,
        error: 'Invalid response from authentication server'
      }
    }
    
    // Store tokens in cookies (server-side)
    await setAuthCookies(
      response.data.tokens.accessToken,
      response.data.tokens.refreshToken,
      response.data.tokens.expiresIn,
      response.data.tokens.refreshExpiresIn
    )
    
    // Return the correct structure that auth context expects
    return {
      success: true,
      tokens: response.data.tokens,
      user: response.data.user
    }
  } catch (error: any) {
    if (isNextRedirectError(error)) {
      throw error
    }
    methodLogger.error('Login failed', error)
    // Only catch unexpected errors (network issues, server errors, etc.)
    return {
      success: false,
      error: error.message || 'An unexpected error occurred'
    }
  }
}
//--------------------------------    
//logout user
//--------------------------------
export async function logoutUser(): Promise<{ success: true } | { success: false; error: string }> {
  const methodLogger = logger.forMethod('logoutUser')
  
  try {
    const refreshToken = await getRefreshToken()
    
    if (refreshToken) {
      await apiCaller.post(
        '/auth/logout',
        { refreshToken },
        { requireAuth: false, logRequest: false, logResponse: false }
      )
    }
    
    // Clear cookies
    await clearAuthCookies()
    
    return { success: true }
  } catch (error: any) {
    methodLogger.error('Logout failed', error)
    // Still clear cookies even if API call fails
    const { clearAuthCookies } = await import('@/lib/utils/auth-server-helper')
    await clearAuthCookies()
    return { success: false, error: error.message || 'Logout failed' }
  }
}

//--------------------------------
// Load current user - Enhanced with proper error handling
//--------------------------------
export async function loadCurrentUser(): Promise<{ success: true; user: UserTokenInfo } | { success: false; error: string; revoked?: boolean }> {
  const methodLogger = logger.forMethod('loadCurrentUser')
  
  try {
    // apiAuth2Helper will automatically handle the auth token from cookies
    const response = await apiCaller.get<UserTokenInfo>('/auth/me', {
      requireAuth: true
    })
    
    if (response.status === 'error') {
      const mustRelogin =
        response.code === 401 &&
        shouldForceReloginAfter401(response.message, response.description)

      if (mustRelogin) {
        methodLogger.warn('Session invalid or revoked, clearing tokens', {
          message: response.message,
        })
        // Clear tokens immediately when session is revoked
        try {
          const { tryClearAuthCookies } = await import('@/lib/utils/auth-server-helper')
          await tryClearAuthCookies()
        } catch (clearError) {
          methodLogger.error('Failed to clear cookies after revoked session', clearError as Error)
        }
        return { 
          success: false, 
          error: response.message || 'Session has been revoked', 
          revoked: true 
        }
      }
      
      return { success: false, error: response.message || 'Failed to get user info' }
    }
    
    // No transformation needed - backend now returns unified UserTokenInfo
    return { success: true, user: response.data }
  } catch (error: any) {
    if (isNextRedirectError(error)) {
      throw error
    }
    methodLogger.error('Load current user failed', error)
    return { success: false, error: error.message || 'Failed to load user' }
  }
}

//--------------------------------
// Get current user - Legacy function for backward compatibility
//--------------------------------
export async function getCurrentUser(): Promise<UserTokenInfo> {
  const result = await loadCurrentUser()
  if (!result.success) {
    throw new Error(result.error)
  }
  return result.user
}


//--------------------------------
// Registration & Email Verification Actions
//--------------------------------
export async function registerUser(data: RegisterRequest): Promise<ApiResponse<{ userId: string; email: string; requiresVerification: boolean }>> {
  const response = await apiCaller.post<{ userId: string; email: string; requiresVerification: boolean }>(
    '/auth/register', 
    data, 
    {
      requireAuth: false
    }
  )
  
  return response
}

//--------------------------------
// Verify email
//--------------------------------
export async function verifyEmail(data: EmailVerificationRequest): Promise<ApiResponse<{ verified: boolean }>> {
  const response = await apiCaller.post<{ verified: boolean }>(
    '/auth/verify-email', 
    data, 
    {
      requireAuth: false
    }
  )
  
  return response
}

//--------------------------------
// Resend verification code
//--------------------------------  
export async function resendVerificationCode(email: string, orgDomain: string): Promise<ApiResponse<{ sent: boolean }>> {
  const response = await apiCaller.post<{ sent: boolean }>(
    '/auth/resend-verification', 
    {
      email,
      orgDomain
    }, 
    {
      requireAuth: false
    }
  )
  
  return response
}

//--------------------------------
// Password Management Actions
//--------------------------------
export async function forgotPassword(data: ForgotPasswordRequest): Promise<ApiResponse<{ sent: boolean }>> {
  const response = await apiCaller.post<{ sent: boolean }>(
    '/auth/forgot-password', 
    data, 
    {
      requireAuth: false
    }
  )
  
  return response
}

//--------------------------------
// Reset password
//--------------------------------
export async function resetPassword(data: ResetPasswordRequest) {
  const methodLogger = logger.forMethod('resetPassword')
  
  try {
    methodLogger.info('Password reset attempt')
    
    const response = await apiCaller.post<{ reset: boolean }>(
      '/auth/reset-password', 
      data, 
      {
        requireAuth: false
      }
    )
    
    if (response.status === 'error') {
      throw new Error(response.message || 'Password reset failed')
    }
    
    return response.data
  } catch (error: any) {
    methodLogger.error('Password reset failed', error)
    throw error
  }
}
