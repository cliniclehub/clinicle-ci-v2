/**
 * Shared refresh token API call - no next/headers dependency.
 * Used by both middleware (request.cookies) and auth-server-helper (cookies()).
 */
export type RefreshApiResult =
  | {
      ok: true
      accessToken: string
      expiresIn: number
      refreshExpiresIn: number
    }
  | { ok: false; clearAuthCookies: boolean }

export async function callRefreshApi(refreshToken: string): Promise<RefreshApiResult> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_BACKEND_API_URL
    if (!baseUrl) return { ok: false, clearAuthCookies: false }

    const response = await fetch(`${baseUrl}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    })

    if (!response.ok) {
      const clear = response.status === 401 || response.status === 403
      return { ok: false, clearAuthCookies: clear }
    }

    const data = await response.json()
    if (data.status === "success" && data.data?.accessToken) {
      return {
        ok: true,
        accessToken: data.data.accessToken,
        expiresIn: data.data.expiresIn,
        refreshExpiresIn: data.data.refreshExpiresIn,
      }
    }

    if (data.status === "error" && data.code === 401) {
      return { ok: false, clearAuthCookies: true }
    }

    return { ok: false, clearAuthCookies: false }
  } catch {
    return { ok: false, clearAuthCookies: false }
  }
}
