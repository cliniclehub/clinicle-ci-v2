import {
  ACCESS_TOKEN_COOKIE,
  accessTokenNeedsRefresh,
  REFRESH_TOKEN_COOKIE,
} from "@/lib/utils/auth-cookie-policy"
import {
  isProtectedMiddlewareRoute,
  isPublicMiddlewareRoute,
  userHasMiddlewareRouteAccess,
} from "@/lib/utils/middleware-route-policy"
import { getPermissionLandingPage } from "@/lib/types/permission-schema"
import { TokenData } from "@/lib/types/auth-schema"
import { callRefreshApi } from "@/lib/utils/refresh-token-api"
import { jwtVerify, type JWTPayload } from "jose"
import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_PUBLIC_OR_SECRET!)

type GetValidTokenResult = {
  token: string | null
  payload: TokenData | null
  cookiesToSet?: { accessToken: string; refreshToken: string; expiresIn: number; refreshExpiresIn: number }
  /** When refresh proves the refresh token is invalid — strip cookies on the response */
  clearAuthCookies?: boolean
}

// Helper function to get valid token from request cookies directly.
// Attempts refresh when access token is missing or expired and refresh token exists.
// NOTE: Middleware must use request.cookies, NOT cookies() from next/headers.
async function getValidToken(request: NextRequest): Promise<GetValidTokenResult> {
  try {
    const accessToken = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value
    const refreshTokenValue = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value

    // If no access token but we have a refresh token, try to refresh
    if (!accessToken && refreshTokenValue) {
      const refreshResult = await callRefreshApi(refreshTokenValue)
      if (refreshResult.ok) {
        const { payload } = await jwtVerify<JWTPayload & TokenData>(refreshResult.accessToken, JWT_SECRET)
        return {
          token: refreshResult.accessToken,
          payload: payload as TokenData,
          cookiesToSet: {
            accessToken: refreshResult.accessToken,
            refreshToken: refreshTokenValue,
            expiresIn: refreshResult.expiresIn,
            refreshExpiresIn: refreshResult.refreshExpiresIn,
          },
        }
      }
      return {
        token: null,
        payload: null,
        clearAuthCookies: refreshResult.clearAuthCookies,
      }
    }

    if (!accessToken) {
      return { token: null, payload: null }
    }

    // Verify JWT (covers expired token). Also refresh when within skew so cookies
    // are rewritten on navigation — getAccessToken may not be allowed to set cookies in RSC.
    try {
      const { payload } = await jwtVerify<JWTPayload & TokenData>(accessToken, JWT_SECRET)
      const tokenPayload = payload as TokenData
      if (accessTokenNeedsRefresh(tokenPayload.exp) && refreshTokenValue) {
        const refreshResult = await callRefreshApi(refreshTokenValue)
        if (refreshResult.ok) {
          const refreshed = await jwtVerify<JWTPayload & TokenData>(
            refreshResult.accessToken,
            JWT_SECRET
          )
          return {
            token: refreshResult.accessToken,
            payload: refreshed.payload as TokenData,
            cookiesToSet: {
              accessToken: refreshResult.accessToken,
              refreshToken: refreshTokenValue,
              expiresIn: refreshResult.expiresIn,
              refreshExpiresIn: refreshResult.refreshExpiresIn,
            },
          }
        }
        if (refreshResult.clearAuthCookies) {
          return { token: null, payload: null, clearAuthCookies: true }
        }
        // Keep the still-valid access token if proactive refresh fails transiently.
      }
      return { token: accessToken, payload: tokenPayload }
    } catch {
      // Access token invalid/expired - try refresh if we have refresh token
      if (refreshTokenValue) {
        const refreshResult = await callRefreshApi(refreshTokenValue)
        if (refreshResult.ok) {
          const { payload } = await jwtVerify<JWTPayload & TokenData>(refreshResult.accessToken, JWT_SECRET)
          return {
            token: refreshResult.accessToken,
            payload: payload as TokenData,
            cookiesToSet: {
              accessToken: refreshResult.accessToken,
              refreshToken: refreshTokenValue,
              expiresIn: refreshResult.expiresIn,
              refreshExpiresIn: refreshResult.refreshExpiresIn,
            },
          }
        }
        return {
          token: null,
          payload: null,
          clearAuthCookies: refreshResult.clearAuthCookies,
        }
      }
      return { token: null, payload: null }
    }
  } catch {
    return { token: null, payload: null }
  }
}

