import { logoutUser } from "@/lib/actions/auth/auth-public-actions"
import { ApiResponse } from "@/lib/types/api-response-schema"
import { createClientLogger } from "@/lib/utils/logger-client"
import { isNextRedirectError } from "@/lib/utils/next-redirect-error"
import { isUnknownTenantNotFoundMessage } from "@/lib/utils/unknown-tenant"
import { toast } from "sonner"

const logger = createClientLogger('ApiErrorHandler')

/**
 * Server actions that call `redirect('/login')` after a revoked session throw this on the client.
 * Skip generic "failed to fetch" toasts in catch blocks when true.
 */
export function isServerActionAuthRedirect(error: unknown): boolean {
  return isNextRedirectError(error)
}

function redirectToLoginSilently(): void {
  void (async () => {
    try {
      await logoutUser()
    } catch (error) {
      logger.error("Failed to call logout API", error as Error)
    }
    window.location.replace("/login")
  })()
}

/**
 * Handles API response errors globally
 * Returns true if the error was handled and caller should return early
 * Returns false if the error was not handled and caller should continue with custom handling
 */
export const handleApiErrorResponse = <T>(
  response: ApiResponse<T> | undefined | null,
  context: string = 'API call'
): boolean => {
  // Handle undefined/null response (likely due to authentication failure)
  if (!response) {
    logger.error(`${context}: API response is undefined - likely authentication failure`)
    redirectToLoginSilently()
    return true // Error was handled
  }

  // Only handle error responses
  if (response.status !== 'error') {
    return false // Not an error, let caller continue
  }

  // Handle authentication errors (401)
  if (response.code === 401) {
    logger.error(`${context}: Authentication error (401) — ${response.message || ""}`)
    // No toast — user is sent to login; a generic "Failed to fetch …" toast is misleading.
    redirectToLoginSilently()
    return true // Error was handled
  }

  // Handle authorization errors (403)
  if (response.code === 403) {
    logger.error(`${context}: Authorization error - ${response.message || 'no details'}`)
    toast.error(response.message || 'You do not have permission to perform this action.')
    return true // Error was handled
  }

  // Handle network errors
  if (response.code === 0) {
    logger.error(`${context}: Network error`)
    toast.error('Network error. Please check your connection and try again.')
    return true // Error was handled
  }

  // Handle validation errors (400)
  if (response.code === 400) {
    logger.error(`${context}: Validation error`)
    toast.error(response.message || 'Invalid data provided.')
    return true // Error was handled
  }

  // Handle not found errors (404)
  if (response.code === 404) {
    if (isUnknownTenantNotFoundMessage(response.message)) {
      logger.info(`${context}: Unknown tenant domain`)
      return true
    }
    logger.error(`${context}: Resource not found`)
    toast.error(response.message || 'Resource not found.')
    return true // Error was handled
  }

  // Handle conflict errors (409) - e.g., constraint violations, dependent records
  if (response.code === 409) {
    logger.error(`${context}: Conflict error`)
    toast.error(response.message || 'Cannot complete this action due to a conflict.')
    return true // Error was handled
  }

  // Handle server errors (500+)
  if (response.code >= 500) {
    logger.error(`${context}: Server error`)
    toast.error('Server error. Please try again later.')
    return true // Error was handled
  }

  // Handle other error types with generic message
  if (response.status === 'error') {
    logger.error(`${context}: API error`)
    toast.error(response.message || 'An error occurred. Please try again.')
    return true // Error was handled
  }

  // Return false for other cases - let the caller handle them
  return false
}