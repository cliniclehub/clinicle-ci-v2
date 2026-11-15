import { NextRequest, NextResponse } from "next/server"
import { SignJWT, jwtVerify } from "jose"

const GOOGLE_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || ""
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || ""
const BACKEND_API_URL =
  process.env.NEXT_PUBLIC_BACKEND_API_URL || "http://localhost:8000/api/v1"
const OAUTH_CALLBACK_BASE_URL = process.env.OAUTH_CALLBACK_BASE_URL || ""
/** Prefer public env — server-only `ENVIRONMENT` is often unset on Render, which incorrectly forced "local" rules. */
const APP_ENVIRONMENT = (
  process.env.NEXT_PUBLIC_ENVIRONMENT ||
  process.env.ENVIRONMENT ||
  "local"
).toLowerCase()

const HANDOFF_SECRET = new TextEncoder().encode(
  process.env.JWT_PUBLIC_OR_SECRET || process.env.AUTH2_SECRET_KEY || ""
)

type OAuthStatePayload = {
  tenantOrigin: string
  orgDomain: string
  returnUrl?: string
  codeVerifier: string
}

function normalizeOrigin(origin: string): string {
  return origin.replace(/\/+$/, "")
}

function getCallbackOrigin(): string {
  return normalizeOrigin(OAUTH_CALLBACK_BASE_URL)
}

function getRedirectUri(): string {
  return `${getCallbackOrigin()}/api/auth/oauth/google`
}

function getRequestOrigin(request: NextRequest): string {
  const proto = request.headers.get("x-forwarded-proto") || "https"
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || ""
  return normalizeOrigin(`${proto}://${host}`)
}

function generateRandomHex(bytes: number): string {
  const array = new Uint8Array(bytes)
  crypto.getRandomValues(array)
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("")
}

