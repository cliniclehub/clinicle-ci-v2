'use client'

import type { UserTokenInfo } from '@/lib/types/auth-schema'
import { createClientLogger } from '@/lib/utils/logger-client'
import { isNextRedirectError } from '@/lib/utils/next-redirect-error'
import { withReturnUrl } from '@/lib/utils/return-url-helper'
import React, { createContext, useContext, useEffect, useState } from 'react'

const logger = createClientLogger('AuthContext')

interface AuthContextValue {
  user: UserTokenInfo | null
  isAuthenticated: boolean
  isLoading: boolean
  setUser: (user: UserTokenInfo | null) => void
  setIsLoading: (loading: boolean) => void
  refreshUser: () => Promise<void>
}


const AuthContext = createContext<AuthContextValue | undefined>(undefined)

//--------------------------------
// AuthProvider - Initialize from JWT Token
//--------------------------------
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserTokenInfo | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const isAuthenticated = !!user

  const refreshUser = React.useCallback(async () => {
    const methodLogger = createClientLogger('AuthContext', 'refreshUser')
    try {
      const { loadCurrentUser } = await import('@/lib/actions/auth/auth-public-actions')
      const result = await loadCurrentUser()

      if (result.success && result.user) {
        setUser(result.user)
      } else if (!result.success) {
        setUser(null)
        if (result.revoked) {
          methodLogger.info('Session revoked, clearing tokens and redirecting to login')
          try {
            const { tryClearAuthCookies } = await import('@/lib/utils/auth-server-helper')
            await tryClearAuthCookies()
          } catch (error) {
            methodLogger.error('Failed to clear cookies', error as Error)
          }
          const path = typeof window !== 'undefined' ? window.location.pathname : ''
          const onAuthPage =
            path === '/login' ||
            path === '/register' ||
            path === '/contact' ||
            path.startsWith('/verify-email') ||
            path.startsWith('/forgot-password') ||
            path.startsWith('/reset-password')
          if (!onAuthPage) {
            const search =
              typeof window !== 'undefined' ? window.location.search : ''
            const returnPath = `${path}${search}`
            setTimeout(() => {
              window.location.href = withReturnUrl('/login', returnPath)
            }, 100)
          }
        }
      } else {
        setUser(null)
      }
    } catch (error) {
      if (isNextRedirectError(error)) {
        return
      }
      methodLogger.error('Failed to refresh user', error as Error)
      setUser(null)
    }
  }, [])

  // Initialize user data on mount
  useEffect(() => {
    const initializeUser = async () => {
      const methodLogger = createClientLogger('AuthContext', 'initializeUser')
      methodLogger.debug('Starting user initialization...')
      setIsLoading(true)

      try {
        // Since auth cookies are httpOnly, we can't check them from client-side JavaScript
        // We should always try to load the user and let the server check the cookies
        methodLogger.debug('Attempting to load user data...')

        // Load full user data (includes firstName, lastName, etc.)
        const { loadCurrentUser } = await import('@/lib/actions/auth/auth-public-actions')
        const result = await loadCurrentUser()
        methodLogger.debug('loadCurrentUser result', result)

        if (result.success && result.user) {
          methodLogger.info('User loaded successfully', {
            email: result.user.email,
            firstName: result.user.firstName,
            lastName: result.user.lastName
          })
          setUser(result.user)
        } else if (!result.success) {
          methodLogger.warn('Failed to load user', { error: result.error })
          setUser(null)

          // If session was revoked, clear tokens and redirect to login
          if (result.revoked) {
            methodLogger.info('Session revoked, clearing tokens and redirecting to login')
            try {
              const { tryClearAuthCookies } = await import('@/lib/utils/auth-server-helper')
              await tryClearAuthCookies()
            } catch (error) {
              methodLogger.error('Failed to clear cookies', error as Error)
            }
            const path = typeof window !== 'undefined' ? window.location.pathname : ''
            const onAuthPage =
              path === '/login' ||
              path === '/register' ||
              path === '/contact' ||
              path.startsWith('/verify-email') ||
              path.startsWith('/forgot-password') ||
              path.startsWith('/reset-password')
            if (!onAuthPage) {
              const search =
                typeof window !== 'undefined' ? window.location.search : ''
              const returnPath = `${path}${search}`
              setTimeout(() => {
                window.location.href = withReturnUrl('/login', returnPath)
              }, 100)
            }
          }
        } else {
          setUser(null)
        }
      } catch (error) {
        if (isNextRedirectError(error)) {
          return
        }
        // Token invalid or expired, let middleware handle redirect
        methodLogger.error('Failed to initialize user', error as Error)
        setUser(null)
      } finally {
        methodLogger.debug('Setting isLoading to false')
        setIsLoading(false)
      }
    }

    initializeUser()
  }, [])

  const value: AuthContextValue = {
    user,
    isAuthenticated,
    isLoading,
    setUser,
    setIsLoading,
    refreshUser,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

//--------------------------------
// Use Auth Hook
//--------------------------------
export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
