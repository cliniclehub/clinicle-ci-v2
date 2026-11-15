/** True when Next.js failed to parse a server-action POST response (common during client navigation). */
export function isNextServerActionTransportError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }
  return (
    error.message === "An unexpected response was received from the server." ||
    error.message === "An unexpected response was received from the server" ||
    (error as Error & { __NEXT_ERROR_CODE?: string }).__NEXT_ERROR_CODE === "E394"
  )
}

export async function delayMs(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}
