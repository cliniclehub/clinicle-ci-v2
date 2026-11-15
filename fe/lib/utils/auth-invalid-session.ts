/**
 * Detect auth failures where cookies must be cleared and the user must sign in again.
 * Aligns with backend AuthenticationError strings (auth_helper, auth services) and
 * client-side "no token" responses from apiCaller.
 */
export function shouldForceReloginAfter401(
  message: string | undefined,
  description?: string | undefined
): boolean {
  const combined = `${message ?? ""} ${description ?? ""}`.toLowerCase()

  if (combined.includes("session not found")) return true
  if (combined.includes("session has expired")) return true
  if (combined.includes("session has been revoked")) return true
  if (combined.includes("invalid token")) return true
  if (combined.includes("refresh token not found")) return true
  if (combined.includes("invalid refresh token")) return true
  if (combined.includes("refresh token has been revoked")) return true
  if (combined.includes("refresh token has expired")) return true
  if (combined.includes("authentication failed")) return true
  if (combined.includes("user not found")) return true

  if (combined.includes("revoked")) return true

  // Do NOT match "no authentication token" / missing cookie here — that is normal on /login
  // and would cause initializeUser → redirect → infinite navigation.

  return false
}
