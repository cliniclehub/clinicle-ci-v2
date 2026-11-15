"use server"

import { TokenData } from "@/lib/types/auth-schema"
import {
  ACCESS_TOKEN_COOKIE,
  accessTokenNeedsRefresh,
  isCookieMutationContextError,
  REFRESH_TOKEN_COOKIE,
} from "@/lib/utils/auth-cookie-policy"
import { jwtVerify, type JWTPayload } from "jose"
import { cookies } from "next/headers"

import { createServerLogger } from "@/lib/utils/logger-server"
import { effectiveRoleKeys } from "@/lib/utils/role-implications"
import { callRefreshApi } from "./refresh-token-api"

const logger = createServerLogger("AuthServerHelper")

// env: public key (RS256) or shared secret (HS256)
const JWT_SECRET = new TextEncoder().encode(process.env.JWT_PUBLIC_OR_SECRET!)

//--------------------------------
// Set auth cookies (for use after login / Route Handler / Server Action)
//--------------------------------
export async function setAuthCookies(
  accessToken: string,
  refreshToken: string,
  expiresIn: number,
  refreshExpiresIn: number
) {
  const cookieStore = await cookies()
  const isSecure = process.env.ENVIRONMENT !== "local"

  cookieStore.set(ACCESS_TOKEN_COOKIE, accessToken, {
    httpOnly: true,
    secure: isSecure,
    sameSite: "lax",
    maxAge: expiresIn,
    path: "/",
  })

  cookieStore.set(REFRESH_TOKEN_COOKIE, refreshToken, {
    httpOnly: true,
    secure: isSecure,
    sameSite: "lax",
    maxAge: refreshExpiresIn,
    path: "/",
  })
}

/**
 * Persist cookies when the caller is allowed to mutate them.
 * During RSC / layout render, Next.js forbids cookies().set — return false and
 * keep using the refreshed token for this request; middleware persists on the
 * next navigation.
 */
export async function trySetAuthCookies(
  accessToken: string,
  refreshToken: string,
  expiresIn: number,
  refreshExpiresIn: number
): Promise<boolean> {
  try {
    await setAuthCookies(accessToken, refreshToken, expiresIn, refreshExpiresIn)
    return true
  } catch (error) {
    if (isCookieMutationContextError(error)) {
      logger.forMethod("trySetAuthCookies").info(
        "Deferred auth cookie write; not a Server Action/Route Handler context"
      )
      return false
    }
    throw error
  }
}

//--------------------------------
// Clear auth cookies (for use after logout)
//--------------------------------
export async function clearAuthCookies() {
  const cookieStore = await cookies()
  cookieStore.delete(ACCESS_TOKEN_COOKIE)
  cookieStore.delete(REFRESH_TOKEN_COOKIE)
}

/** Best-effort clear; no-ops when cookie mutation is illegal in this context. */
export async function tryClearAuthCookies(): Promise<boolean> {
  try {
    await clearAuthCookies()
    return true
  } catch (error) {
    if (isCookieMutationContextError(error)) {
      logger.forMethod("tryClearAuthCookies").info(
        "Deferred auth cookie clear; not a Server Action/Route Handler context"
      )
      return false
    }
    throw error
  }
}

//--------------------------------
// Get Auth refresh token from cookies
//--------------------------------
export async function getRefreshToken(): Promise<string | null> {
  const cookieStore = await cookies()
  return cookieStore.get(REFRESH_TOKEN_COOKIE)?.value || null
}

