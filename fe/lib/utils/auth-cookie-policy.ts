/** Shared auth cookie names and refresh timing for middleware + server helpers. */

export const ACCESS_TOKEN_COOKIE = "auth2_access_token"
export const REFRESH_TOKEN_COOKIE = "auth2_refresh_token"

/** Refresh access JWT when fewer than this many seconds remain (matches getAccessToken). */
export const ACCESS_TOKEN_REFRESH_SKEW_SECONDS = 120

export function isCookieMutationContextError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }
  const message = error.message || ""
  return (
    message.includes("Cookies can only be modified in a Server Action or Route Handler") ||
    message.includes("cookies().set") ||
    message.includes("cookies().delete")
  )
}

export function accessTokenNeedsRefresh(
  exp: number | undefined,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): boolean {
  if (!exp) {
    return true
  }
  return exp - nowSeconds <= ACCESS_TOKEN_REFRESH_SKEW_SECONDS
}
