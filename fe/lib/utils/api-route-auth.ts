import { getAccessToken, userHasAnyRole } from "@/lib/utils/auth-server-helper"
import { NextResponse } from "next/server"

/** Returns a 401/403 response when auth fails; null when the caller may proceed. */
export async function requireApiRouteAuth(
  roles?: string[]
): Promise<NextResponse | null> {
  const token = await getAccessToken()
  if (!token) {
    return NextResponse.json({ message: "Sign in required" }, { status: 401 })
  }

  if (roles?.length) {
    const allowed = await userHasAnyRole(roles)
    if (!allowed) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }
  }

  return null
}
