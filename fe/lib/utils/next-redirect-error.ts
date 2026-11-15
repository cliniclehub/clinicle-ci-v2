/**
 * True when `error` was thrown by `redirect()` from `next/navigation`.
 * Safe to use from server actions and client components (no client-only imports).
 */
export function isNextRedirectError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("digest" in error)) {
    return false
  }
  const digest = (error as { digest: unknown }).digest
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")
}