function generateCodeVerifier(): string {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

function isValidReturnUrl(value: string | null): value is string {
  return Boolean(value && value.startsWith("/"))
}

function isLocalTenantOriginMode(): boolean {
  return ["local", "development", "dev"].includes(APP_ENVIRONMENT)
}

/** Comma-separated in OAUTH_ALLOWED_TENANT_HOST_SUFFIXES, e.g. "client.edu,partner.org" (optional leading dot). */
function hostMatchesConfiguredSuffix(host: string, entry: string): boolean {
  const e = entry.replace(/^\./, "").toLowerCase().trim()
  if (!e) return false
  return host === e || host.endsWith(`.${e}`)
}

async function isKnownOrganizationDomain(host: string): Promise<boolean> {
  try {
    const response = await fetch(
      `${BACKEND_API_URL}/organizations/get-white-label-data-by-domain`,
      {
        method: "GET",
        headers: {
          "X-Organization-Domain": host,
        },
        cache: "no-store",
      }
    )
    return response.ok
  } catch {
    return false
  }
}

async function isAllowedTenantOrigin(origin: string): Promise<boolean> {
  try {
    const parsed = new URL(origin)
    const host = parsed.hostname.toLowerCase()
    if (isLocalTenantOriginMode()) {
      return host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")
    }
    const extra = (process.env.OAUTH_ALLOWED_TENANT_HOST_SUFFIXES || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
    if (extra.some((entry) => hostMatchesConfiguredSuffix(host, entry))) {
      return true
    }

    // Dynamic multi-tenant fallback: allow any host that maps to an active organization.
    return await isKnownOrganizationDomain(host)
  } catch {
    return false
  }
}

async function buildStateToken(payload: OAuthStatePayload): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("platform-fe-oauth")
    .setAudience("google-oauth")
    .setJti(generateRandomHex(16))
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(HANDOFF_SECRET)
}

async function verifyStateToken(token: string): Promise<OAuthStatePayload | null> {
  try {
    const { payload } = await jwtVerify(token, HANDOFF_SECRET, {
      issuer: "platform-fe-oauth",
      audience: "google-oauth",
    })
    const tenantOrigin = typeof payload.tenantOrigin === "string" ? payload.tenantOrigin : ""
    const orgDomain = typeof payload.orgDomain === "string" ? payload.orgDomain : ""
    const codeVerifier = typeof payload.codeVerifier === "string" ? payload.codeVerifier : ""
    const returnUrl = typeof payload.returnUrl === "string" ? payload.returnUrl : undefined

    if (!tenantOrigin || !orgDomain || !codeVerifier || !(await isAllowedTenantOrigin(tenantOrigin))) {
      return null
    }

    return { tenantOrigin, orgDomain, codeVerifier, returnUrl }
  } catch {
    return null
  }
}

function callbackErrorRedirect(message: string): NextResponse {
  const callbackOrigin = getCallbackOrigin()
  return NextResponse.redirect(`${callbackOrigin}/login?error=${encodeURIComponent(message)}`)
}

export async function GET(request: NextRequest) {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !OAUTH_CALLBACK_BASE_URL) {
    return callbackErrorRedirect("oauth_config_missing")
  }

  const { searchParams } = request.nextUrl
  const code = searchParams.get("code")
  const callbackOrigin = getCallbackOrigin()
  const requestOrigin = getRequestOrigin(request)

  if (!code) {
    const tenantOriginFromQuery = searchParams.get("tenantOrigin")
    const tenantOrigin = normalizeOrigin(tenantOriginFromQuery || requestOrigin)
    const orgDomainFromQuery = searchParams.get("orgDomain")
    const orgDomain =
      (orgDomainFromQuery && orgDomainFromQuery.trim()) ||
      (request.headers.get("host") || "").split(":")[0]
    const returnUrlRaw = searchParams.get("returnUrl")
    const returnUrl = isValidReturnUrl(returnUrlRaw) ? returnUrlRaw : undefined

    if (!(await isAllowedTenantOrigin(tenantOrigin))) {
      return callbackErrorRedirect("invalid_tenant_origin")
    }

    if (requestOrigin !== callbackOrigin) {
      const forwardParams = new URLSearchParams({
        tenantOrigin,
        orgDomain,
      })
      if (returnUrl) {
        forwardParams.set("returnUrl", returnUrl)
      }
      return NextResponse.redirect(`${callbackOrigin}/api/auth/oauth/google?${forwardParams.toString()}`)
    }

    const codeVerifier = generateCodeVerifier()
    const codeChallenge = await generateCodeChallenge(codeVerifier)
    const state = await buildStateToken({
      tenantOrigin,
      orgDomain,
      returnUrl,
      codeVerifier,
    })

    const googleParams = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: getRedirectUri(),
      response_type: "code",
      scope: "openid email profile",
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      access_type: "offline",
      prompt: "select_account",
    })
    return NextResponse.redirect(
      `https://accounts.google.com/o/oauth2/v2/auth?${googleParams.toString()}`
    )
  }

  const stateToken = searchParams.get("state")
  const errorParam = searchParams.get("error")

  if (errorParam && !stateToken) {
    return callbackErrorRedirect(errorParam)
  }
  if (!stateToken) {
    return callbackErrorRedirect("missing_state")
  }

  const state = await verifyStateToken(stateToken)
  if (!state) {
    return callbackErrorRedirect("invalid_state")
  }

  const errorRedirect = (msg: string) =>
    NextResponse.redirect(
      `${state.tenantOrigin}/login?error=${encodeURIComponent(msg)}`
    )

  if (errorParam) {
    return errorRedirect(errorParam)
  }

  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: getRedirectUri(),
        grant_type: "authorization_code",
        code_verifier: state.codeVerifier,
      }),
    })
    if (!tokenResponse.ok) {
      const err = await tokenResponse.text()
      console.error("[OAuth Google] Token exchange failed:", err)
      return errorRedirect("token_exchange_failed")
    }

    const tokenData = await tokenResponse.json()
    const idToken: string = tokenData.id_token
    if (!idToken) {
      return errorRedirect("no_id_token")
    }

    const apiResponse = await fetch(`${BACKEND_API_URL}/auth/oauth/google/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        idToken,
        orgDomain: state.orgDomain,
        deviceInfo: {},
      }),
    })
    const apiData = await apiResponse.json()
    if (!apiResponse.ok || apiData.status === "error") {
      return errorRedirect(apiData.message || "oauth_login_failed")
    }

    const { tokens } = apiData.data
    const handoffToken = await new SignJWT({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
      refreshExpiresIn: tokens.refreshExpiresIn,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("60s")
      .sign(HANDOFF_SECRET)

    const completeParams = new URLSearchParams({ token: handoffToken })
    if (state.returnUrl) {
      completeParams.set("returnUrl", state.returnUrl)
    }
    return NextResponse.redirect(
      `${state.tenantOrigin}/api/auth/oauth/complete?${completeParams.toString()}`
    )
  } catch (err) {
    console.error("[OAuth Google] Callback error:", err)
    return errorRedirect("oauth_callback_failed")
  }
}
