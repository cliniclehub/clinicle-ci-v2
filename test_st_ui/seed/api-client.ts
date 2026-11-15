/**
 * Typed API seeding client — TypeScript port of `test_st_api/conftest.py::ApiClient`.
 *
 * Contract facts (verified against the backend):
 * - Base path `/api/v1`; responses use the envelope `{ status, message, timestamp, data }`
 *   with camelCase keys (`be/app/common/api_response_schema.py`).
 * - Tenant resolution via the `X-Organization-Domain` header; auth bodies carry `orgDomain`.
 * - Login: POST /auth/login {email, password, orgDomain} → data.tokens.accessToken.
 */

import { apiBaseUrl, orgDomain } from './env'

export interface ApiEnvelope<T = unknown> {
  status: 'success' | 'error'
  message: string
  timestamp: string
  data: T
  error?: unknown
}

export interface RequestOptions {
  token?: string
  orgDomain?: string
  /** Assert this HTTP status (default 200). Set to 0 to skip the assertion. */
  expectedStatus?: number
  query?: Record<string, string | number | boolean | undefined>
}

export class ApiError extends Error {
  constructor(
    readonly method: string,
    readonly path: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(`${method} ${path} → ${status}: ${body.slice(0, 500)}`)
  }
}

export class SeedApiClient {
  constructor(
    private readonly baseUrl: string = apiBaseUrl(),
    private readonly defaultOrgDomain: string = orgDomain(),
  ) {}

  async request<T = unknown>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
    options: RequestOptions = {},
  ): Promise<ApiEnvelope<T>> {
    const url = new URL(`${this.baseUrl}${path}`)
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value))
    }

    const headers: Record<string, string> = { Accept: 'application/json' }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (options.token) headers.Authorization = `Bearer ${options.token}`
    headers['X-Organization-Domain'] = options.orgDomain ?? this.defaultOrgDomain

    const response = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    const text = await response.text()

    // Default: accept any 2xx (routes mix 200/201). Explicit expectedStatus is exact; 0 = any.
    const expected = options.expectedStatus
    const ok =
      expected === 0 ||
      (expected === undefined
        ? response.status >= 200 && response.status < 300
        : response.status === expected)
    if (!ok) {
      throw new ApiError(method, path, response.status, text)
    }
    return (text ? JSON.parse(text) : {}) as ApiEnvelope<T>
  }

  // ---------------------------------
  // Auth
  // ---------------------------------

  async login(email: string, password: string, domain?: string): Promise<string> {
    const payload = await this.request<{ tokens: { accessToken: string } }>(
      'POST',
      '/auth/login',
      { email, password, orgDomain: domain ?? this.defaultOrgDomain },
      { orgDomain: domain },
    )
    const token = payload.data?.tokens?.accessToken
    if (!token) throw new Error(`Login for ${email} returned no accessToken`)
    return token
  }

  /**
   * Register a new user (public flow). Returns the raw envelope — caller follows up with
   * verifyEmail() using the code read from the DB (`db.latestEmailVerificationCode`).
   * Body shape: `RegisterRequest` in be/app/v1/auth/schema.py (camelCase on the wire).
   */
  async register(body: Record<string, unknown>, domain?: string): Promise<ApiEnvelope> {
    return this.request('POST', '/auth/register', { orgDomain: domain ?? this.defaultOrgDomain, ...body }, {
      orgDomain: domain,
      expectedStatus: 0,
    })
  }

  async verifyEmail(email: string, code: string, domain?: string): Promise<ApiEnvelope> {
    return this.request('POST', '/auth/verify-email', {
      email,
      code,
      orgDomain: domain ?? this.defaultOrgDomain,
    })
  }
}

/** Cached role sessions so builders don't re-login per call. */
export class RoleSessions {
  private tokens = new Map<string, string>()

  constructor(private readonly client: SeedApiClient) {}

  async token(email: string, password: string, domain?: string): Promise<string> {
    const key = `${domain ?? ''}:${email}`
    let token = this.tokens.get(key)
    if (!token) {
      token = await this.client.login(email, password, domain)
      this.tokens.set(key, token)
    }
    return token
  }
}