function applyAuthCookies(
  response: NextResponse,
  cookiesToSet: { accessToken: string; refreshToken: string; expiresIn: number; refreshExpiresIn: number }
) {
  const isSecure = process.env.ENVIRONMENT !== "local"
  const opts = { httpOnly: true, secure: isSecure, sameSite: "lax" as const, path: "/" }
  response.cookies.set(ACCESS_TOKEN_COOKIE, cookiesToSet.accessToken, { ...opts, maxAge: cookiesToSet.expiresIn })
  response.cookies.set(REFRESH_TOKEN_COOKIE, cookiesToSet.refreshToken, { ...opts, maxAge: cookiesToSet.refreshExpiresIn })
}

export default async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl

  // IMPORTANT: Do not access request.body, request.json(), or request.formData() in middleware
  // This would trigger body parsing and hit the 10MB limit. Middleware only needs headers/cookies.
  // The request body will be available to server actions/API routes after middleware runs.

  const { payload, cookiesToSet, clearAuthCookies } = await getValidToken(request)

  const withCookies = (res: NextResponse) => {
    if (cookiesToSet) applyAuthCookies(res, cookiesToSet)
    if (clearAuthCookies) {
      res.cookies.delete(ACCESS_TOKEN_COOKIE)
      res.cookies.delete(REFRESH_TOKEN_COOKIE)
    }
    return res
  }

  // Create response; cookie refresh is applied via withCookies below.
  const response = NextResponse.next()

  // Check if user is authenticated and trying to access login/register
  // This needs to happen BEFORE checking public/protected routes
  if (payload && (pathname === "/login" || pathname === "/register")) {
    const returnUrl = request.nextUrl.searchParams.get("returnUrl")
    if (returnUrl && returnUrl.startsWith("/")) {
      const [path, query] = returnUrl.includes("?") ? returnUrl.split("?", 2) : [returnUrl, ""]
      const url = request.nextUrl.clone()
      url.pathname = path
      url.search = query ? `?${query}` : ""
      return withCookies(NextResponse.redirect(url))
    }

    const roles = payload.roles || []
    const permissions =
      payload.permissions ||
      (payload as TokenData & { permissions?: string[] }).permissions ||
      []

    const redirectPath = getPermissionLandingPage(permissions)

    const url = request.nextUrl.clone()
    url.pathname = redirectPath
    return withCookies(NextResponse.redirect(url))
  }

  // skip public prefixes
  const isPublic = isPublicMiddlewareRoute(pathname)

  // only guard when hitting protected areas (but exclude public routes)
  const needsAuth = isProtectedMiddlewareRoute(pathname) && !isPublic

  // Early return for public routes that don't need auth
  if (isPublic && !payload) {
    return withCookies(response)
  }

  // For public routes, allow both authenticated and unauthenticated users
  if (isPublic) {
    return withCookies(response)
  }

  // not public and needs auth but no valid token -> login
  if (needsAuth && !payload) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    url.searchParams.set("returnUrl", pathname + search)
    return withCookies(NextResponse.redirect(url))
  }

  // permission/role-based gating (see middleware-route-policy.ts)
  if (payload) {
    const roles = payload.roles ?? []
    const permissions = payload.permissions ?? []
    const ok = userHasMiddlewareRouteAccess(pathname, roles, permissions)
    if (!ok) {
      const url = request.nextUrl.clone()
      url.pathname = "/unauthorized"
      url.searchParams.set("requested", pathname)
      url.searchParams.set("role", roles.join(","))
      return withCookies(NextResponse.redirect(url))
    }
  }

  // forward org context as request headers (so server components / API can read them)
  if (payload?.orgId || payload?.orgDomain) {
    response.headers.set("X-Organization-Id", String(payload.orgId))
    response.headers.set("X-Organization-Domain", String(payload.orgDomain))
  }

  // Legacy bookmark alias: keep /notfications working after the route rename
  if (pathname === "/notfications" || pathname.startsWith("/notfications/")) {
    const url = request.nextUrl.clone()
    url.pathname = pathname.replace(/^\/notfications/, "/notifications")
    const rewritten = NextResponse.rewrite(url)
    if (payload?.orgId || payload?.orgDomain) {
      rewritten.headers.set("X-Organization-Id", String(payload.orgId))
      rewritten.headers.set("X-Organization-Domain", String(payload.orgDomain))
    }
    return withCookies(rewritten)
  }

  return withCookies(response)
}

export const config = {
  // exclude API and static assets; middleware runs for everything else
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
}
