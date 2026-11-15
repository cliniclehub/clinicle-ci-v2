import { ApiRequestOptions, ApiResponse } from "@/lib/types/api-response-schema"
import {
  isHttpOkErrorEnvelope,
  parseHttpOkErrorEnvelope,
  pickErrorDetails,
} from "@/lib/utils/api-response-envelope"
import { shouldForceReloginAfter401 } from "@/lib/utils/auth-invalid-session"
import { getAccessToken, userHasAnyPermission, userHasAnyRole, userHasPermission, userHasRole } from "@/lib/utils/auth-server-helper"
import { getDomain } from "@/lib/utils/domain-name-helper-server"
import {
  getLogHttpBodies,
  getLogHttpHeaders,
  shouldLogHttpExchange,
} from "@/lib/utils/log-config"
import {
  redactForLog,
  redactHeaderValue,
  redactHeadersForLog,
  redactUrlForLog,
} from "@/lib/utils/log-redaction"
import { createServerLogger } from "@/lib/utils/logger-server"
import { isNextRedirectError } from "@/lib/utils/next-redirect-error"
import { headers } from "next/headers"
import { redirect } from "next/navigation"

export class ApiAuthHelper {
  private logger = createServerLogger("ApiAuthHelper")
  private baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
  }

  /**
   * Make an API request with Auth2 authentication and error handling
   */
  async makeRequest<T>(
    options: ApiRequestOptions
  ): Promise<ApiResponse<T>> {
    const methodLogger = this.logger.forMethod("makeRequest")
    const {
      endpoint,
      baseUrl = this.baseUrl,
      requireAuth = true,
      attachAuthIfAvailable = false,
      requireRole,
      requirePermission,
      logResponse,
      logRequest,
      ...requestOptions
    } = options

    // Three-knob model: LOG_HTTP_* defaults; per-call override when explicitly set.
    const httpExchangeDefault = shouldLogHttpExchange()
    const shouldLogRequest = logRequest ?? httpExchangeDefault
    const shouldLogResponse = logResponse ?? httpExchangeDefault
    const logHeaders = getLogHttpHeaders()
    const logBodies = getLogHttpBodies()

    try {
      // Get authentication token if required
      let token: string | null = null
      if (requireAuth) {
        token = await getAccessToken()
        if (!token) {
          return {
            status: "error",
            code: 401,
            type: "AuthenticationError",
            message: "Authentication required",
            description: "No authentication token found",
            timestamp: new Date().toISOString()
          }
        }
      } else if (attachAuthIfAvailable) {
        token = await getAccessToken()
      }

      // Validate role if required
      if (requireRole) {
        try {
          let hasRole = false
          if (Array.isArray(requireRole)) {
            hasRole = await userHasAnyRole(requireRole)
          } else {
            hasRole = await userHasRole(requireRole)
          }
          
          if (!hasRole) {
            return {
              status: "error",
              code: 403,
              type: "AuthorizationError",
              message: "Insufficient permissions",
              description: `Required role: ${Array.isArray(requireRole) ? requireRole.join(', ') : requireRole}`,
              timestamp: new Date().toISOString()
            }
          }
        } catch (error: any) {
          return {
            status: "error",
            code: 403,
            type: "AuthorizationError",
            message: error.message || "Insufficient permissions",
            description: `Required role: ${Array.isArray(requireRole) ? requireRole.join(', ') : requireRole}`,
            timestamp: new Date().toISOString()
          }
        }
      }

      if (requirePermission) {
        try {
          const allowed = Array.isArray(requirePermission)
            ? await userHasAnyPermission(requirePermission)
            : await userHasPermission(requirePermission)
          if (!allowed) {
            return {
              status: "error",
              code: 403,
              type: "AuthorizationError",
              message: "Insufficient permissions",
              description: `Required permission: ${
                Array.isArray(requirePermission)
                  ? requirePermission.join(", ")
                  : requirePermission
              }`,
              timestamp: new Date().toISOString(),
            }
          }
        } catch (error: any) {
          return {
            status: "error",
            code: 403,
            type: "AuthorizationError",
            message: error.message || "Insufficient permissions",
            description: `Required permission: ${
              Array.isArray(requirePermission)
                ? requirePermission.join(", ")
                : requirePermission
            }`,
            timestamp: new Date().toISOString(),
          }
        }
      }

      // Get organization domain
      const domain = await getDomain()

      // Forward browser/client IP for backend GeoIP (regional pricing). Backend uses X-Real-Client-IP
      // when it trusts the connection (trust-all or from trusted proxy IPs).
      let clientIp: string | null = null
      let userAgent: string | null = null
      try {
        const headersList = await headers()
        const forwarded = headersList.get("x-forwarded-for")
        if (forwarded) {
          const first = forwarded.split(",")[0]?.trim()
          if (first) clientIp = first
        }
        if (!clientIp) clientIp = headersList.get("x-real-ip")?.trim() || null
        if (!clientIp) clientIp = headersList.get("cf-connecting-ip")?.trim() || null
        userAgent = headersList.get("user-agent")?.trim() || null
      } catch {
        // No request context (e.g. background job); backend will use connection IP
      }

      // Build headers
      const requestHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Organization-Domain': domain || '',
        ...(requestOptions.headers as Record<string, string>),
      }
      if (clientIp) requestHeaders['X-Real-Client-IP'] = clientIp
      if (userAgent) requestHeaders['User-Agent'] = userAgent

      if (token) {
        requestHeaders['Authorization'] = `Bearer ${token}`
      }

      // Normalize endpoint: Add trailing slash for GET requests to resource roots
      // This prevents FastAPI redirects that strip Authorization headers
      // FastAPI automatically redirects /resource to /resource/, but the redirect
      // doesn't preserve the Authorization header, causing 401 errors
      let normalizedEndpoint = endpoint
      if ((requestOptions.method === 'GET' || !requestOptions.method) && !endpoint.endsWith('/')) {
        // Check if this is a resource root endpoint (no path parameters or query strings)
        // Example: /users (but not /users/123 or /users?param=value)
        // Pattern: starts with /, followed by resource name, no additional path segments
        const hasQueryString = endpoint.includes('?')
        const pathOnly = hasQueryString ? endpoint.split('?')[0] : endpoint
        const resourceRootPattern = /^\/[^\/]+$/
        
        if (resourceRootPattern.test(pathOnly)) {
          // Add trailing slash before query string if present
          if (hasQueryString) {
            const [path, query] = endpoint.split('?')
            normalizedEndpoint = `${path}/?${query}`
          } else {
            normalizedEndpoint = `${endpoint}/`
          }
        }
      }

      // Build full URL
      const url = `${baseUrl}${normalizedEndpoint}`
      const method = requestOptions.method || 'GET'

      // ============================================
      // START REQUEST LOGGING (gated by LOG_HTTP_*)
      // ============================================
      if (shouldLogRequest) {
        methodLogger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
        methodLogger.info(`→ ${method} ${redactUrlForLog(url)}`)
        
        if (logHeaders) {
          const headersRecord =
            requestHeaders instanceof Headers
              ? Object.fromEntries(requestHeaders.entries())
              : (requestHeaders as Record<string, string>)
          methodLogger.info("Request Headers:", redactHeadersForLog(headersRecord))
        }

        if (logBodies && requestOptions.body) {
          let logBody: unknown = null
          if (typeof requestOptions.body === "string") {
            try {
              logBody = JSON.parse(requestOptions.body)
            } catch {
              logBody = "[non-json payload omitted]"
            }
          } else {
            logBody = requestOptions.body
          }
          if (logBody !== null && logBody !== undefined) {
            methodLogger.info("Request Body:", redactForLog(logBody))
          }
        }
      }

      // Make the request
      const response = await fetch(url, {
        ...requestOptions,
        headers: requestHeaders,
        credentials: 'include',
      })

      // Parse response
      let responseData: any = null
      const responseHeaders: Record<string, string> = {}
      
      // Collect response headers
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value
      })
      
      // For 204 No Content, don't try to parse
      if (response.status === 204) {
        responseData = { status: "success", message: "Operation completed successfully" }
      } else {
        // Try to parse JSON response - be more lenient with headers
        // (redirects might not preserve all headers correctly, so don't rely on content-length)
        try {
          // Read response as text first to check if it's empty
          const text = await response.text()
          
          // If body is empty, create default response
          if (!text || text.trim().length === 0) {
            responseData = { 
              status: response.ok ? "success" : "error",
              message: response.ok ? "Operation completed successfully" : "Request failed"
            }
          } else {
            const contentType = response.headers.get("content-type") ?? ""
            if (response.ok && contentType.includes("text/csv")) {
              responseData = {
                status: "success",
                message: "Export generated successfully",
                data: text,
              }
            } else {
              // Try to parse as JSON
              try {
                responseData = JSON.parse(text)
              } catch (jsonError) {
                // If JSON parsing fails, log and create error response
                methodLogger.error("Failed to parse response as JSON", jsonError as Error, {
                  text: text.substring(0, 500),
                  url: redactUrlForLog(url),
                  status: response.status,
                  statusText: response.statusText
                })
                responseData = {
                  status: "error",
                  code: response.status,
                  type: "InvalidResponseError",
                  message: "An unexpected response was received from the server",
                  description: `The server returned a response that could not be parsed. Status: ${response.status} ${response.statusText}`,
                  timestamp: new Date().toISOString()
                }
              }
            }
          }
        } catch (parseError) {
          // If reading response fails, create a default response
          methodLogger.error("Failed to read response body", parseError as Error, { 
            status: response.status,
            url: redactUrlForLog(url)
          })
          responseData = { 
            status: response.ok ? "success" : "error",
            message: response.ok ? "Operation completed successfully" : "Request failed"
          }
        }
      }

      // ============================================
      // END REQUEST / START RESPONSE LOGGING
      // ============================================
      if (shouldLogResponse) {
        methodLogger.info(
          `← ${method} ${redactUrlForLog(url)} [${response.status} ${response.statusText}]`
        )
        
        if (logHeaders && Object.keys(responseHeaders).length > 0) {
          methodLogger.info("Response Headers:", redactHeadersForLog(responseHeaders))
        }
        
        if (logBodies) {
          methodLogger.info("Response Body:", redactForLog(responseData))
        }
        methodLogger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
      }

      // Handle 401 - Authentication failure
      // Note: Token refresh is now handled automatically in getAccessToken()
      // so we should only get here for legitimate auth failures
      if (response.status === 401 && requireAuth) {
        const errorMessage = responseData.message || responseData.detail || "Authentication failed"
        const errorDescription =
          typeof responseData.description === "string" ? responseData.description : undefined
        const mustRelogin = shouldForceReloginAfter401(
          typeof errorMessage === "string" ? errorMessage : String(errorMessage),
          errorDescription
        )

        methodLogger.info("Received 401 authentication error", {
          errorType: responseData.type || responseData.error_type,
          errorMessage: errorMessage,
          mustRelogin,
        })

        if (mustRelogin) {
          methodLogger.warn("Session invalid or expired, clearing tokens")
          try {
            const { tryClearAuthCookies } = await import("@/lib/utils/auth-server-helper")
            await tryClearAuthCookies()
          } catch (clearError) {
            methodLogger.error("Failed to clear cookies after revoked session", clearError as Error)
          }
          // Server Action / RSC: send user to login immediately so clients do not toast generic
          // "failed to fetch" while cookies are already cleared.
          redirect("/login")
        }
        
        // Return the actual error from the API
        const details401 = pickErrorDetails(responseData as Record<string, unknown>)
        return {
          status: "error",
          code: responseData.code || 401,
          type: responseData.type || "AuthenticationError",
          message: errorMessage,
          description: responseData.description || "Please login again.",
          timestamp: responseData.timestamp || new Date().toISOString(),
          ...(details401 ? { details: details401 } : {}),
        }
      }

      // Handle non-OK responses
      if (!response.ok) {
        const errorMessage =
          (typeof responseData.message === "string" && responseData.message) ||
          (typeof responseData.detail === "string" && responseData.detail) ||
          "Request failed"
        const detailsErr = pickErrorDetails(responseData as Record<string, unknown>)
        return {
          status: "error",
          code: response.status,
          type: this.getErrorType(response.status),
          message: errorMessage,
          description: responseData.description,
          timestamp: new Date().toISOString(),
          ...(detailsErr ? { details: detailsErr } : {}),
        }
      }

      // HTTP 2xx with business-level error envelope (success:false / status:error)
      if (
        response.ok &&
        isHttpOkErrorEnvelope(responseData as Record<string, unknown>)
      ) {
        return parseHttpOkErrorEnvelope<T>(
          responseData as Record<string, unknown>,
          response.status,
          (status) => this.getErrorType(status)
        )
      }

      // Success response
      if ((responseData.success === true || responseData.status === "success") && responseData.data !== undefined) {
        return {
          status: "success",
          data: responseData.data,
          message: responseData.message,
          timestamp: responseData.timestamp || new Date().toISOString(),
          pagination: responseData.pagination || null
        }
      }

      // Handle API responses that don't follow our standard format
      return {
        status: "success",
        data: responseData as T,
        message: responseData.message || "Success",
        timestamp: new Date().toISOString(),
        pagination: responseData.pagination || null
      }

    } catch (error: any) {
      if (isNextRedirectError(error)) {
        throw error
      }
      methodLogger.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
      // Convert error to Error object if it's not already one
      const errorObj = error instanceof Error ? error : new Error(String(error))
      methodLogger.error("Request failed with error", errorObj, {
        errorType: error?.constructor?.name || typeof error,
        errorMessage: error?.message || String(error),
        endpoint,
        method: requestOptions.method || 'GET'
      })
      methodLogger.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

      // Network or other errors
      return {
        status: "error",
        code: 0,
        type: "NetworkError",
        message: "Request failed",
        description: error.message || "An unexpected error occurred",
        timestamp: new Date().toISOString()
      }
    }
  }

  /**
   * Make a GET request
   */
  async get<T>(
    endpoint: string,
    options: Omit<ApiRequestOptions, 'endpoint' | 'method'> = {}
  ): Promise<ApiResponse<T>> {
    return this.makeRequest<T>({
      ...options,
      endpoint,
      method: 'GET',
    })
  }

  /**
   * Make a POST request
   */
  async post<T>(
    endpoint: string,
    body?: any,
    options: Omit<ApiRequestOptions, 'endpoint' | 'method' | 'body'> = {}
  ): Promise<ApiResponse<T>> {
    return this.makeRequest<T>({
      ...options,
      endpoint,
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    })
  }

  /**
   * Make a PUT request
   */
  async put<T>(
    endpoint: string,
    body?: any,
    options: Omit<ApiRequestOptions, 'endpoint' | 'method' | 'body'> = {}
  ): Promise<ApiResponse<T>> {
    return this.makeRequest<T>({
      ...options,
      endpoint,
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    })
  }

  /**
   * Make a PATCH request
   */
  async patch<T>(
    endpoint: string,
    body?: any,
    options: Omit<ApiRequestOptions, 'endpoint' | 'method' | 'body'> = {}
  ): Promise<ApiResponse<T>> {
    return this.makeRequest<T>({
      ...options,
      endpoint,
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
    })
  }

  /**
   * Make a DELETE request
   */
  async delete<T>(
    endpoint: string,
    options: Omit<ApiRequestOptions, 'endpoint' | 'method'> = {}
  ): Promise<ApiResponse<T>> {
    return this.makeRequest<T>({
      ...options,
      endpoint,
      method: 'DELETE',
    })
  }

  /**
   * Helper method to determine error type from status code
   */
  private getErrorType(statusCode: number): string {
    if (statusCode === 400) return "ValidationError"
    if (statusCode === 401) return "AuthenticationError"
    if (statusCode === 403) return "AuthorizationError"
    if (statusCode === 404) return "NotFoundError"
    if (statusCode === 409) return "ConflictError"
    if (statusCode === 429) return "RateLimitError"
    if (statusCode >= 500) return "ServerError"
    return "UnknownError"
  }

  /**
   * Sanitize headers for logging (remove sensitive data)
   */
  private sanitizeHeaders(headers: HeadersInit): Record<string, string> {
    const sanitized: Record<string, string> = {}
    const headersObj =
      headers instanceof Headers
        ? Object.fromEntries(headers.entries())
        : (headers as Record<string, string>)

    for (const [key, value] of Object.entries(headersObj)) {
      sanitized[key] = redactHeaderValue(key, String(value))
    }

    return sanitized
  }
  /**
     * Build query string from parameters
     */
  buildQueryString(params: Record<string, any>): string {
    const searchParams = new URLSearchParams()

    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        searchParams.append(key, String(value))
      }
    })

    const queryString = searchParams.toString()
    return queryString ? `?${queryString}` : ''
  }
  /**
   * Create endpoint with query parameters
   */
  createEndpoint(baseEndpoint: string, params: Record<string, any> = {}): string {
    const queryString = this.buildQueryString(params)
    return `${baseEndpoint}${queryString}`
  }
}
// Default instance
const defaultBaseUrl = process.env.NEXT_PUBLIC_BACKEND_API_URL || 'http://localhost:8000'
// Add /api/v1 prefix if not already present in the base URL
const apiBaseUrl = defaultBaseUrl.includes('/api/v1') ? defaultBaseUrl : `${defaultBaseUrl}/api/v1`
export const apiAuthHelper = new ApiAuthHelper(apiBaseUrl)
export const apiCaller = apiAuthHelper
