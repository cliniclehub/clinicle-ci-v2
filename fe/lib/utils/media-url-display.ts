const WORKER_AUTH_QUERY_PARAMS = new Set(["token", "expires", "local", "mediatoken", "media_token"])

const ORG_MEDIA_PATH_PREFIX = "/orgs/"

function parseConfiguredWorkerHostname(raw: string | undefined): string | null {
  const trimmed = raw?.trim()
  if (!trimmed) return null
  try {
    const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    return new URL(normalized).hostname.toLowerCase()
  } catch {
    return null
  }
}

function configuredMediaWorkerHostnames(): Set<string> {
  const hosts = new Set<string>()
  for (const envVar of [
    process.env.R2_MEDIA_SERVER_WORKER_URL,
    process.env.R2_PUBLIC_MEDIA_SERVER_WORKER_URL,
    process.env.NEXT_PUBLIC_R2_MEDIA_SERVER_WORKER_URL,
    process.env.NEXT_PUBLIC_R2_PUBLIC_MEDIA_SERVER_WORKER_URL,
  ]) {
    const hostname = parseConfiguredWorkerHostname(envVar)
    if (hostname) {
      hosts.add(hostname)
    }
  }

  if (process.env.NODE_ENV !== "production") {
    hosts.add("localhost")
    hosts.add("127.0.0.1")
  }

  return hosts
}

function hasOrgMediaPath(pathname: string): boolean {
  return pathname.includes(ORG_MEDIA_PATH_PREFIX)
}

/** True when URL points at configured org R2 / media worker storage (not a third-party link). */
export function isHostedOrgMediaUrl(url: string): boolean {
  const trimmed = url.trim()
  if (!trimmed) return false

  const allowedHosts = configuredMediaWorkerHostnames()

  if (trimmed.startsWith("/")) {
    return hasOrgMediaPath(trimmed)
  }

  try {
    const normalized = trimmed.startsWith("http") ? trimmed : `https://${trimmed}`
    const parsed = new URL(normalized)
    if (!hasOrgMediaPath(parsed.pathname)) {
      return false
    }
    return allowedHosts.has(parsed.hostname.toLowerCase())
  } catch {
    return false
  }
}

/** Remove short-lived worker auth query params (token, expires, local, mediaToken). */
export function stripUrlTokenForDisplay(url: string): string {
  try {
    const u = new URL(url)
    for (const key of Array.from(u.searchParams.keys())) {
      if (WORKER_AUTH_QUERY_PARAMS.has(key.toLowerCase())) {
        u.searchParams.delete(key)
      }
    }
    const out = u.toString()
    return out.endsWith("?") ? out.slice(0, -1) : out
  } catch {
    const [base, queryAndFragment] = url.split("?", 2)
    if (!queryAndFragment) return url

    const [query, fragment] = queryAndFragment.split("#", 2)
    const filtered = query
      .split("&")
      .filter((part) => {
        const [rawKey] = part.split("=", 1)
        try {
          return !WORKER_AUTH_QUERY_PARAMS.has(decodeURIComponent(rawKey).toLowerCase())
        } catch {
          return !WORKER_AUTH_QUERY_PARAMS.has(rawKey.toLowerCase())
        }
      })
      .join("&")

    return `${base}${filtered ? `?${filtered}` : ""}${fragment !== undefined ? `#${fragment}` : ""}`
  }
}

/** Canonical URL to persist in DB — never store preview/session tokens on hosted media. */
export function toPersistableMediaUrl(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return trimmed
  return isHostedOrgMediaUrl(trimmed) ? stripUrlTokenForDisplay(trimmed) : trimmed
}

export function needsWorkerAccessToken(url: string): boolean {
  return isHostedOrgMediaUrl(url)
}

export function filenameFromMediaUrl(url: string): string {
  try {
    const u = new URL(url)
    const segment = u.pathname.split("/").filter(Boolean).pop()
    return segment ? decodeURIComponent(segment) : ""
  } catch {
    return ""
  }
}

/** @internal Test helper — exposes configured worker host allowlist. */
export function getConfiguredMediaWorkerHostnamesForTests(): string[] {
  return Array.from(configuredMediaWorkerHostnames()).sort()
}
