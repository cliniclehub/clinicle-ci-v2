import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { jwtVerify } from 'jose'

const HANDOFF_SECRET = new TextEncoder().encode(
  process.env.JWT_PUBLIC_OR_SECRET || process.env.AUTH2_SECRET_KEY || ''
)

/** Public origin for redirects — do not use request.url (often internal host:port behind proxies). */
function getPublicOrigin(request: NextRequest): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_ORIGIN?.trim()
  if (fromEnv) {
    return fromEnv.replace(/\/+$/, '')
  }
  const proto = request.headers.get('x-forwarded-proto') || 'https'
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || ''
  if (!host.trim()) {
    return request.nextUrl.origin.replace(/\/+$/, '')
  }
  return `${proto}://${host}`.replace(/\/+$/, '')
}

function redirectToPath(request: NextRequest, pathWithQuery: string): NextResponse {
  const origin = getPublicOrigin(request)
  const path = pathWithQuery.startsWith('/') ? pathWithQuery : `/${pathWithQuery}`
  return NextResponse.redirect(`${origin}${path}`)
}

/**
 * Runs on the TENANT domain (e.g. org.localhost or a custom hostname).
 *
 * The Google OAuth callback (which runs on the single callback domain)
 * redirects here with a short-lived signed JWT containing the auth tokens.
 * This route verifies the JWT, sets httpOnly cookies on the tenant domain,
 * and redirects the user to the login page for post-login orchestration.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const handoffToken = searchParams.get('token')
  const returnUrl = searchParams.get('returnUrl') || ''

  if (!handoffToken) {
    return redirectToPath(request, '/login?error=missing_token')
  }

  try {
    // Verify + decode the handoff JWT (60s expiry)
    const { payload } = await jwtVerify(handoffToken, HANDOFF_SECRET)

    const accessToken = payload.accessToken as string
    const refreshToken = payload.refreshToken as string
    const expiresIn = payload.expiresIn as number
    const refreshExpiresIn = payload.refreshExpiresIn as number

    if (!accessToken || !refreshToken) {
      return redirectToPath(request, '/login?error=invalid_token')
    }

    // Set auth cookies on this tenant domain
    const cookieStore = await cookies()
    const isSecure = process.env.ENVIRONMENT !== 'local'
    const cookieOpts = { httpOnly: true, secure: isSecure, sameSite: 'lax' as const, path: '/' }

    cookieStore.set('auth2_access_token', accessToken, {
      ...cookieOpts,
      maxAge: expiresIn,
    })
    cookieStore.set('auth2_refresh_token', refreshToken, {
      ...cookieOpts,
      maxAge: refreshExpiresIn,
    })

    // Redirect to login page which handles post-login orchestration
    const redirectPath = returnUrl
      ? `/login?oauth=success&returnUrl=${encodeURIComponent(returnUrl)}`
      : '/login?oauth=success'

    return redirectToPath(request, redirectPath)
  } catch (err) {
    console.error('[OAuth Complete] Handoff token verification failed:', err)
    return redirectToPath(request, '/login?error=oauth_expired')
  }
}