//--------------------------------
// Attempts to get a valid access token from cookies.
// If the token is expired or expiring soon, tries to refresh it using the refresh token.
// Cookie persistence is best-effort here; middleware is the durable writer on navigation.
//--------------------------------
export async function getAccessToken(): Promise<string | null> {
  const methodLogger = logger.forMethod("getAccessToken")
  try {
    const cookieStore = await cookies()
    const accessTokenValue = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value
    const refreshTokenValue = cookieStore.get(REFRESH_TOKEN_COOKIE)?.value

    methodLogger.debug("Token cookies present", {
      hasAccessToken: Boolean(accessTokenValue),
      hasRefreshToken: Boolean(refreshTokenValue),
    })

    if (!accessTokenValue && refreshTokenValue) {
      try {
        methodLogger.debug("No access token, attempting refresh")
        const refreshResult = await callRefreshApi(refreshTokenValue)
        if (refreshResult.ok) {
          methodLogger.debug("Refresh successful")
          await trySetAuthCookies(
            refreshResult.accessToken,
            refreshTokenValue,
            refreshResult.expiresIn,
            refreshResult.refreshExpiresIn
          )
          return refreshResult.accessToken
        }
        if (refreshResult.clearAuthCookies) {
          await tryClearAuthCookies()
        }
      } catch (refreshError) {
        methodLogger.warn("Refresh failed", {
          error: refreshError instanceof Error ? refreshError.message : String(refreshError),
        })
        return null
      }
    }

    if (!accessTokenValue) {
      return null
    }

    const tokenData = await _verifyJWT(accessTokenValue)
    if (!tokenData) {
      return null
    }

    if (accessTokenNeedsRefresh(tokenData.exp) && refreshTokenValue) {
      try {
        methodLogger.debug("Access token expiring soon, attempting refresh")
        const refreshResult = await callRefreshApi(refreshTokenValue)
        if (refreshResult.ok) {
          methodLogger.debug("Refresh successful")
          await trySetAuthCookies(
            refreshResult.accessToken,
            refreshTokenValue,
            refreshResult.expiresIn,
            refreshResult.refreshExpiresIn
          )
          return refreshResult.accessToken
        }
        if (refreshResult.clearAuthCookies) {
          await tryClearAuthCookies()
          return null
        }
        // Match middleware: keep the still-valid access token if proactive refresh fails transiently.
        methodLogger.warn("Proactive refresh failed; using current access token")
        return accessTokenValue
      } catch (refreshError) {
        methodLogger.warn("Refresh failed; using current access token", {
          error: refreshError instanceof Error ? refreshError.message : String(refreshError),
        })
        return accessTokenValue
      }
    }

    return accessTokenValue
  } catch (error) {
    methodLogger.error("Error getting access token", error as Error)
    return null
  }
}

//--------------------------------
// Parse and return Auth token data
//--------------------------------
export async function getAuthTokenData(): Promise<TokenData | null> {
  try {
    const token = await getAccessToken()
    if (!token) return null

    return await _verifyJWT(token)
  } catch (error) {
    logger.forMethod("getAuthTokenData").error("Error parsing auth token", error as Error)
    return null
  }
}

//--------------------------------
// Check if user has a specific role
//--------------------------------
export async function userHasRole(role: string): Promise<boolean> {
  const tokenData = await getAuthTokenData()
  return effectiveRoleKeys(tokenData?.roles).includes(role)
}

//--------------------------------
// Check if user has any of the specified roles
//--------------------------------
export async function userHasAnyRole(roles: string[]): Promise<boolean> {
  const tokenData = await getAuthTokenData()
  const effective = effectiveRoleKeys(tokenData?.roles)
  return roles.some((role) => effective.includes(role))
}

//--------------------------------
// Check if user has all of the specified roles
//--------------------------------
export async function hasAuthAllRoles(roles: string[]): Promise<boolean> {
  try {
    const tokenData = await getAuthTokenData()
    if (!tokenData?.roles) return false

    return roles.every((role) => tokenData.roles.includes(role))
  } catch (error) {
    logger.forMethod("hasAuthAllRoles").error("Error checking roles", error as Error)
    return false
  }
}

//--------------------------------
// Get user roles from auth token
//--------------------------------
export async function getAuthUserRoles(): Promise<string[]> {
  const tokenData = await getAuthTokenData()
  return tokenData?.roles || []
}

export async function getAuthUserPermissions(): Promise<string[]> {
  const tokenData = await getAuthTokenData()
  return tokenData?.permissions || []
}

export async function userHasPermission(permission: string): Promise<boolean> {
  const permissions = await getAuthUserPermissions()
  return permissions.includes(permission)
}

export async function userHasAnyPermission(permissions: string[]): Promise<boolean> {
  const held = await getAuthUserPermissions()
  return permissions.some((permission) => held.includes(permission))
}

async function _verifyJWT(token: string): Promise<TokenData | null> {
  try {
    const { payload } = await jwtVerify<JWTPayload & TokenData>(token, JWT_SECRET)
    return payload as TokenData
  } catch (error) {
    logger.forMethod("_verifyJWT").debug("JWT verify failed", {
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}
